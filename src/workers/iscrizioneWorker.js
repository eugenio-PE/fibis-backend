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

        // ============================================================
        // 1. LOGIN (migliorato dal file di test)
        // ============================================================
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

        // ============================================================
        // 2. GESTIONALE SPORTIVO (migliorato dal file di test)
        // ============================================================
        console.log('🔗 Navigazione al gestionale sportivo...');

        const gestionaleClicked = await page.evaluate(() => {
            const link = document.querySelector('a.expandfirst[href*="GS"]');
            if (link) {
                link.click();
                return true;
            }
            return false;
        });

        if (!gestionaleClicked) {
            throw new Error('Impossibile trovare il link "Gestionale sportivo"');
        }
        console.log('✅ "Gestionale sportivo" cliccato!');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

        // ============================================================
        // 3. SELEZIONE DISCIPLINA "STECCA" (migliorato dal file di test)
        // ============================================================
        console.log('🔍 Selezione disciplina: STECCA...');

        const steccaClicked = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button.dtUP_sett');
            for (const btn of buttons) {
                if (btn.textContent?.trim() === 'STECCA') {
                    btn.click();
                    return true;
                }
            }
            return false;
        });

        if (!steccaClicked) {
            throw new Error('Impossibile trovare il pulsante "STECCA"');
        }
        console.log('✅ "STECCA" selezionata!');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // ============================================================
        // 4. IMPOSTA FILTRI (migliorato dal file di test)
        // ============================================================
        console.log('🔧 Impostazione filtri...');

        const filtersSet = await page.evaluate(() => {
            const filters = {
                'siNo_attivitaBase_f': '1',      // Sì
                'siNo_eventiFuturi_f': '1',      // Sì (solo futuri)
                'siNo_eventiInteresse_f': '1',   // Sì
                'statoApprovazione_f': '999',    // Tutti
                'classeevento_f': '0',           // Tutti
            };

            let count = 0;
            Object.keys(filters).forEach(name => {
                const select = document.querySelector(`select[name="${name}"]`);
                if (select) {
                    select.value = filters[name];
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    count++;
                }
            });
            return count;
        });

        console.log(`✅ ${filtersSet} filtri impostati`);

        // ============================================================
        // 5. ATTESA AGGIORNAMENTO LISTA GARE (migliorato dal file di test)
        // ============================================================
        console.log('⏳ Attesa aggiornamento lista gare...');
        await page.waitForSelector('#eventiDT tbody tr', { timeout: 15000 });
        console.log('✅ Lista gare aggiornata!');

        // ============================================================
        // 6. CERCA LA GARA NELLA LISTA (migliorato dal file di test)
        // ============================================================
        console.log('🔍 Ricerca gara:', iscrizione.gare.nome);

        const garaTrovata = await page.evaluate((nomeGara) => {
            const rows = document.querySelectorAll('#eventiDT tbody tr');
            for (const row of rows) {
                if (row.textContent.includes(nomeGara)) {
                    return row;
                }
            }
            return null;
        }, iscrizione.gare.nome);

        if (!garaTrovata) {
            throw new Error(`Gara non trovata: ${iscrizione.gare.nome}`);
        }
        console.log('✅ Gara trovata!');

        // ============================================================
        // 7. NAVIGAZIONE DIRETTA ALLA PAGINA ISCRIZIONI (migliorato dal file di test)
        // ============================================================
        const rowId = garaTrovata.id;
        const urlIscrizioni = `https://tesseramento.fibis.it/GS_accreditiEvento?idE=${rowId}`;
        console.log(`🔗 URL iscrizioni: ${urlIscrizioni}`);

        await page.goto(urlIscrizioni, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        console.log('✅ Pagina iscrizioni caricata!');

        // ============================================================
        // 8. VERIFICA STATO ISCRIZIONI (migliorato dal file di test)
        // ============================================================
        console.log('🔍 Verifica stato iscrizioni...');

        const statoIscrizioni = await page.evaluate(() => {
            const header = document.querySelector('h3.ui-accordion-header');
            return header ? header.textContent?.trim() : null;
        });

        if (statoIscrizioni === 'Iscrizioni') {
            console.log('✅ Iscrizioni APERTE! Procedo...');

            // Clicca per espandere la sezione
            await page.evaluate(() => {
                document.querySelector('h3.ui-accordion-header').click();
            });

            // ============================================================
            // 9. SELEZIONE DEL GIORNO (migliorato dal file di test)
            // ============================================================
            console.log(`📅 Selezione giorno: ${iscrizione.giorno_iscrizione}`);

            try {
                const selectGiorno = await page.waitForSelector(
                    'select[name*="giorno"], select[name*="turno"], select[id*="giorno"]',
                    { visible: true, timeout: 5000 }
                );
                if (selectGiorno) {
                    await page.select(
                        'select[name*="giorno"], select[name*="turno"], select[id*="giorno"]',
                        iscrizione.giorno_iscrizione
                    );
                    console.log('✅ Giorno selezionato!');
                } else {
                    console.log('⚠️ Select giorno non trovato');
                }
            } catch (e) {
                console.log('⚠️ Select giorno non disponibile:', e.message);
            }

            // ============================================================
            // 10. RICERCA ATLETA (migliorato dal file di test)
            // ============================================================
            console.log(`🔍 Ricerca atleta: ${iscrizione.tesserati.cognome}`);

            try {
                const inputCognome = await page.waitForSelector(
                    'input[placeholder*="cognome"], input[name*="cognome"], input[id*="cognome"]',
                    { visible: true, timeout: 5000 }
                );
                if (inputCognome) {
                    await inputCognome.type(iscrizione.tesserati.cognome, { delay: 100 });
                    console.log('✅ Cognome digitato!');

                    const btnCerca = await page.$('button[title*="Cerca"], input[value*="Cerca"], .btn-search');
                    if (btnCerca) {
                        await btnCerca.click();
                        console.log('✅ Click su "Cerca" eseguito!');
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }

                    const btnAggiungi = await page.waitForSelector(
                        'button.btn-add, a[title*="Aggiungi"], .ui-icon-plus, button[title*="Aggiungi"]',
                        { visible: true, timeout: 5000 }
                    );
                    if (btnAggiungi) {
                        await btnAggiungi.click();
                        console.log('✅ Atleta aggiunto!');
                    } else {
                        console.log('⚠️ Pulsante "Aggiungi" non trovato');
                    }
                } else {
                    console.log('⚠️ Campo cognome non trovato');
                }
            } catch (e) {
                console.log('⚠️ Errore ricerca atleta:', e.message);
            }

            // ============================================================
            // 11. SALVATAGGIO (migliorato dal file di test)
            // ============================================================
            console.log('💾 Salvataggio iscrizione...');

            try {
                const btnSalva = await page.waitForSelector(
                    'button::-p-text(Salva), input[value*="Salva"], button[title*="Salva"]',
                    { visible: true, timeout: 5000 }
                );
                if (btnSalva) {
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
                        btnSalva.click(),
                    ]);
                    console.log('✅ Iscrizione salvata!');
                } else {
                    console.log('⚠️ Pulsante "Salva" non trovato');
                }
            } catch (e) {
                console.log('⚠️ Errore salvataggio:', e.message);
            }

            // ============================================================
            // 12. AGGIORNA STATO DATABASE
            // ============================================================
            console.log('📝 Aggiornamento stato iscrizione...');
            await supabaseAdmin
                .from('iscrizioni_gare')
                .update({
                    stato: 'completata',
                    data_completamento: new Date().toISOString()
                })
                .eq('id', idIscrizione);
            console.log('✅ Stato aggiornato a "completata"');

        } else if (statoIscrizioni === 'Estrazioni') {
            console.log('⚠️ Iscrizioni CHIUSE per questa gara.');
            throw new Error('Iscrizioni chiuse');
        } else {
            console.log('❌ Stato non riconosciuto:', statoIscrizioni);
            throw new Error(`Stato iscrizioni non riconosciuto: ${statoIscrizioni}`);
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ [ISCRIZIONE WORKER] Completata in ${elapsed}s`);

        return { success: true };

    } catch (error) {
        console.error('❌ [ISCRIZIONE WORKER] Errore:', error);

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