// src/workers/iscrizioneWorker.js
import { supabaseAdmin } from '../config/supabase.js';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import { getCredenzialiPerPuppeteer } from '../controllers/credenzialiController.js';
import fs from 'fs';
import path from 'path';
dotenv.config();

// ============================================================
// CONFIGURAZIONE
// ============================================================
const PORTALE_URL = 'https://tesseramento.fibis.it';
const MAX_TENTATIVI = 3;
const TIMEOUT_ATTESA = 30000;

// Funzione helper per normalizzare i testi prima del confronto
const normalizzaTesto = (testo) => {
    if (!testo) return '';
    return testo
        .toLowerCase()
        .replace(/["'“”«»]/g, '')   // Rimuove tutte le tipologie di virgolette e apici
        .replace(/[\^°]/g, '')       // Rimuove simboli di grado/accenti
        .replace(/\s+/g, ' ')        // Riduce spazi multipli a spazio singolo
        .trim();
};

// ============================================================
// FUNZIONE DI UTILITY PER INVIARE MESSAGGI WEBSOCKET
// ============================================================
async function sendWebSocketMessage(userId, type, payload) {
    if (!userId) {
        console.log('⚠️ Nessun userId per inviare messaggio WebSocket');
        return false;
    }
    try {
        const { sendToApp } = await import('../services/websocketService.js');
        sendToApp(userId, type, payload);
        console.log(`✅ Messaggio ${type} inviato all'utente ${userId}`);
        return true;
    } catch (wsError) {
        console.log(`⚠️ Errore invio WebSocket (${type}):`, wsError.message);
        return false;
    }
}

// ============================================================
// FUNZIONE PRINCIPALE
// ============================================================
export async function eseguiIscrizioneGara(idIscrizione, userIdFromClient = null) {
    let isAborted = false;
    let iscrizioneCompletata = false;
    let workerAbortito = false;
    let faseAttuale = 'INIZIO'; // ← AGGIUNGI!
    console.log(`🔄 [ISCRIZIONE WORKER] Avvio iscrizione ${idIscrizione}...`);
    const startTime = Date.now();

    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    page.on('console', msg => console.log('🐛 [PAGE LOG]:', msg.text()));

    let iscrizione = null;
    let userId = null;
    let ultimoErrore = null;

    try {
        // 1. Recupera i dati dell'iscrizione dal database
        const { data: iscrizioneData, error: iscrizioneError } = await supabaseAdmin
            .from('iscrizioni_gare')
            .select(`
                *,
                gare (*),
                tesserati (*)
            `)
            .eq('id', idIscrizione)
            .single();

        if (iscrizioneError || !iscrizioneData) {
            throw new Error(`Iscrizione non trovata: ${idIscrizione}`);
        }
        
        iscrizione = iscrizioneData;
        
        if (userIdFromClient && !iscrizione.user_id) {
            await supabaseAdmin
                .from('iscrizioni_gare')
                .update({ user_id: userIdFromClient })
                .eq('id', idIscrizione);
            console.log(`✅ user_id aggiornato: ${userIdFromClient}`);
            const { data: updatedIscrizione } = await supabaseAdmin
                .from('iscrizioni_gare')
                .select(`*, gare (*), tesserati (*)`)
                .eq('id', idIscrizione)
                .single();
            iscrizione = updatedIscrizione;
        }
        
        userId = iscrizione.user_id || iscrizione.tesserati?.user_id;
        
        console.log(`📋 Iscrizione: ${iscrizione.id}`);
        console.log(`  - Gara: ${iscrizione.gare.nome}`);
        console.log(`  - Tesserato: ${iscrizione.tesserati.nome} ${iscrizione.tesserati.cognome}`);
        console.log(`  - Giorno: ${iscrizione.giorno_iscrizione}`);

        // 2. RECUPERA L'ASD DEL TESSERATO
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

        const credenziali = await getCredenzialiPerPuppeteer(presidente.id);
        console.log(`🔑 Credenziali recuperate per: ${credenziali.username}`);

        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

// ============================================================
// 1. LOGIN (VELOCE E DETERMINISTICO)
// ============================================================
console.log('🐛 [DEBUG] Step 1-3: 🔐 Login...');

let loginRiuscito = false;

for (let tentativo = 1; tentativo <= MAX_TENTATIVI; tentativo++) {
    // ✅ FIX: Se abortito, esci subito
    if (isAborted) {
        console.log('🛑 Worker abortito, interrompo retry login.');
        break;
    }
    
    try {
        console.log(`🔄 Tentativo login ${tentativo}/${MAX_TENTATIVI}`);
        
        await page.goto(PORTALE_URL, {
            waitUntil: 'domcontentloaded',
            timeout: 10000
        });

        await page.waitForSelector('#edit-name', { timeout: 4000, visible: true });
        
        await page.type('#edit-name', credenziali.username, { delay: 30 });
        await page.type('#edit-pass', credenziali.password, { delay: 30 });
        
        // ✅ FIX: ATOMICO - click + attesa navigazione insieme
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
            page.click('#edit-submit-1')
        ]);
        
        const urlCorrente = page.url();
        if (urlCorrente.includes('bacheca') || urlCorrente.includes('GS')) {
            loginRiuscito = true;
            console.log(`✅ Login riuscito al tentativo ${tentativo}`);
            
            try {
                await page.waitForSelector('a.expandfirst, .menu, #menu', { timeout: 4000, visible: true });
                console.log('✅ Bacheca caricata e pronta');
            } catch (e) {
                console.log('⚠️ Bacheca caricata ma elementi secondari non ancora visibili, continuo...');
            }
            break;
        }
    } catch (error) {
        ultimoErrore = error.message;
        console.log(`⚠️ Tentativo login ${tentativo} fallito: ${ultimoErrore}`);
        if (tentativo < MAX_TENTATIVI) {
            await new Promise(r => setTimeout(r, 1500 * tentativo));
        }
    }
}

if (!loginRiuscito) {
    const msg = `Login fallito dopo ${MAX_TENTATIVI} tentativi: ${ultimoErrore}`;
    console.log(`❌ ${msg}`);
    if (userId) {
        await sendWebSocketMessage(userId, 'ERRORE', { message: msg });
    }
    throw new Error(msg);
}
// ============================================================
// 2. GESTIONALE SPORTIVO (ATOMIC CLICK & NAVIGATION)
// ============================================================
console.log('🐛 [DEBUG] Step 4: 🔗 Navigazione al gestionale sportivo...');

let gestionaleRiuscito = false;
let ultimoErroreGS = null;
faseAttuale = 'NAVIGAZIONE_GS'; // ← AGGIUNGI!

for (let tentativo = 1; tentativo <= MAX_TENTATIVI; tentativo++) {
    // ✅ FIX: Se abortito, esci subito
    if (isAborted) {
        console.log('🛑 Worker abortito, interrompo retry GS.');
        break;
    }
    
    // ✅ FIX: Se l'iscrizione è già completata, ferma tutto!
    if (gestionaleRiuscito || iscrizioneCompletata) {
        console.log('🛑 Iscrizione completata o GS già aperto, interrompo retry.');
        break;
    }
    
    try {
        console.log(`🔄 Tentativo GS ${tentativo}/${MAX_TENTATIVI}`);

        // Se siamo già su GS, salta la navigazione
        if (page.url().includes('GS')) {
            console.log('✅ Pagina già su GS!');
            gestionaleRiuscito = true;
            break;
        }

        // Assicurati che il link sia visibile e pronto
        await page.waitForSelector('a.expandfirst[href*="GS"]', { timeout: 8000, visible: true });

        // ✅ FIX: ATOMICO - click + attesa navigazione insieme
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
            page.evaluate(() => {
                const link = document.querySelector('a.expandfirst[href*="GS"]');
                if (link) {
                    link.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    link.click();
                } else {
                    throw new Error('Link GS non trovato nel DOM');
                }
            })
        ]);

        // Verifica URL di destinazione
        const urlCorrente = page.url();
        if (urlCorrente.includes('GS')) {
            gestionaleRiuscito = true;
            console.log(`✅ Gestionale sportivo aperto con successo (tentativo ${tentativo})`);

            try {
                await page.waitForSelector('button.dtUP_sett, select[name="stagione_f"]', { timeout: 5000, visible: true });
                console.log('✅ Elementi GS pronti');
            } catch (e) {
                console.log('⚠️ Elementi GS non ancora visibili, proseguo comunque...');
            }

            break;
        }

    } catch (error) {
        ultimoErroreGS = error.message;
        console.log(`⚠️ Tentativo GS ${tentativo} fallito: ${ultimoErroreGS}`);

        // ✅ FIX: Se l'iscrizione è già andata avanti o completata, ferma tutto!
        if (iscrizioneCompletata || faseAttuale !== 'NAVIGAZIONE_GS') {
            console.log('🛑 Annullato retry GS: l\'iscrizione è già avanzata o completata.');
            gestionaleRiuscito = true;
            break;
        }

        if (tentativo < MAX_TENTATIVI && !gestionaleRiuscito && !iscrizioneCompletata) {
            console.log(`⏳ Attesa ${tentativo * 2}s prima del ripristino bacheca...`);
            await new Promise(r => setTimeout(r, 2000 * tentativo));
            
            if (!gestionaleRiuscito && !iscrizioneCompletata) {
                try {
                    await page.goto(`${PORTALE_URL}/bacheca`, { waitUntil: 'domcontentloaded', timeout: 8000 });
                } catch (e) {
                    console.log('⚠️ Errore ripristino bacheca:', e.message);
                }
            }
        }
    }
}

