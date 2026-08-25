// src/workers/iscrizioneWorker.js
import { supabaseAdmin } from '../config/supabase.js';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
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

        // 2. Recupera le credenziali del presidente
        // ... (da implementare con la tabella credenziali_portale_presidenti)

        // 3. Login sul portale
        console.log('🌐 Navigazione al portale...');
        await page.goto(PORTALE_URL, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // 4. Login
        await page.type('input[name="username"]', process.env.PRESIDENTE_USERNAME);
        await page.type('input[name="password"]', process.env.PRESIDENTE_PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForNavigation();

        // 5. Navigazione alla gara
        // ... (da implementare)

        // 6. Selezione del giorno
        // ... (da implementare)

        // 7. Apertura dialog iscrizione
        // ... (da implementare)

        // 8. Selezione atleta
        // ... (da implementare)

        // 9. Salva modifiche
        // ... (da implementare)

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