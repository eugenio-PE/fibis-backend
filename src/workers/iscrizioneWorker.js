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
const MAX_TENTATIVI = 3;
const TIMEOUT_ATTESA = 30000;

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
        // 1. LOGIN (CON RETRY)
        // ============================================================
        console.log('🐛 [DEBUG] Step 1-3: 🔐 Login con retry...');
        let loginRiuscito = false;
        
        for (let tentativo = 1; tentativo <= MAX_TENTATIVI; tentativo++) {
            try {
                console.log(`🔄 Tentativo login ${tentativo}/${MAX_TENTATIVI}`);
                
                await page.goto(PORTALE_URL, {
                    waitUntil: 'networkidle2',
                    timeout: TIMEOUT_ATTESA
                });
                console.log(`🐛 [DEBUG] ✅ URL caricato: ${page.url()}`);

                await page.type('#edit-name', credenziali.username);
                await page.type('#edit-pass', credenziali.password);
                await page.click('#edit-submit-1');

                await page.waitForNavigation({
                    waitUntil: 'networkidle2',
                    timeout: TIMEOUT_ATTESA
                });
                
                const urlCorrente = page.url();
                if (urlCorrente.includes('bacheca') || urlCorrente.includes('GS')) {
                    loginRiuscito = true;
                    console.log(`✅ Login riuscito al tentativo ${tentativo}`);
                    break;
                }
            } catch (error) {
                ultimoErrore = error.message;
                console.log(`⚠️ Tentativo login ${tentativo} fallito:`, error.message);
                if (tentativo < MAX_TENTATIVI) {
                    await new Promise(r => setTimeout(r, 2000 * tentativo));
                }
            }
        }

        if (!loginRiuscito) {
            const msg = `Login fallito dopo ${MAX_TENTATIVI} tentativi: ${ultimoErrore}`;
            if (userId) {
                await sendWebSocketMessage(userId, 'ERRORE', { message: msg });
            }
            throw new Error(msg);
        }

        // ============================================================
        // 2. GESTIONALE SPORTIVO (CON RETRY)
        // ============================================================
        console.log('🐛 [DEBUG] Step 4: 🔗 Navigazione al gestionale sportivo con retry...');
        let gestionaleRiuscito = false;
        
        for (let tentativo = 1; tentativo <= MAX_TENTATIVI; tentativo++) {
            try {
                console.log(`🔄 Tentativo gestionale ${tentativo}/${MAX_TENTATIVI}`);
                
                const gestionaleClicked = await page.evaluate(() => {
                    const link = document.querySelector('a.expandfirst[href*="GS"]');
                    if (link) {
                        link.click();
                        return true;
                    }
                    return false;
                });

                if (!gestionaleClicked) {
                    throw new Error('Link "Gestionale sportivo" non trovato');
                }

                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: TIMEOUT_ATTESA });
                const urlCorrente = page.url();
                if (urlCorrente.includes('/GS')) {
                    gestionaleRiuscito = true;
                    console.log(`✅ Gestionale sportivo riuscito al tentativo ${tentativo}`);
                    break;
                }
            } catch (error) {
                ultimoErrore = error.message;
                console.log(`⚠️ Tentativo gestionale ${tentativo} fallito:`, error.message);
                if (tentativo < MAX_TENTATIVI) {
                    await new Promise(r => setTimeout(r, 2000 * tentativo));
                    await page.goto(PORTALE_URL + '/bacheca', { waitUntil: 'networkidle2' });
                }
            }
        }

        if (!gestionaleRiuscito) {
            const msg = `Impossibile aprire Gestionale sportivo dopo ${MAX_TENTATIVI} tentativi: ${ultimoErrore}`;
            if (userId) {
                await sendWebSocketMessage(userId, 'ERRORE', { message: msg });
            }
            throw new Error(msg);
        }