if (!gestionaleRiuscito) {
    if (page.url().includes('GS')) {
        console.log('✅ Verificato: la pagina si trova comunque su GS! Continuo...');
        gestionaleRiuscito = true;
    } else {
        const msg = `Impossibile aprire GS dopo ${MAX_TENTATIVI} tentativi: ${ultimoErroreGS || 'errore sconosciuto'}`;
        console.log(`❌ ${msg}`);
        if (userId) {
            await sendWebSocketMessage(userId, 'ERRORE', { message: msg });
        }
        throw new Error(msg);
    }
}

console.log('✅ GS pronto, continuo con STECCA...');
faseAttuale = 'SELEZIONE_STECCA'; // ← AGGIUNGI!
// ============================================================
// 3. SELEZIONE STECCA (VERIFICA CLASSE CORRETTA + CONTROLLO URL) 🚀
// ============================================================
console.log('🐛 [DEBUG] Step 5: 🔍 Selezione STECCA...');

let steccaRiuscita = false;
faseAttuale = 'SELEZIONE_STECCA'; // ← AGGIUNGI!

for (let tentativo = 1; tentativo <= MAX_TENTATIVI; tentativo++) {
    // ✅ CONTROLLO COMBINATO + FASE
    if (faseAttuale !== 'SELEZIONE_STECCA' || iscrizioneCompletata || workerAbortito) {
        console.log('🛑 Fase cambiata o iscrizione completata, interrompo retry STECCA.');
        steccaRiuscita = true;
        break; // ✅ FIX: break invece di return (per uscire dal loop, non dalla funzione)
    }
    
    // ✅ FIX: Se abortito, esci subito
    if (isAborted) {
        console.log('🛑 Worker abortito, interrompo retry STECCA.');
        break;
    }
    
    try {
        console.log(`🔄 Tentativo ${tentativo}/${MAX_TENTATIVI}`);

        // 1. Trova E CLICCA STECCA (tutto in un'unica evaluate)
        const clickRiuscito = await page.evaluate(() => {
            // Prova 1: Data attribute
            let btn = document.querySelector('button[data-disciplina="STECCA"]');
            
            // Prova 2: Classe + testo
            if (!btn) {
                const buttons = document.querySelectorAll('button.dtUP_sett');
                btn = Array.from(buttons).find(b => 
                    b.textContent?.trim().toUpperCase() === 'STECCA'
                );
            }
            
            // Prova 3: Qualsiasi button
            if (!btn) {
                const allBtns = document.querySelectorAll('button');
                btn = Array.from(allBtns).find(b => 
                    b.textContent?.trim().toUpperCase() === 'STECCA'
                );
            }
            
            // Se trovato, clicca
            if (btn) {
                btn.click();
                return true;
            }
            return false;
        });

        if (!clickRiuscito) {
            throw new Error('STECCA non trovato');
        }
        console.log('✅ Click STECCA eseguito');

        // 2. Verifica attivazione (max 5 secondi) - USANDO LA CLASSE CORRETTA!
        console.log('⏳ Attesa attivazione STECCA (classe settore_selezionato)...');
        const attivo = await page.waitForFunction(() => {
            const buttons = document.querySelectorAll('button.dtUP_sett');
            const btn = Array.from(buttons).find(b => 
                b.textContent?.trim().toUpperCase() === 'STECCA'
            );
            
            if (!btn) return false;
            
            // ✅ VERIFICA CON LA CLASSE CORRETTA: settore_selezionato
            return btn.classList.contains('settore_selezionato');
        }, { timeout: 5000 });

        if (!attivo) {
            throw new Error('STECCA non si è attivato (classe settore_selezionato non trovata)');
        }

        console.log('✅ STECCA attivo! (classe settore_selezionato trovata)');
        steccaRiuscita = true;
        break;

    } catch (error) {
        ultimoErrore = error.message;
        console.log(`⚠️ Tentativo ${tentativo} fallito: ${ultimoErrore}`);
        
        // ✅ CONTROLLO INTELLIGENTE: siamo su GS?
        if (tentativo < MAX_TENTATIVI) {
            const urlCorrente = page.url();
            
            // Se siamo su GS (non su GS_accreditiEvento), possiamo fare retry
            if (urlCorrente.includes('/GS') && !urlCorrente.includes('GS_accreditiEvento')) {
                console.log(`⏳ Ricarico prima del tentativo ${tentativo + 1}...`);
                await page.reload({ waitUntil: 'networkidle2', timeout: 10000 });
                await new Promise(r => setTimeout(r, 500));
                
                // Riapri il gestionale sportivo dopo il reload
                try {
                    await page.evaluate(() => {
                        const link = document.querySelector('a.expandfirst[href*="GS"]');
                        if (link) link.click();
                    });
                    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
                } catch (e) {
                    console.log('⚠️ Errore riapertura GS:', e.message);
                }
            } else {
                // ✅ NON siamo su GS → NON fare il retry!
                console.log(`⏳ Non sono su GS (${urlCorrente}), salto il retry`);
                // Esci dal loop senza fare retry
                break;
            }
        }
    }
}

if (!steccaRiuscita) {
    const msg = `STECCA fallito dopo ${MAX_TENTATIVI} tentativi: ${ultimoErrore}`;
    console.log(`❌ ${msg}`);
    if (userId) {
        await sendWebSocketMessage(userId, 'ERRORE', { message: msg });
    }
    throw new Error(msg);
}

