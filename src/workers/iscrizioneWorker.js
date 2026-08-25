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

        // 2. Recupera le credenziali del presidente dal database (cifrate)
        // Recupera l'ASD della gara per trovare il presidente
        const { data: gara, error: garaError } = await supabaseAdmin
            .from('gare')
            .select('id_asd')
            .eq('id', iscrizione.id_gara)
            .single();

        if (garaError || !gara) {
            throw new Error(`Gara non trovata: ${iscrizione.id_gara}`);
        }

        // Trova il presidente dell'ASD
        const { data: presidente, error: presidenteError } = await supabaseAdmin
            .from('manutentori')
            .select('id')
            .eq('asd_id', gara.id_asd)
            .eq('ruolo', 'presidente')
            .single();

        if (presidenteError || !presidente) {
            throw new Error(`Presidente non trovato per ASD: ${gara.id_asd}`);
        }

        // Recupera le credenziali del presidente (decifrate)
        const credenziali = await getCredenzialiPerPuppeteer(presidente.id);
        console.log(`🔑 Credenziali recuperate per: ${credenziali.username}`);

        // 3. Imposta user agent realistico
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 4. Login sul portale
        console.log('🌐 Navigazione al portale...');
        await page.goto(PORTALE_URL, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        console.log('👤 Inserimento credenziali...');
        // 🔧 SELETTORI CORRETTI (trovati con il test)
        await page.type('#edit-name', credenziali.username);
        await page.type('#edit-pass', credenziali.password);
        await page.click('#edit-submit-1');

        console.log('⏳ Attesa login...');
        await page.waitForNavigation({
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        console.log('✅ Login completato!');

        // 5. Navigazione alla gara
        // Costruisci l'URL della gara con l'ID evento
        const idE = iscrizione.gare.id; // O il campo corretto per l'ID evento
        console.log(`🔗 Navigazione alla gara: ${idE}`);
        await page.goto(`https://tesseramento.fibis.it/GS_accreditiEvento?idE=SE_${idE}`, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // 6. Selezione del giorno
        console.log(`📅 Selezione giorno: ${iscrizione.giorno_iscrizione}`);
        // Formatta la data nel formato atteso dal select
        // Esempio: "24/08/2026 18:30 - LUNEDÌ"
        // Per ora usiamo un selettore generico, da migliorare con dati reali
        const giornoFormattato = iscrizione.giorno_iscrizione; // Da formattare correttamente
        await page.select('select[name="turnoF_fAcc"]', giornoFormattato);

        // 7. Apertura dialog iscrizione
        console.log('📂 Apertura dialog iscrizione...');
        await page.evaluate(() => {
            nuovaIscrizione('', '');
        });
        await page.waitForSelector('#dialog-dettagliIscrizione', { visible: true });
        console.log('✅ Dialog aperto!');

        // 8. Selezione atleta
        console.log(`🔍 Ricerca atleta: ${iscrizione.tesserati.nome} ${iscrizione.tesserati.cognome}`);
        // Digita il cognome dell'atleta
        await page.type('input[name="cognome_fAcc"]', iscrizione.tesserati.cognome);
        await page.waitForTimeout(1000);
        
        // Clicca sul pulsante "Aggiungi" nella tabella (selettore da definire)
        // await page.click('#elencoAtleti tbody tr:first-child td:last-child button');

        // 9. Salva modifiche
        console.log('💾 Salvataggio iscrizione...');
        await page.click('button:contains("Salva modifiche")');
        await page.waitForTimeout(2000);

        // 10. Aggiorna stato iscrizione
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
        
        // Aggiorna stato a fallita
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