// ============================================================
// 3. SELEZIONE DISCIPLINA "STECCA" (CON ATTESA COLORAZIONE)
// ============================================================
// ============================================================
// 3. SELEZIONE STECCA (VELOCE E SICURO) - VERSIONE RAZZO 🚀
// ============================================================
console.log('🐛 [DEBUG] Step 5: 🔍 Selezione STECCA...');

let steccaRiuscita = false;

for (let tentativo = 1; tentativo <= MAX_TENTATIVI; tentativo++) {
    try {
        console.log(`🔄 Tentativo ${tentativo}/${MAX_TENTATIVI}`);

        // 1. Trova STECCA (con fallback multipli - 2 secondi max)
        const btn = await page.evaluate(() => {
            // Prova 1: Data attribute
            let b = document.querySelector('button[data-disciplina="STECCA"]');
            if (b) return b;
            
            // Prova 2: Classe + testo
            const buttons = document.querySelectorAll('button.dtUP_sett');
            b = Array.from(buttons).find(btn => 
                btn.textContent?.trim().toUpperCase() === 'STECCA'
            );
            if (b) return b;
            
            // Prova 3: Qualsiasi button
            const allBtns = document.querySelectorAll('button');
            b = Array.from(allBtns).find(btn => 
                btn.textContent?.trim().toUpperCase() === 'STECCA'
            );
            return b || null;
        });

        if (!btn) {
            throw new Error('STECCA non trovato');
        }

        // 2. Click (veloce, senza attese)
        await page.evaluate((el) => el.click(), btn);
        console.log('✅ Click STECCA eseguito');

        // 3. Verifica attivazione (max 3 secondi)
        const attivo = await page.waitForFunction(() => {
            const b = document.querySelector('button.dtUP_sett');
            if (!b) return false;
            
            // Controlli rapidi
            return b.classList.contains('active') || 
                   b.classList.contains('selected') ||
                   b.getAttribute('aria-selected') === 'true' ||
                   document.querySelector('select[name="stagione_f"]') !== null;
        }, { timeout: 3000 });

        if (!attivo) {
            throw new Error('STECCA non si è attivato');
        }

        console.log('✅ STECCA attivo!');
        steccaRiuscita = true;
        break;

    } catch (error) {
        ultimoErrore = error.message;  // ← USA quella già dichiarata
        console.log(`⚠️ Tentativo ${tentativo} fallito: ${ultimoErrore}`);
        
        if (tentativo < MAX_TENTATIVI) {
            await page.reload({ waitUntil: 'networkidle2', timeout: 10000 });
            await new Promise(r => setTimeout(r, 500));
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
        // 6. CERCA LA GARA NELLA LISTA (CON FALLBACK)
        // ============================================================
        console.log(`🐛 [DEBUG] Step 8: 🔍 Ricerca gara: "${iscrizione.gare.nome}"`);

        let idPortale = null;
        let garaTrovata = null;

        try {
            await page.waitForFunction(
                (nomeGara) => {
                    const rows = document.querySelectorAll('#eventiDT tbody tr');
                    return Array.from(rows).some(row => row.textContent.includes(nomeGara));
                },
                { timeout: 10000, polling: 300 },
                iscrizione.gare.nome
            );

            garaTrovata = await page.evaluate((nomeGara) => {
                const rows = document.querySelectorAll('#eventiDT tbody tr');
                for (const row of rows) {
                    if (row.textContent.includes(nomeGara)) {
                        return { id: row.id, html: row.outerHTML };
                    }
                }
                return null;
            }, iscrizione.gare.nome);

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
                    (nomeGara) => {
                        const rows = document.querySelectorAll('#eventiDT tbody tr');
                        return Array.from(rows).some(row => row.textContent.includes(nomeGara));
                    },
                    { timeout: 10000, polling: 300 },
                    iscrizione.gare.nome
                );

                const garaTrovataFallback = await page.evaluate((nomeGara) => {
                    const rows = document.querySelectorAll('#eventiDT tbody tr');
                    for (const row of rows) {
                        if (row.textContent.includes(nomeGara)) {
                            return { id: row.id, html: row.outerHTML };
                        }
                    }
                    return null;
                }, iscrizione.gare.nome);

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
        // 7. NAVIGAZIONE ALLA PAGINA ISCRIZIONI (CON RETRY)
        // ============================================================
        console.log('🐛 [DEBUG] Step 9: 🔗 Navigazione alla pagina iscrizioni...');

        let navigazioneRiuscita = false;
        let tentativi = 0;
        ultimoErrore = null;

        while (tentativi < MAX_TENTATIVI && !navigazioneRiuscita) {
            tentativi++;
            console.log(`🔄 Tentativo ${tentativi}/${MAX_TENTATIVI}`);

            try {
                await page.evaluate((rowId) => {
                    const row = document.querySelector(`#${rowId}`);
                    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, garaTrovata.id);
                await new Promise(resolve => setTimeout(resolve, 1500));

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
                await new Promise(resolve => setTimeout(resolve, 500));

                const navigato = await page.evaluate((rowId) => {
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
                }, garaTrovata.id);

                if (!navigato) throw new Error('Impossibile chiamare il callback');

                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: TIMEOUT_ATTESA });
                navigazioneRiuscita = true;
                console.log(`✅ Navigazione riuscita al tentativo ${tentativi}`);
                console.log(`📐 URL: ${page.url()}`);

            } catch (error) {
                console.error(`❌ Tentativo ${tentativi} fallito:`, error.message);
                ultimoErrore = error.message;
                
                if (tentativi < MAX_TENTATIVI) {
                    await new Promise(r => setTimeout(r, 1000 * tentativi));
                    await page.reload({ waitUntil: 'networkidle2' });
                }
            }
        }

        if (!navigazioneRiuscita) {
            if (userId) {
                await sendWebSocketMessage(userId, 'ERRORE', {
                    message: `Impossibile aprire la pagina delle iscrizioni dopo ${MAX_TENTATIVI} tentativi: ${ultimoErrore || 'errore sconosciuto'}`
                });
            }
            throw new Error(`Impossibile navigare alla pagina iscrizioni dopo ${MAX_TENTATIVI} tentativi`);
        }

        console.log('✅ Step 7 completato!');

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
        // 8. APRI LA SEZIONE E LEGGI I TURNI
        // ============================================================
        console.log('🐛 [DEBUG] Step 10: 🔍 Apro "Iscrizioni Gara" e leggo i turni...');

        try {
            const sezioneAperta = await page.evaluate(() => {
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

            if (!sezioneAperta) {
                throw new Error('Impossibile trovare o aprire "Iscrizioni Gara"');
            }
            console.log('✅ Sezione "Iscrizioni Gara" aperta!');

            await page.waitForSelector('select#turno_sel', { visible: true, timeout: 5000 });
            console.log('✅ Select #turno_sel visibile');

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
                    giorni_disponibili: JSON.stringify(giorniDisponibili),
                    stato: isTuttiPieni ? 'in_attesa_esubero' : 'in_attesa_giorni'
                })
                .eq('id', idIscrizione);
            console.log('✅ Giorni salvati nel database');

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
                console.log('⏳ In attesa della scelta esubero dell\'utente (max 60 secondi)...');
                
                let esuberoScelto = null;
                const startTimeAttesaEsubero = Date.now();
                const maxWaitTimeEsubero = 60000;

                while (Date.now() - startTimeAttesaEsubero < maxWaitTimeEsubero) {
                    const { data: checkData, error: checkError } = await supabaseAdmin
                        .from('iscrizioni_gare')
                        .select('giorno_iscrizione, stato')
                        .eq('id', idIscrizione)
                        .single();

                    if (checkError) {
                        console.log('⚠️ Errore controllo DB:', checkError.message);
                    } else if (checkData.giorno_iscrizione === 'Esubero') {
                        esuberoScelto = checkData.giorno_iscrizione;
                        console.log(`✅ Esubero scelto dall'utente!`);
                        break;
                    } else if (checkData.stato === 'annullata') {
                        console.log('❌ Iscrizione annullata dall\'utente');
                        throw new Error('Iscrizione annullata dall\'utente');
                    }

                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (!esuberoScelto) {
                    console.log('⏰ Timeout: nessuna scelta esubero entro 60 secondi');
                    throw new Error('Tempo scaduto per la scelta dell\'esubero');
                }
            } else {
                console.log('⏳ In attesa della scelta del giorno dell\'utente (max 60 secondi)...');
                let giornoScelto = null;
                const startTimeAttesa = Date.now();
                const maxWaitTime = 60000;

                while (Date.now() - startTimeAttesa < maxWaitTime) {
                    const { data: checkData, error: checkError } = await supabaseAdmin
                        .from('iscrizioni_gare')
                        .select('giorno_iscrizione, stato')
                        .eq('id', idIscrizione)
                        .single();

                    if (checkError) {
                        console.log('⚠️ Errore controllo DB:', checkError.message);
                    } else if (checkData.giorno_iscrizione) {
                        giornoScelto = checkData.giorno_iscrizione;
                        console.log(`✅ Giorno scelto dall'utente: ${giornoScelto}`);
                        break;
                    } else if (checkData.stato === 'annullata') {
                        console.log('❌ Iscrizione annullata dall\'utente');
                        throw new Error('Iscrizione annullata dall\'utente');
                    }

                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (!giornoScelto) {
                    console.log('⏰ Timeout: nessun giorno selezionato entro 60 secondi');
                    throw new Error('Tempo scaduto per la selezione del giorno');
                }

                console.log(`📅 Seleziono il giorno: ${giornoScelto}`);
                const giornoSelezionato = giorniDisponibili.find(g => 
                    g.data === giornoScelto || g.value === giornoScelto
                );

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

                console.log('🔍 Ricerca atleta...');
                try {
                    const inputAtleta = await page.waitForSelector('input.atletaIscritto', { visible: true, timeout: 5000 });
                    if (inputAtleta) {
                        await inputAtleta.type(iscrizione.tesserati.cognome, { delay: 100 });
                        console.log(`✅ Cognome digitato: ${iscrizione.tesserati.cognome}`);
                        
                        const lente = await page.waitForSelector('img.elencoIscritti', { visible: true, timeout: 5000 });
                        if (lente) {
                            await lente.click();
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                        
                        try {
                            const atletaTrovato = await page.waitForSelector(
                                'table tbody tr:first-child, .ui-menu-item, .autocomplete-item',
                                { visible: true, timeout: 3000 }
                            );
                            if (atletaTrovato) {
                                await atletaTrovato.click();
                                console.log('✅ Atleta selezionato!');
                            }
                        } catch (e) {
                            console.log('⚠️ Nessun atleta trovato');
                        }
                    }
                } catch (e) {
                    console.log('⚠️ Errore ricerca atleta:', e.message);
                }

                console.log('💾 Salvataggio iscrizione...');
                try {
                    const btnSalva = await page.waitForSelector('button.salvaP.show_button', { visible: true, timeout: 5000 });
                    if (btnSalva) {
                        await Promise.all([
                            page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
                            btnSalva.click()
                        ]);
                        console.log('✅ Iscrizione salvata!');
                    }
                } catch (e) {
                    console.log('⚠️ Errore salvataggio:', e.message);
                }
            }

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
            throw error;
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ [ISCRIZIONE WORKER] Completata in ${elapsed}s`);

        return { success: true };

    } catch (error) {
        console.error('❌ [ISCRIZIONE WORKER] Errore:', error);

        if (userId) {
            await sendWebSocketMessage(userId, 'ERRORE', {
                message: 'Errore durante l\'iscrizione: ' + error.message
            });
        }

        try {
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