faseAttuale = 'LETTURA_TURNI'; // ← AGGIUNGI DOPO IL LOOP
        // ============================================================
        // 4. IMPOSTA FILTRI (DINAMICI)
        // ============================================================
        console.log('🐛 [DEBUG] Step 6: 🔧 Impostazione filtri...');

        const tipologia = iscrizione.gare.tipologia?.toLowerCase();
        const regione = iscrizione.gare.regione;

        const filters = {
            'siNo_eventiFuturi_f': '1',
            'statoApprovazione_f': '999',
            'classeevento_f': '0',
            'stagione_f': '2026',
            'desOrganizzatore_f': '0',
            'siNo_attivitaBase_f': '2',
            'siNo_eventiInteresse_f': '2',
        };

        if (tipologia === 'istituzionale' || tipologia === 'riservata') {
            filters['desOrganizzatore_f'] = `C.R. ${regione.toUpperCase()}`;
            filters['siNo_attivitaBase_f'] = '1';
            console.log(`📌 Tipologia ${tipologia}: filtro per regione ${regione}`);
        } else if (tipologia === 'fibis challenge') {
            filters['desOrganizzatore_f'] = 'FISBB NAZIONALE';
            filters['siNo_attivitaBase_f'] = '0';
            console.log('📌 Tipologia Fibis Challenge: filtro nazionale');
        } else if (tipologia === 'libera') {
            filters['desOrganizzatore_f'] = `C.R. ${regione.toUpperCase()}`;
            filters['siNo_attivitaBase_f'] = '0';
            console.log(`📌 Tipologia Libera: filtro per regione ${regione}`);
        } else {
            console.log(`⚠️ Tipologia non riconosciuta: "${tipologia}", uso filtri base`);
        }

        const filtersSet = await page.evaluate((filters) => {
            let count = 0;
            const results = [];
            Object.keys(filters).forEach(name => {
                const select = document.querySelector(`select[name="${name}"]`);
                if (select) {
                    select.value = filters[name];
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    count++;
                    results.push({ name, newValue: filters[name] });
                }
            });
            return { count, results };
        }, filters);

        console.log(`✅ ${filtersSet.count} filtri impostati`);
        // ============================================================
// Imposta 100 elementi
await page.evaluate(() => {
    const select = document.querySelector('select[name="eventiDT_length"]');
    if (select) {
        select.value = '100';
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }
});
console.log('✅ Visualizzazione 100 elementi impostata');

// ============================================================
// 5. ATTESA CARICAMENTO LISTA GARE (SPOSTATA QUI)
// ============================================================
console.log('🐛 [DEBUG] ⏳ Attesa caricamento lista gare...');
await page.waitForSelector('#eventiDT tbody tr', { timeout: 15000 });
console.log('✅ Lista gare caricata!');

