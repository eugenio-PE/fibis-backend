// src/workers/iscrizioneWorker.js
import { supabaseAdmin } from '../config/supabase.js';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import { getCredenzialiPerPuppeteer } from '../controllers/credenzialiController.js';
dotenv.config();

// ============================================================
// CONFIGURAZIONE
// ============================================================
const PORTALE_URL = 'https://tesseramento.fibis.it';

// ============================================================
// FUNZIONE PRINCIPALE
// ============================================================
export async function eseguiIscrizioneGara(idIscrizione) {
    console.log(`🔄 [ISCRIZIONE WORKER] Avvio iscrizione ${idIscrizione}...`);
    const startTime = Date.now();

    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    try {
        // 1. Recupera i dati dell'iscrizione dal database
        const { data: iscrizione, error: iscrizioneError } = await supabaseAdmin
            .from('iscrizioni_gare')
            .select(`
                *,
                gare (*),
                tesserati (*)
            `)
            .eq('id', idIscrizione)
            .single();

        if (iscrizioneError || !iscrizione) {
            throw new Error(`Iscrizione non trovata: ${idIscrizione}`);
        }

        console.log(`📋 Iscrizione: ${iscrizione.id}`);
        console.log(`  - Gara: ${iscrizione.gare.nome}`);
        console.log(`  - Tesserato: ${iscrizione.tesserati.nome} ${iscrizione.tesserati.cognome}`);
        console.log(`  - Giorno: ${iscrizione.giorno_iscrizione}`);

        // 2. RECUPERA L'ASD DEL TESSERATO (non della gara!)
        const { data: tesserato, error: tesseratoError } = await supabaseAdmin
            .from('tesserati')
            .select('asd_id')
            .eq('id', iscrizione.id_tesserato)
            .single();

        if (tesseratoError || !tesserato) {
            throw new Error(`Tesserato non trovato: ${iscrizione.id_tesserato}`);
        }

        if (!tesserato.asd_id) {
            throw new Error(`Tesserato non ha un ASD associato: ${iscrizione.id_tesserato}`);
        }

        // 3. Trova il presidente dell'ASD DEL TESSERATO
        const { data: presidente, error: presidenteError } = await supabaseAdmin
            .from('manutentori')
            .select('id')
            .eq('asd_id', tesserato.asd_id)
            .eq('ruolo', 'presidente')
            .single();

        if (presidenteError || !presidente) {
            throw new Error(`Presidente non trovato per ASD: ${tesserato.asd_id}`);
        }

        // Recupera le credenziali del presidente (decifrate)
        const credenziali = await getCredenzialiPerPuppeteer(presidente.id);
        console.log(`🔑 Credenziali recuperate per: ${credenziali.username}`);

        // 4. Imposta user agent realistico
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 5. Login sul portale
        console.log('🌐 Navigazione al portale...');
        await page.goto(PORTALE_URL, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        console.log('👤 Inserimento credenziali...');
        await page.type('#edit-name', credenziali.username);
        await page.type('#edit-pass', credenziali.password);
        await page.click('#edit-submit-1');

        console.log('⏳ Attesa login...');
        await page.waitForNavigation({
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        console.log('✅ Login completato!');

        // 🔥 SCREENSHOT: dopo il login
        await page.screenshot({ path: '1_after_login.png' });
        console.log('📸 Screenshot salvato: 1_after_login.png');

        // 6. Navigazione alla pagina "Gestionale Sportivo"
        console.log('🔗 Navigazione al gestionale sportivo...');
        
        // Attendi e clicca sul link "Gestionale Sportivo"
        await page.waitForSelector('a:contains("Gestionale Sportivo")', { timeout: 10000 });
        await page.click('a:contains("Gestionale Sportivo")');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        console.log('✅ Gestionale Sportivo aperto!');

        // 🔥 SCREENSHOT: dopo il gestionale
        await page.screenshot({ path: '2_after_gestionale.png' });
        console.log('📸 Screenshot salvato: 2_after_gestionale.png');

        // 7. Seleziona "Stecca" e filtri
        console.log('🔍 Selezione disciplina e filtri...');
        
        // Seleziona "Stecca" (se presente)
        try {
            await page.select('select[name="disciplina"]', 'stecca');
            await page.waitForTimeout(1000);
        } catch (e) {
            console.log('⚠️ Selettore disciplina non trovato, proseguo...');
        }

        // Imposta filtri "NO" per stato (se presente)
        try {
            await page.select('select[name="stato"]', 'NO');
            await page.waitForTimeout(1000);
        } catch (e) {
            console.log('⚠️ Selettore stato non trovato, proseguo...');
        }

        // Clicca sul pulsante "Cerca" (se presente)
        try {
            await page.click('input[value="Cerca"], button:contains("Cerca")');
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        } catch (e) {
            console.log('⚠️ Pulsante Cerca non trovato, proseguo...');
        }

        console.log('✅ Filtri applicati!');

        // 🔥 SCREENSHOT: dopo i filtri
        await page.screenshot({ path: '3_after_filters.png' });
        console.log('📸 Screenshot salvato: 3_after_filters.png');

        // 8. Trova e clicca sulla gara
        console.log(`🔗 Ricerca gara: ${iscrizione.gare.nome}`);
        
        // Cerca la riga della gara nella tabella
        const garaTrovata = await page.evaluate((nomeGara) => {
            const rows = document.querySelectorAll('table tbody tr');
            for (const row of rows) {
                if (row.textContent.includes(nomeGara)) {
                    return row;
                }
            }
            return null;
        }, iscrizione.gare.nome);

        if (!garaTrovata) {
            throw new Error(`Gara non trovata nella lista: ${iscrizione.gare.nome}`);
        }

        // Clicca sul link "Iscrizioni" nella riga della gara
        await page.evaluate((row) => {
            const link = row.querySelector('a:contains("Iscrizioni")');
            if (link) link.click();
        }, garaTrovata);

        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        console.log('✅ Pagina iscrizioni aperta!');

        // 🔥 SCREENSHOT: dopo il click su Iscrizioni
        await page.screenshot({ path: '4_after_iscrizioni.png' });
        console.log('📸 Screenshot salvato: 4_after_iscrizioni.png');

        // 9. Clicca sul pulsante "Iscrizioni" (se presente)
        try {
            await page.click('button:contains("Iscrizioni"), a:contains("Iscrizioni")');
            await page.waitForTimeout(2000);
        } catch (e) {
            console.log('⚠️ Pulsante Iscrizioni non trovato, proseguo...');
        }

        // 10. Selezione del giorno
        console.log(`📅 Selezione giorno: ${iscrizione.giorno_iscrizione}`);
        try {
            await page.select('select[name="turnoF_fAcc"]', iscrizione.giorno_iscrizione);
        } catch (e) {
            console.log('⚠️ Select giorno non trovato, proseguo...');
        }

        // 🔥 SCREENSHOT: dopo la selezione del giorno
        await page.screenshot({ path: '5_after_day_selection.png' });
        console.log('📸 Screenshot salvato: 5_after_day_selection.png');

        // 11. Apertura dialog iscrizione
        console.log('📂 Apertura dialog iscrizione...');

        // Aspetta che la funzione nuovaIscrizione sia disponibile
        await page.waitForFunction(() => typeof nuovaIscrizione !== 'undefined', { timeout: 10000 });

        // Chiama la funzione
        await page.evaluate(() => {
            nuovaIscrizione('', '');
        });

        await page.waitForSelector('#dialog-dettagliIscrizione', { visible: true, timeout: 10000 });
        console.log('✅ Dialog aperto!');

        // 12. Selezione atleta
        console.log(`🔍 Ricerca atleta: ${iscrizione.tesserati.nome} ${iscrizione.tesserati.cognome}`);
        await page.type('input[name="cognome_fAcc"]', iscrizione.tesserati.cognome);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 13. Clicca sul pulsante "Aggiungi" nella tabella
        try {
            await page.click('#elencoAtleti tbody tr:first-child td:last-child button');
        } catch (e) {
            console.log('⚠️ Pulsante Aggiungi non trovato, proseguo...');
        }

        // 14. Salva modifiche
        console.log('💾 Salvataggio iscrizione...');
        try {
            await page.click('button:contains("Salva modifiche")');
        } catch (e) {
            console.log('⚠️ Pulsante Salva non trovato, proseguo...');
        }
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 15. Aggiorna stato iscrizione
        await supabaseAdmin
            .from('iscrizioni_gare')
            .update({
                stato: 'completata',
                data_completamento: new Date().toISOString()
            })
            .eq('id', idIscrizione);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ [ISCRIZIONE WORKER] Completata in ${elapsed}s`);

        return { success: true };

    } catch (error) {
        console.error('❌ [ISCRIZIONE WORKER] Errore:', error);
        
        // 🔥 Aggiorna stato a fallita
        await supabaseAdmin
            .from('iscrizioni_gare')
            .update({
                stato: 'fallita',
                ultimo_errore: error.message
            })
            .eq('id', idIscrizione);
        
        return { success: false, error: error.message };
    } finally {
        await browser.close();
    }
}

// ============================================================
// AVVIO DIRETTO (per test)
// ============================================================
(async () => {
    const idIscrizione = process.argv[2];
    if (!idIscrizione) {
        console.log('❌ Specifica un ID iscrizione: node src/workers/iscrizioneWorker.js <id>');
        process.exit(1);
    }
    
    console.log(`🚀 Avvio manuale iscrizione ${idIscrizione}...`);
    const result = await eseguiIscrizioneGara(idIscrizione);
    console.log('📊 Risultato:', result);
})();