// Piccola pausa per stabilizzazione (opzionale)
await new Promise(resolve => setTimeout(resolve, 1000));

        // ============================================================
        // 6. CERCA LA GARA NELLA LISTA (CON FALLBACK) - MODIFICATO CON normalizzaTesto()
        // ============================================================
        console.log(`🐛 [DEBUG] Step 8: 🔍 Ricerca gara: "${iscrizione.gare.nome}"`);

        let idPortale = null;
        let garaTrovata = null;
        let nomeGara = iscrizione.gare.nome;

        try {
            // ✅ FIX: Normalizza il nome per il confronto
            const nomeCercatoPulito = normalizzaTesto(nomeGara);
            console.log(`📌 Nome normalizzato: "${nomeCercatoPulito}"`);
            
            await page.waitForFunction(
                (nomeCercatoPulito) => {
                    const rows = document.querySelectorAll('#eventiDT tbody tr');
                    return Array.from(rows).some(row => {
                        const testoRiga = row.textContent;
                        const testoPulito = testoRiga
                            .toLowerCase()
                            .replace(/["'“”«»]/g, '')
                            .replace(/[\^°]/g, '')
                            .replace(/\s+/g, ' ')
                            .trim();
                        return testoPulito.includes(nomeCercatoPulito);
                    });
                },
                { timeout: 10000, polling: 300 },
                nomeCercatoPulito
            );

            garaTrovata = await page.evaluate((nomeCercatoPulito) => {
                const rows = document.querySelectorAll('#eventiDT tbody tr');
                for (const row of rows) {
                    const testoRiga = row.textContent;
                    const testoPulito = testoRiga
                        .toLowerCase()
                        .replace(/["'“”«»]/g, '')
                        .replace(/[\^°]/g, '')
                        .replace(/\s+/g, ' ')
                        .trim();
                    if (testoPulito.includes(nomeCercatoPulito)) {
                        return { id: row.id, html: row.outerHTML };
                    }
                }
                return null;
            }, nomeCercatoPulito);

            console.log(`✅ Gara trovata! ID riga: ${garaTrovata?.id}`);

            if (!garaTrovata) {
                console.log('⚠️ Gara non trovata con i filtri attuali. Provo senza filtro regione...');
                
                await page.evaluate(() => {
                    const select = document.querySelector('select[name="desOrganizzatore_f"]');
                    if (select) {
                        select.value = '0';
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
                
                await page.waitForSelector('#eventiDT tbody tr', { timeout: 10000 });
                
                await page.waitForFunction(
                    (nomeCercatoPulito) => {
                        const rows = document.querySelectorAll('#eventiDT tbody tr');
                        return Array.from(rows).some(row => {
                            const testoRiga = row.textContent;
                            const testoPulito = testoRiga
                                .toLowerCase()
                                .replace(/["'“”«»]/g, '')
                                .replace(/[\^°]/g, '')
                                .replace(/\s+/g, ' ')
                                .trim();
                            return testoPulito.includes(nomeCercatoPulito);
                        });
                    },
                    { timeout: 10000, polling: 300 },
                    nomeCercatoPulito
                );

                const garaTrovataFallback = await page.evaluate((nomeCercatoPulito) => {
                    const rows = document.querySelectorAll('#eventiDT tbody tr');
                    for (const row of rows) {
                        const testoRiga = row.textContent;
                        const testoPulito = testoRiga
                            .toLowerCase()
                            .replace(/["'“”«»]/g, '')
                            .replace(/[\^°]/g, '')
                            .replace(/\s+/g, ' ')
                            .trim();
                        if (testoPulito.includes(nomeCercatoPulito)) {
                            return { id: row.id, html: row.outerHTML };
                        }
                    }
                    return null;
                }, nomeCercatoPulito);

                if (garaTrovataFallback) {
                    console.log(`✅ Gara trovata (fallback)! ID riga: ${garaTrovataFallback.id}`);
                    Object.assign(garaTrovata, garaTrovataFallback);
                }
            }

            if (!garaTrovata) {
                if (userId) {
                    await sendWebSocketMessage(userId, 'ERRORE', {
                        message: `Gara non trovata: ${iscrizione.gare.nome}`
                    });
                }
                throw new Error(`Gara non trovata: ${iscrizione.gare.nome}`);
            }

            console.log('🐛 [DEBUG] ✅ Gara trovata!');
            console.log(`🆔 ID riga: ${garaTrovata.id}`);

            if (garaTrovata.id && garaTrovata.id.startsWith('SE_')) {
                idPortale = garaTrovata.id.replace('SE_', '');
                console.log(`🔑 ID portale estratto: ${idPortale}`);
            } else {
                idPortale = garaTrovata.id;
                console.log(`🔑 ID portale: ${idPortale}`);
            }

        } catch (error) {
            const debugInfo = await page.evaluate(() => {
                const rows = document.querySelectorAll('#eventiDT tbody tr');
                return Array.from(rows).map(r => r.textContent.replace(/\s+/g, ' ').trim());
            });
            console.log('⚠️ Contenuto tabella al timeout:', debugInfo);
            
            if (userId) {
                await sendWebSocketMessage(userId, 'ERRORE', {
                    message: `Gara non trovata: ${iscrizione.gare.nome}`
                });
            }
            throw new Error(`Gara non trovata: ${iscrizione.gare.nome}`);
        }

        // ============================================================
        // 🎯 CHECK BOLLINO ISCRIZIONI (PRE-NAVIGAZIONE) - SOLO LOG
        // ============================================================
        // SCOPO ATTUALE: Questo blocco è puramente INFORMATIVO. Legge il bollino
        //                colorato della colonna "Iscrizioni" (td:eq(7)) della riga
        //                gara trovata e logga lo stato. NON blocca il flusso: 
        //                anche se il bollino è giallo/grigio/viola/rosso, il worker
        //                procede normalmente verso GS_accreditiEvento come prima.
        //
        // LEGENDA BOLLINI (dalla pagina GS - colonna "Iscrizioni", file O*.png):
        //   - Overde.png   → 🟢 Iscrizioni APERTE                 (iscrizioniAperte = true)
        //   - Ogiallo.png  → 🟡 Iscrizioni NON ANCORA APERTE      (iscrizioniAperte = false)
        //   - Oviola.png   → 🟣 PREISCRIZIONI APERTE              (iscrizioniAperte = false)
        //   - Obianco.png  → ⚪ Iscrizioni CHIUSE                  (iscrizioniAperte = false)
        //   - Orosso.png   → 🔴 Iscrizioni NON DEFINITE           (iscrizioniAperte = false)
        //
        // COME TRASFORMARLO IN CONTROLLO BLOCCANTE (futuro):
        //   1. Sostituire il solo log con un return anticipato + notifica WebSocket.
        //      Esempio:
        //        if (!statoIscrizioni.iscrizioniAperte) {
        //            if (userId) {
        //                await sendWebSocketMessage(userId, 'ERRORE', {
        //                    message: `Iscrizioni non aperte (bollino ${statoIscrizioni.colore})`
        //                });
        //            }
        //            // Aggiorna DB
        //            await supabaseAdmin
        //                .from('iscrizioni_gare')
        //                .update({
        //                    stato: 'iscrizioni_chiuse',
        //                    ultimo_errore: `Bollino ${statoIscrizioni.colore}`
        //                })
        //                .eq('id', idIscrizione);
        //            return { success: false, error: 'Iscrizioni non aperte' };
        //        }
        //   2. Oppure lanciare un throw per far gestire l'errore al catch globale:
        //        if (!statoIscrizioni.iscrizioniAperte) {
        //            throw new Error(`Iscrizioni non aperte: bollino ${statoIscrizioni.colore}`);
        //        }
        //   3. In entrambi i casi, valutare se per "viola" (preiscrizioni) sia
        //      comunque possibile procedere con una logica diversa.
        //
        // NOTE TECNICHE:
        //   - Il bollino è un <img> con src tipo "GS_shared/images/Overde.png"
        //   - La cella ha classe "cm-FULL_3" (stessa del trigger menu contestuale)
        //   - Il testo della cella include anche le date del periodo iscrizioni
        // ============================================================
        try {
            const statoIscrizioni = await page.evaluate((rowId) => {
                const row = document.getElementById(rowId);
                if (!row) return { trovato: false, motivo: 'Riga non trovata' };
                
                // La colonna "Iscrizioni" è la 7a (indice 7)
                const celle = row.querySelectorAll('td');
                const cellaIscrizioni = celle[7];
                
                if (!cellaIscrizioni) {
                    return { trovato: false, motivo: 'Cella iscrizioni non trovata', numCelle: celle.length };
                }
                
                // Cerca l'immagine del bollino
                const img = cellaIscrizioni.querySelector('img');
                const imgSrc = img ? img.getAttribute('src') : null;
                const lettera = cellaIscrizioni.querySelector('b')?.textContent?.trim() || null;
                
                // Determina il colore dal nome file
                let colore = 'sconosciuto';
                let iscrizioniAperte = false;
                
                if (imgSrc) {
                    if (imgSrc.includes('Overde')) {
                        colore = 'verde';
                        iscrizioniAperte = true;
                    } else if (imgSrc.includes('Ogiallo')) {
                        colore = 'giallo';
                    } else if (imgSrc.includes('Oviola')) {
                        colore = 'viola';
                    } else if (imgSrc.includes('Obianco')) {
                        colore = 'bianco';
                    } else if (imgSrc.includes('Orosso')) {
                        colore = 'rosso';
                    }
                }
                
                return {
                    trovato: true,
                    colore: colore,
                    iscrizioniAperte: iscrizioniAperte,
                    imgSrc: imgSrc,
                    lettera: lettera,
                    testoCompleto: cellaIscrizioni.textContent.trim()
                };
            }, garaTrovata.id);
            
            console.log('🚦 [CHECK BOLLINO] Stato iscrizioni:', JSON.stringify(statoIscrizioni, null, 2));
            
            if (statoIscrizioni.trovato) {
                if (statoIscrizioni.iscrizioniAperte) {
                    console.log(`✅ [CHECK BOLLINO] Iscrizioni APERTE (bollino ${statoIscrizioni.colore}, lettera ${statoIscrizioni.lettera})`);
                } else {
                    console.log(`⚠️ [CHECK BOLLINO] Iscrizioni NON aperte (bollino ${statoIscrizioni.colore}, lettera ${statoIscrizioni.lettera})`);
                }
            } else {
                console.log(`⚠️ [CHECK BOLLINO] Impossibile determinare stato: ${statoIscrizioni.motivo}`);
            }
        } catch (e) {
            console.log('⚠️ [CHECK BOLLINO] Errore durante il check:', e.message);
        }
        // 🎯 FINE CHECK BOLLINO - Il flusso continua come prima

// ============================================================
// 7. NAVIGAZIONE ALLA PAGINA ISCRIZIONI (ATOMIC CLICK & NAVIGATION)
// ============================================================
console.log('🐛 [DEBUG] Step 9: 🔗 Navigazione alla pagina iscrizioni...');

let navigazioneRiuscita = false;
let tentativiEffettuati = 0;

for (let tentativo = 1; tentativo <= MAX_TENTATIVI; tentativo++) {
    // ✅ FIX: Controllo combinato corretto (era commentato dentro //)
    if (iscrizioneCompletata || workerAbortito) {
        console.log('🛑 Retry navigazione ignorato: iscrizione già completata o abortita.');
        navigazioneRiuscita = true;
        break; // ✅ FIX: break invece di return
    }
    
    // ✅ FIX: Se abortito, esci subito
    if (isAborted) {
        console.log('🛑 Worker abortito, interrompo retry navigazione.');
        break;
    }
    
    tentativiEffettuati++;
    try {
        console.log(`🔄 Tentativo navigazione ${tentativo}/${MAX_TENTATIVI}`);

        // Solo al primo tentativo: scroll e apri menu
        if (tentativo === 1) {
            console.log('📌 Primo tentativo: scroll e apertura menu...');
            
            await page.evaluate((rowId) => {
                const row = document.querySelector(`#${rowId}`);
                if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, garaTrovata.id);
            await new Promise(resolve => setTimeout(resolve, 500));

            const menuAperto = await page.evaluate((rowId) => {
                const triggerEl = document.querySelector(`#${rowId} .cm-FULL_3`);
                if (!triggerEl) return false;
                
                const rect = triggerEl.getBoundingClientRect();
                const event = jQuery.Event('contextmenu', {
                    pageX: rect.left + window.scrollX + rect.width / 2,
                    pageY: rect.top + window.scrollY + rect.height / 2,
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2,
                    target: triggerEl
                });
                jQuery(triggerEl).trigger(event);
                return true;
            }, garaTrovata.id);

            if (!menuAperto) throw new Error('Impossibile aprire il menu');
            console.log('✅ Menu contestuale aperto');
            await new Promise(resolve => setTimeout(resolve, 500));
        } else {
            console.log(`📌 Tentativo ${tentativo}: riprovo il click su "Iscrizioni" (senza reload)`);
        }

        // ✅ FIX: ATOMICO - click "Iscrizioni" + attesa navigazione insieme
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: TIMEOUT_ATTESA }),
            page.evaluate((rowId) => {
                const items = Array.from(document.querySelectorAll('.context-menu-item'));
                const targetItem = items.find(item => 
                    item.textContent.trim().toLowerCase().includes('iscrizioni')
                );
                if (!targetItem) return false;
                
                const root = $(targetItem).data('contextMenuRoot');
                const key = $(targetItem).data('contextMenuKey');
                const $triggerRow = $(`#${rowId}`);
                if (!$triggerRow.length) return false;
                if (!root || !root.callback) return false;
                root.callback.call($triggerRow, key, root);
                return true;
            }, garaTrovata.id)
        ]);
        
        // Verifica URL
        const urlCorrente = page.url();
        if (urlCorrente.includes('GS_accreditiEvento') || urlCorrente.includes('accrediti')) {
            navigazioneRiuscita = true;
            console.log(`✅ Navigazione riuscita al tentativo ${tentativo}`);
            console.log(`📐 URL: ${urlCorrente}`);
            if (tentativo > 1) {
                console.log(`📊 [MONITOR] Retry necessario: ${tentativo - 1} tentativi falliti prima del successo`);
            } else {
                console.log(`📊 [MONITOR] Navigazione riuscita al primo tentativo (nessun retry)`);
            }
            break;
        } else {
            throw new Error(`URL non corretto: ${urlCorrente}`);
        }

    } catch (error) {
        console.log(`⚠️ Tentativo ${tentativo} fallito: ${error.message}`);
        
        if (tentativo < MAX_TENTATIVI) {
            console.log(`⏳ Attesa 2 secondi prima del tentativo ${tentativo + 1}...`);
            await new Promise(r => setTimeout(r, 2000));
        } else {
            console.log(`❌ [MONITOR] Tutti i ${MAX_TENTATIVI} tentativi falliti!`);
        }
    }
}

if (!navigazioneRiuscita) {
    const msg = `Impossibile aprire la pagina delle iscrizioni dopo ${MAX_TENTATIVI} tentativi`;
    console.log(`❌ ${msg}`);
    console.log(`📊 [MONITOR] Tentativi totali eseguiti: ${tentativiEffettuati} - TUTTI FALLITI!`);
    if (userId) {
        await sendWebSocketMessage(userId, 'ERRORE', { message: msg });
    }
    throw new Error(msg);
}

console.log('✅ Step 7 completato!');
console.log(`📊 [MONITOR] Riepilogo navigazione: ${tentativiEffettuati} tentativo/i, riuscita: ${navigazioneRiuscita}`);
        // ============================================================
        // 7.5 VERIFICA PRECOMPILAZIONE
        // ============================================================
        console.log('🐛 [DEBUG] Verifico se la pagina è precompilata...');

        try {
            const isPrecompilata = await page.evaluate(() => {
                const titolo = document.querySelector('h3.ui-accordion-header');
                if (!titolo) return { precompilata: false, motivo: 'Nessun header trovato' };
                
                const testoHeader = titolo.textContent.trim();
                const selectTurno = document.querySelector('select#turno_sel');
                const haSelect = !!selectTurno;
                let opzioniCount = 0;
                if (selectTurno) opzioniCount = selectTurno.options.length;
                const haAccordionI = !!document.querySelector('#accordion_I');
                
                const precompilata = haSelect && opzioniCount > 0 && haAccordionI;
                
                return {
                    precompilata: precompilata,
                    dettagli: {
                        header: testoHeader,
                        haSelect: haSelect,
                        opzioniCount: opzioniCount,
                        haAccordionI: haAccordionI
                    }
                };
            });

            console.log(`📐 Pagina precompilata? ${isPrecompilata.precompilata}`);
            console.log('📋 Dettagli:', JSON.stringify(isPrecompilata.dettagli, null, 2));

            if (!isPrecompilata.precompilata) {
                console.warn('⚠️ Attenzione: pagina NON precompilata!');
            } else {
                console.log('✅ Pagina precompilata confermata!');
            }
        } catch (error) {
            console.warn('⚠️ Errore durante verifica precompilazione:', error.message);
        }

// ============================================================
// 8. APRI LA SEZIONE E LEGGI I TURNI (CON FALLBACK)
// ============================================================
console.log('🐛 [DEBUG] Step 10: 🔍 Apro "Iscrizioni Gara" e leggo i turni...');

let sezioneAperta = false;

try {
    // ✅ PRIMO TENTATIVO: cerca "Iscrizioni Gara" (ESATTO)
    sezioneAperta = await page.evaluate(() => {
        const accordionI = document.querySelector('#accordion_I');
        if (!accordionI) return false;
        
        const headers = accordionI.querySelectorAll('h3.ui-accordion-header');
        for (const header of headers) {
            const text = header.textContent.trim();
            if (text.includes('Iscrizioni Gara')) {
                if (header.getAttribute('aria-expanded') !== 'true') {
                    header.click();
                }
                return true;
            }
        }
        return false;
    });

    if (sezioneAperta) {
        console.log('✅ Sezione "Iscrizioni Gara" aperta!');
    } else {
        // ✅ FALLBACK: cerca "Iscrizioni" (generico)
        console.log('⚠️ "Iscrizioni Gara" non trovato, provo fallback "Iscrizioni"...');
        sezioneAperta = await page.evaluate(() => {
            const accordionI = document.querySelector('#accordion_I');
            if (!accordionI) return false;
            
            const headers = accordionI.querySelectorAll('h3.ui-accordion-header');
            for (const header of headers) {
                const text = header.textContent.trim();
                if (text.includes('Iscrizioni')) {
                    if (header.getAttribute('aria-expanded') !== 'true') {
                        header.click();
                    }
                    return true;
                }
            }
            return false;
        });
        
        if (sezioneAperta) {
            console.log('✅ Fallback "Iscrizioni" aperto!');
        }
    }

    if (!sezioneAperta) {
        throw new Error('Impossibile trovare o aprire "Iscrizioni Gara" o "Iscrizioni"');
    }

    // Attendi la select dei turni
    await page.waitForSelector('select#turno_sel', { visible: true, timeout: 5000 });
    console.log('✅ Select #turno_sel visibile');

    // ... resto del codice (lettura giorni) ...

            console.log('🐛 [DEBUG] Leggo i giorni disponibili...');
            
            let giorniDisponibili = await page.evaluate(() => {
                const select = document.querySelector('select#turno_sel');
                if (!select) return [];
                
                const options = select.querySelectorAll('option');
                const giorni = [];
                options.forEach(opt => {
                    const testo = opt.textContent?.trim() || '';
                    const value = opt.value;
                    if (value && testo && !testo.includes('Esubero')) {
                        const dataMatch = testo.match(/(\d{2}\/\d{2}\/\d{4})/);
                        const data = dataMatch ? dataMatch[1] : '';
                        const postiMatch = testo.match(/(\d+)\s*posti\s*liberi/);
                        const postiLiberi = postiMatch ? postiMatch[1] : '0';
                        const orarioMatch = testo.match(/\d{2}\/\d{2}\/\d{4}\s+(\d{2}:\d{2})/);
                        const orario = orarioMatch ? orarioMatch[1] : '';
                        
                        giorni.push({
                            value: value,
                            testo: testo,
                            data: data,
                            orario: orario,
                            postiLiberi: postiLiberi
                        });
                    }
                });
                return giorni;
            });

            console.log(`📋 Trovati ${giorniDisponibili.length} giorni disponibili`);
            giorniDisponibili.forEach(g => {
                console.log(`  - ${g.data} ${g.orario}: ${g.postiLiberi} posti liberi`);
            });

            let isTuttiPieni = false;
            let messaggioEsubero = '';
            
            if (giorniDisponibili.length === 0) {
                console.log('⚠️ Nessun giorno disponibile per questa gara');
                isTuttiPieni = true;
                messaggioEsubero = 'Nessun turno disponibile per questa gara.';
            } else {
                const turniConPosti = giorniDisponibili.filter(g => parseInt(g.postiLiberi) > 0);
                if (turniConPosti.length === 0) {
                    console.log('⚠️ Tutti i turni sono pieni!');
                    isTuttiPieni = true;
                    messaggioEsubero = 'Tutti i turni sono pieni. Puoi iscriverti in esubero.';
                }
            }

await supabaseAdmin
    .from('iscrizioni_gare')
    .update({
        giorno_iscrizione: null,  // ← AGGIUNGI QUESTA RIGA!
        giorni_disponibili: JSON.stringify(giorniDisponibili),
        stato: isTuttiPieni ? 'in_attesa_esubero' : 'in_attesa_giorni'
    })
    .eq('id', idIscrizione);
console.log('✅ Giorni salvati nel database (giorno_iscrizione resettato)');

            if (userId) {
                console.log(`📤 Invio giorni via WebSocket all'utente: ${userId}`);
                console.log(`   Giorni: ${giorniDisponibili.length}, TuttiPieni: ${isTuttiPieni}`);
                
                const payload = {
                    iscrizioneId: idIscrizione,
                    giorni: giorniDisponibili,
                    tuttiPieni: isTuttiPieni
                };
                
                if (isTuttiPieni) {
                    payload.messaggio = messaggioEsubero;
                }
                
                await sendWebSocketMessage(userId, 'GIORNI_DISPONIBILI', payload);
                console.log('✅ Giorni inviati via WebSocket');
            }

                      if (isTuttiPieni) {
                // ============================================================
                // POLLING ESUBERO CON HEARTBEAT (VERSIONE OTTIMIZZATA)
                // ============================================================
                console.log('⏳ In attesa della scelta esubero dell\'utente (max 60 secondi)...');
                
                let esuberoScelto = null;
                const startTimeAttesaEsubero = Date.now();
                const maxWaitTimeEsubero = 60000;
                let pollCountEsubero = 0;
                let heartbeatCountEsubero = 0;

                while (Date.now() - startTimeAttesaEsubero < maxWaitTimeEsubero) {
                    pollCountEsubero++;
                    const elapsed = ((Date.now() - startTimeAttesaEsubero) / 1000).toFixed(1);

                    try {
                        // 1. VERIFICA URL (ogni iterazione)
                        const urlCorrente = page.url();
                        if (!urlCorrente.includes('GS_accreditiEvento') && !urlCorrente.includes('accrediti')) {
                            console.log(`❌ [POLLING ESUBERO #${pollCountEsubero}] URL non valido: ${urlCorrente}`);
                            throw new Error('Sessione scaduta - pagina reindirizzata');
                        }

                        // 2. HEARTBEAT (ogni 5 secondi)
                        heartbeatCountEsubero++;
                        if (heartbeatCountEsubero % 5 === 0) {
                            console.log(`💓 [HEARTBEAT ESUBERO #${heartbeatCountEsubero/5}] Mantenimento sessione...`);
                            
                            // Controllo leggero: il select esiste ancora nel DOM?
                            try {
                                await page.waitForSelector('select#turno_sel', { 
                                    timeout: 200
                                });
                            } catch (e) {
                                console.log(`⚠️ [HEARTBEAT ESUBERO] Select non trovato, continuo...`);
                            }
                            
                            // Scroll leggero per tenere attiva la sessione
                            await page.evaluate(() => {
                                window.scrollBy(0, 1);
                            }).catch(() => {});
                        }

                    } catch (browserErr) {
                        console.error(`❌ [POLLING ESUBERO #${pollCountEsubero}] Errore browser:`, browserErr.message);
                        
                        // Notifica via WebSocket
                        if (userId) {
                            await sendWebSocketMessage(userId, 'ERRORE', {
                                message: 'La sessione sul portale è scaduta. Per favore riprova l\'iscrizione.'
                            });
                        }
                        throw new Error(`Sessione persa durante il polling esubero: ${browserErr.message}`);
                    }

                    // 3. LETTURA DATABASE
                    console.log(`🔍 [POLLING ESUBERO #${pollCountEsubero}] Tempo: ${elapsed}s - Lettura database...`);
                    const { data: checkData, error: checkError } = await supabaseAdmin
                        .from('iscrizioni_gare')
                        .select('giorno_iscrizione, stato')
                        .eq('id', idIscrizione)
                        .single();

                    if (checkError) {
                        console.log(`⚠️ [POLLING ESUBERO #${pollCountEsubero}] Errore controllo DB:`, checkError.message);
                    } else if (checkData.giorno_iscrizione === 'Esubero' || checkData.stato === 'in_esubero') {
                        esuberoScelto = checkData.giorno_iscrizione || 'Esubero';
                        console.log(`✅ [POLLING ESUBERO #${pollCountEsubero}] ESUBERO SCELTO! (stato: ${checkData.stato})`);
                        break;
                    } else if (checkData.stato === 'annullata') {
                        console.log(`❌ [POLLING ESUBERO #${pollCountEsubero}] Iscrizione annullata dall'utente`);
                        throw new Error('Iscrizione annullata dall\'utente');
                    }

                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (!esuberoScelto) {
                    console.log('⏰ Timeout: nessuna scelta esubero entro 60 secondi');
                    throw new Error('Tempo scaduto per la scelta dell\'esubero');
                }

                // ✅ FIX: Clicca sul pulsante Esubero nel portale
                if (esuberoScelto) {
                    console.log('🔄 [WORKER] Clicco su Esubero nel portale...');
                    try {
                        await page.evaluate(() => {
                            // Cerca il pulsante Esubero
                            const btn = Array.from(document.querySelectorAll('button, a, input'))
                                .find(el => el.textContent?.toLowerCase().includes('esubero'));
                            if (btn) btn.click();
                            return !!btn;
                        });
                        console.log('✅ Click Esubero eseguito');
                        await new Promise(r => setTimeout(r, 1000));
                    } catch (e) {
                        console.log('⚠️ Errore click Esubero:', e.message);
                    }
                }
                
            } else {
                // ============================================================
                // POLLING GIORNI NORMALI CON HEARTBEAT (VERSIONE OTTIMIZZATA)
                // ============================================================
                console.log('⏳ In attesa della scelta del giorno dell\'utente (max 60 secondi)...');
                let giornoScelto = null;
                                let turnoValueScelto = null; // ✅ FIX: per il match univoco del turno
                // ✅ FIX: RIMOSSA la riga "let iscrizioneCompletata = false;" che ombreggiava il flag esterno
                const startTimeAttesa = Date.now();
                const maxWaitTime = 60000;
                let pollCount = 0;
                let heartbeatCount = 0;

                while (Date.now() - startTimeAttesa < maxWaitTime) {
                    pollCount++;
                    const elapsed = ((Date.now() - startTimeAttesa) / 1000).toFixed(1);

                    try {
                        // 1. VERIFICA URL (ogni iterazione)
                        const urlCorrente = page.url();
                        if (!urlCorrente.includes('GS_accreditiEvento') && !urlCorrente.includes('accrediti')) {
                            console.log(`❌ [POLLING #${pollCount}] URL non valido: ${urlCorrente}`);
                            throw new Error('Sessione scaduta - pagina reindirizzata');
                        }

                        // 2. HEARTBEAT (ogni 5 secondi)
                        heartbeatCount++;
                        if (heartbeatCount % 5 === 0) {
                            console.log(`💓 [HEARTBEAT #${heartbeatCount/5}] Mantenimento sessione...`);
                            
                            // Controllo leggero: il select esiste ancora nel DOM?
                            try {
                                await page.waitForSelector('select#turno_sel', { 
                                    timeout: 200
                                });
                            } catch (e) {
                                console.log(`⚠️ [HEARTBEAT] Select non trovato, continuo...`);
                            }
                            
                            // Scroll leggero per tenere attiva la sessione
                            await page.evaluate(() => {
                                window.scrollBy(0, 1);
                            }).catch(() => {});
                        }

                    } catch (browserErr) {
                        console.error(`❌ [POLLING #${pollCount}] Errore browser:`, browserErr.message);
                        
                        // Notifica via WebSocket
                        if (userId) {
                            await sendWebSocketMessage(userId, 'ERRORE', {
                                message: 'La sessione sul portale è scaduta. Per favore riprova l\'iscrizione.'
                            });
                        }
                        throw new Error(`Sessione persa durante il polling: ${browserErr.message}`);
                    }

                    // 3. LETTURA DATABASE
                    console.log(`🔍 [POLLING #${pollCount}] Tempo: ${elapsed}s - Lettura database...`);
                    const { data: checkData, error: checkError } = await supabaseAdmin
                        .from('iscrizioni_gare')
                        .select('giorno_iscrizione, turno_value, stato')
                        .eq('id', idIscrizione)
                        .single();

                    if (checkError) {
                        console.log(`⚠️ [POLLING #${pollCount}] Errore controllo DB:`, checkError.message);
                    } else {
                        console.log(`📊 [POLLING #${pollCount}] DATABASE LETTO:`);
                        console.log(`   - giorno_iscrizione: ${checkData?.giorno_iscrizione || 'null'}`);
                        console.log(`   - turno_value: ${checkData?.turno_value || 'null'}`);
                        console.log(`   - stato: ${checkData?.stato || 'null'}`);
                        
                        if (checkData.giorno_iscrizione) {
                            giornoScelto = checkData.giorno_iscrizione;
                            turnoValueScelto = checkData.turno_value;
                            // ✅ FIX: RIMOSSA la riga "iscrizioneCompletata = true;" (era quella locale, non il flag esterno)
                            console.log(`✅ [POLLING #${pollCount}] ✅ GIORNO TROVATO! ➡️ ${giornoScelto}`);
                            console.log(`   - turno_value: ${turnoValueScelto || '(nessuno)'}`);
                            console.log(`📊 [POLLING #${pollCount}] Tempo totale attesa: ${elapsed}s`);
                            break;
                        } else if (checkData.stato === 'annullata') {
                            console.log(`❌ [POLLING #${pollCount}] Iscrizione annullata dall'utente`);
                            throw new Error('Iscrizione annullata dall\'utente');
                        } else {
                            console.log(`⏳ [POLLING #${pollCount}] Giorno ancora null, attendo...`);
                        }
                    }

                    console.log(`⏳ [POLLING #${pollCount}] Attesa 1 secondo prima del prossimo poll...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
                console.log(`📊 [POLLING] POLLING TERMINATO: ${pollCount} tentativi, tempo totale: ${((Date.now() - startTimeAttesa) / 1000).toFixed(1)}s`);
                console.log(`📊 [POLLING] Giorno trovato: ${giornoScelto || 'NESSUN GIORNO TROVATO!'}`);

                if (!giornoScelto) {
                    console.log('⏰ Timeout: nessun giorno selezionato entro 60 secondi');
                    throw new Error('Tempo scaduto per la selezione del giorno');
                }

                console.log(`📅 Seleziono il giorno: ${giornoScelto}`);

                // ✅ FIX: Converti data ISO in formato italiano per il confronto
                let giornoFormattato = giornoScelto;
                if (giornoScelto && giornoScelto.includes('-')) {
                    const [yyyy, mm, dd] = giornoScelto.split('-');
                    giornoFormattato = `${dd}/${mm}/${yyyy}`;
                }

                console.log(`📌 Data formattata per confronto: ${giornoFormattato}`);
                console.log(`📌 Turno value per confronto: ${turnoValueScelto || '(nessuno)'}`);

                // ✅ FIX: Priorità al turno_value (identificatore univoco)
                let giornoSelezionato = null;

                if (turnoValueScelto) {
                    // Match per value (univoco) — PRIORITÀ MASSIMA
                    giornoSelezionato = giorniDisponibili.find(g => g.value === turnoValueScelto);
                    if (giornoSelezionato) {
                        console.log(`✅ Turno trovato per value: ${turnoValueScelto}`);
                    } else {
                        console.log(`⚠️ Turno ${turnoValueScelto} non trovato per value, provo fallback data`);
                    }
                }

                // Fallback: match per data (per retrocompatibilità o se il value manca)
                if (!giornoSelezionato) {
                    giornoSelezionato = giorniDisponibili.find(g => 
                        g.data === giornoFormattato ||
                        g.data === giornoScelto
                    );
                    if (giornoSelezionato) {
                        console.log(`✅ Turno trovato per data: ${giornoSelezionato.data} (value: ${giornoSelezionato.value})`);
                    }
                }

                if (giornoSelezionato) {
                    console.log(`✅ Giorno trovato: ${giornoSelezionato.data} (value: ${giornoSelezionato.value})`);
                    await page.select('select#turno_sel', giornoSelezionato.value);
                    console.log('✅ Giorno selezionato!');
                } else {
                    console.log(`⚠️ Giorno ${giornoScelto} non trovato. Uso il primo.`);
                    if (giorniDisponibili.length > 0) {
                        await page.select('select#turno_sel', giorniDisponibili[0].value);
                    }
                }

                // ============================================================
                // 🎯 SELEZIONE ATLETA TRAMITE MODALE #dialog-elencoIscritti
                // ============================================================
                // FLUSSO REALE FIBIS (ricavato dall'ispezione del portale):
                //   1. input.atletaIscritto è readonly → NON si può digitare
                //   2. Si clicca img.elencoIscritti → apre modale #dialog-elencoIscritti
                //   3. Nella modale ci sono i filtri #cognomeF, #nomeF, #cod_tessera
                //   4. Click #btnFiltraAtleti → ricarica DataTable #elencoAtleti
                //   5. Click su una riga <tr> di #elencoAtleti → popola input.atletaIscritto
                //      e chiude automaticamente la modale (vedi JS inline della modale)
                //   6. Ora si può cliccare Salva
                // ============================================================
                console.log('🔍 [SELEZIONE ATLETA] Apro modale elenco atleti...');
                try {
                    // 1. Click sulla lente per aprire la modale
                    await page.waitForSelector('img.elencoIscritti', { visible: true, timeout: 5000 });
                    await page.click('img.elencoIscritti');
                    console.log('✅ Click lente eseguito, attendo apertura modale...');

                    // 2. Attendi che la modale sia visibile con contenuto
                    await page.waitForFunction(() => {
                        const dlg = document.querySelector('#dialog-elencoIscritti');
                        if (!dlg) return false;
                        // Verifica che contenga la tabella degli atleti
                        return dlg.querySelector('#elencoAtleti') !== null;
                    }, { timeout: 10000 });
                    console.log('✅ Modale #dialog-elencoIscritti caricata con #elencoAtleti');

                    // 3. Compila i filtri nella modale
                    await page.waitForSelector('#cognomeF', { visible: true, timeout: 5000 });
                    await page.evaluate(() => {
                        document.querySelector('#cognomeF').value = '';
                        document.querySelector('#nomeF').value = '';
                        document.querySelector('#cod_tessera').value = '';
                    });
                    await page.type('#cognomeF', iscrizione.tesserati.cognome, { delay: 50 });
                    console.log(`✅ Cognome digitato nel filtro: ${iscrizione.tesserati.cognome}`);
                    
                    if (iscrizione.tesserati.nome) {
                        await page.type('#nomeF', iscrizione.tesserati.nome, { delay: 50 });
                        console.log(`✅ Nome digitato nel filtro: ${iscrizione.tesserati.nome}`);
                    }

                    // 4. Click su FILTRA
                    await page.click('#btnFiltraAtleti');
                    console.log('✅ Click FILTRA eseguito, attendo risultati...');

                    // 5. Attendi che la DataTable carichi i risultati (righe non vuote)
                    await page.waitForFunction(() => {
                        const righe = document.querySelectorAll('#elencoAtleti tbody tr');
                        if (righe.length === 0) return false;
                        // Se c'è la riga "Nessun tesserato soddisfa i criteri di ricerca" → non ha trovato nulla
                        const primaRiga = righe[0];
                        if (primaRiga.querySelector('.dataTables_empty')) return false;
                        return true;
                    }, { timeout: 10000 });
                    console.log('✅ DataTable #elencoAtleti ha caricato i risultati');

                    // 6. Click sulla riga dell'atleta che matcha cognome + nome
                    const atletaCliccato = await page.evaluate((cognome, nome) => {
                        const righe = document.querySelectorAll('#elencoAtleti tbody tr');
                        const cognomeLower = cognome.toLowerCase().trim();
                        const nomeLower = nome ? nome.toLowerCase().trim() : '';
                        
                        for (const riga of righe) {
                            // Salta righe vuote
                            if (riga.querySelector('.dataTables_empty')) continue;
                            
                            const testo = riga.textContent.toLowerCase();
                            // Match cognome (obbligatorio) + nome (se disponibile)
                            const matchCognome = testo.includes(cognomeLower);
                            const matchNome = nomeLower ? testo.includes(nomeLower) : true;
                            
                            if (matchCognome && matchNome) {
                                riga.click();
                                return {
                                    trovato: true,
                                    testo: riga.textContent.trim().substring(0, 200)
                                };
                            }
                        }
                        return { trovato: false };
                    }, iscrizione.tesserati.cognome, iscrizione.tesserati.nome);

                    if (!atletaCliccato.trovato) {
                        throw new Error(`Atleta non trovato nei risultati: ${iscrizione.tesserati.cognome} ${iscrizione.tesserati.nome || ''}`);
                    }
                    console.log(`✅ Atleta cliccato: ${atletaCliccato.testo}`);

                    // 7. Attendi che input.atletaIscritto sia popolato (la modale si chiude da sola)
                    await page.waitForFunction(() => {
                        const inputs = document.querySelectorAll('.atletaIscritto');
                        for (const input of inputs) {
                            if (input.value && input.value.trim() !== '') {
                                return true;
                            }
                        }
                        return false;
                    }, { timeout: 5000 });
                    
                    const valoreAtleta = await page.evaluate(() => {
                        const input = document.querySelector('.atletaIscritto');
                        return input ? input.value : null;
                    });
                    console.log(`✅ Input atleta popolato: "${valoreAtleta}"`);

                } catch (e) {
                    console.log('⚠️ Errore selezione atleta:', e.message);
                    throw new Error(`Selezione atleta fallita: ${e.message}`);
                }

                console.log('💾 Salvataggio iscrizione...');
                try {
                    const btnSalva = await page.waitForSelector('button.salvaP.show_button', { visible: true, timeout: 5000 });
                    if (btnSalva) {
                        await btnSalva.click();
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        const successo = await page.evaluate(() => {
                            const msg = document.querySelector('.message-success, .alert-success, .success');
                            return msg !== null;
                        });
                        if (successo) {
                            console.log('✅ Iscrizione salvata con successo!');
                        } else {
                            console.log('⚠️ Salvataggio eseguito ma nessun messaggio di conferma');
                        }
                    }
                } catch (e) {
                    console.log('⚠️ Errore salvataggio:', e.message);
                }
            } // ← QUESTA CHIUDE IL BLOCCO else (NON AGGIUNGERE ALTRO!)

            // ✅ FIX: Imposta il flag PRIMA di qualsiasi operazione
            iscrizioneCompletata = true;

            console.log('📝 Aggiornamento stato iscrizione...');
            await supabaseAdmin
                .from('iscrizioni_gare')
                .update({
                    stato: 'completata',
                    data_completamento: new Date().toISOString()
                })
                .eq('id', idIscrizione);
            console.log('✅ Stato aggiornato a "completata"');

            if (userId) {
                await sendWebSocketMessage(userId, 'ISCRIZIONE_COMPLETATA', {
                    iscrizioneId: idIscrizione,
                    message: 'Iscrizione completata con successo!'
                });
            }

        } catch (error) {
            console.error('❌ Errore durante il processo di iscrizione:', error);
            
            if (iscrizioneCompletata) {
                console.log('⚠️ Errore dopo il completamento, lo ignoro e termino.');
            } else {
                throw error;
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ [ISCRIZIONE WORKER] Completata in ${elapsed}s`);

        return { success: true };

    } catch (error) {
        workerAbortito = true;
        
        // ✅ IGNORA ERRORI TARDIVI
        if (iscrizioneCompletata) {
            console.log(`⚠️ Ignorato errore tardivo dopo il completamento: ${error.message}`);
            return { success: true }; // ← Non inviare errore!
        }
        
        isAborted = true;
        
        console.error('❌ [ISCRIZIONE WORKER] Errore:', error);

        if (userId) {
            await sendWebSocketMessage(userId, 'ERRORE', {
                message: 'Errore durante l\'iscrizione: ' + error.message
            });
        }

        try {
            // ✅ FIX: Crea la cartella logs se non esiste
            const logsDir = path.join(process.cwd(), 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            
            const screenshotPath = `logs/error_${idIscrizione}_${Date.now()}.png`;
            await page.screenshot({ path: screenshotPath });
            console.log(`🐛 [DEBUG] 📸 Screenshot errore salvato: ${screenshotPath}`);
        } catch (screenshotError) {
            console.log(`🐛 [DEBUG] ⚠️ Impossibile salvare screenshot: ${screenshotError.message}`);
        }

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