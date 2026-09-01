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
export async function eseguiIscrizioneGara(idIscrizione, userIdFromClient = null) {
    console.log(`🔄 [ISCRIZIONE WORKER] Avvio iscrizione ${idIscrizione}...`);
    const startTime = Date.now();

    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // ✅ Aggiungi il debug dei log della pagina
    page.on('console', msg => console.log('🐛 [PAGE LOG]:', msg.text()));

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
        // ✅ AGGIUNGI: se userIdFromClient è passato, aggiorna user_id
        if (userIdFromClient && !iscrizione.user_id) {
            await supabaseAdmin
                .from('iscrizioni_gare')
                .update({ user_id: userIdFromClient })
                .eq('id', idIscrizione);
            console.log(`✅ user_id aggiornato: ${userIdFromClient}`);
            // Ricarica l'iscrizione per avere il nuovo user_id
            const { data: updatedIscrizione } = await supabaseAdmin
                .from('iscrizioni_gare')
                .select(`*, gare (*), tesserati (*)`)
                .eq('id', idIscrizione)
                .single();
            Object.assign(iscrizione, updatedIscrizione);
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

        // ✅ Imposta viewport e User-Agent reali
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // ============================================================
        // 1. LOGIN
        // ============================================================
        console.log('🐛 [DEBUG] Step 1: 🌐 Navigazione al portale...');
        await page.goto(PORTALE_URL, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        console.log(`🐛 [DEBUG] ✅ URL caricato: ${page.url()}`);

        console.log('🐛 [DEBUG] Step 2: 👤 Inserimento credenziali...');
        const usernameField = await page.$('#edit-name');
        console.log(`🐛 [DEBUG] Campo username trovato: ${!!usernameField}`);
        await page.type('#edit-name', credenziali.username);
        
        const passwordField = await page.$('#edit-pass');
        console.log(`🐛 [DEBUG] Campo password trovato: ${!!passwordField}`);
        await page.type('#edit-pass', credenziali.password);
        
        const submitButton = await page.$('#edit-submit-1');
        console.log(`🐛 [DEBUG] Pulsante submit trovato: ${!!submitButton}`);
        await page.click('#edit-submit-1');

        console.log('🐛 [DEBUG] Step 3: ⏳ Attesa login...');
        await page.waitForNavigation({
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        console.log(`🐛 [DEBUG] ✅ Login completato! URL attuale: ${page.url()}`);
        console.log('✅ Login completato!');

        // ============================================================
        // 2. GESTIONALE SPORTIVO
        // ============================================================
        console.log('🐛 [DEBUG] Step 4: 🔗 Navigazione al gestionale sportivo...');
        console.log('🐛 [DEBUG] Cerco link a.expandfirst[href*="GS"]...');

        const gestionaleClicked = await page.evaluate(() => {
            const link = document.querySelector('a.expandfirst[href*="GS"]');
            if (link) {
                console.log(`🐛 [DEBUG] Link trovato: ${link.href}`);
                link.click();
                return true;
            }
            console.log('🐛 [DEBUG] ❌ Link NON TROVATO!');
            return false;
        });

        if (!gestionaleClicked) {
            throw new Error('Impossibile trovare il link "Gestionale sportivo"');
        }
        console.log('🐛 [DEBUG] ✅ "Gestionale sportivo" cliccato!');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        console.log(`🐛 [DEBUG] URL dopo navigation: ${page.url()}`);
        console.log('✅ "Gestionale sportivo" cliccato!');

        // ============================================================
        // 3. SELEZIONE DISCIPLINA "STECCA"
        // ============================================================
        console.log('🐛 [DEBUG] Step 5: 🔍 Selezione disciplina: STECCA...');

        const steccaClicked = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button.dtUP_sett');
            console.log(`🐛 [DEBUG] Trovati ${buttons.length} pulsanti disciplina`);
            for (const btn of buttons) {
                const text = btn.textContent?.trim();
                console.log(`🐛 [DEBUG] Pulsante trovato: "${text}"`);
                if (text === 'STECCA') {
                    console.log('🐛 [DEBUG] ✅ Trovato pulsante STECCA! Click...');
                    btn.click();
                    return true;
                }
            }
            console.log('🐛 [DEBUG] ❌ Pulsante STECCA NON TROVATO!');
            return false;
        });

        if (!steccaClicked) {
            throw new Error('Impossibile trovare il pulsante "STECCA"');
        }
        console.log('🐛 [DEBUG] ✅ "STECCA" selezionata!');
        console.log('✅ "STECCA" selezionata!');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // ============================================================
        // 4. IMPOSTA FILTRI (DINAMICI)
        // ============================================================
        console.log('🐛 [DEBUG] Step 6: 🔧 Impostazione filtri...');

        // 🔹 1. RECUPERA INFO DAL DATABASE (case-insensitive)
        const tipologia = iscrizione.gare.tipologia?.toLowerCase();
        const regione = iscrizione.gare.regione;

        // 🔹 2. FILTRI DI BASE (validi per tutti)
        const filters = {
            'siNo_eventiFuturi_f': '1',        // Solo eventi futuri
            'statoApprovazione_f': '999',      // Tutti gli stati
            'classeevento_f': '0',             // Tutti i livelli
            'stagione_f': '2026',              // Stagione corrente
            'desOrganizzatore_f': '0',         // Default: nessun filtro
            'siNo_attivitaBase_f': '2',        // Default: No
            'siNo_eventiInteresse_f': '2',     // Default: No
        };

        // 🔹 3. FILTRI IN BASE ALLA TIPOLOGIA (case-insensitive)
        if (tipologia === 'istituzionale' || tipologia === 'riservata') {
            // Istituzionale/Riservata → filtro per regione + attività di base
            filters['desOrganizzatore_f'] = `C.R. ${regione.toUpperCase()}`;
            filters['siNo_attivitaBase_f'] = '1';  // Sì (attività di base)
            console.log(`📌 Tipologia ${tipologia}: filtro per regione ${regione}`);
        } else if (tipologia === 'fibis challenge') {
            // Fibis Challenge → nazionale (nessun filtro regione)
            filters['desOrganizzatore_f'] = 'FISBB NAZIONALE';
            filters['siNo_attivitaBase_f'] = '0';  // No
            console.log('📌 Tipologia Fibis Challenge: filtro nazionale');
        } else if (tipologia === 'libera') {
            // Libera → filtro per regione + attività di base NO
            filters['desOrganizzatore_f'] = `C.R. ${regione.toUpperCase()}`;
            filters['siNo_attivitaBase_f'] = '0';  // No
            console.log(`📌 Tipologia Libera: filtro per regione ${regione}`);
        } else {
            // Fallback: se tipologia non riconosciuta, usa filtri base
            console.log(`⚠️ Tipologia non riconosciuta: "${tipologia}", uso filtri base`);
        }

        // 🔹 4. IMPOSTA FILTRI NEL BROWSER
        const filtersSet = await page.evaluate((filters) => {
            let count = 0;
            const results = [];
            Object.keys(filters).forEach(name => {
                const select = document.querySelector(`select[name="${name}"]`);
                if (select) {
                    const oldValue = select.value;
                    select.value = filters[name];
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    count++;
                    results.push({ name, oldValue, newValue: filters[name] });
                } else {
                    console.log(`🐛 [DEBUG] ❌ Filtro ${name} NON TROVATO!`);
                }
            });
            return { count, results };
        }, filters);

        console.log(`✅ ${filtersSet.count} filtri impostati`);
        console.log('📊 Dettaglio filtri:', filtersSet.results);
        // 🔹 5. IMPOSTA VISUALIZZAZIONE 100 ELEMENTI
        console.log('🐛 [DEBUG] Imposto visualizzazione 100 elementi...');
        await page.evaluate(() => {
            const select = document.querySelector('select[name="eventiDT_length"]');
            if (select) {
                select.value = '100';
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            return false;
        });
        console.log('✅ Visualizzazione 100 elementi impostata');

        // ============================================================
        // 5. ATTESA AGGIORNAMENTO LISTA GARE
        // ============================================================
        console.log('🐛 [DEBUG] Step 7: ⏳ Attesa aggiornamento lista gare...');
        await page.waitForSelector('#eventiDT tbody tr', { timeout: 15000 });
        console.log('🐛 [DEBUG] ✅ Lista gare aggiornata!');
        console.log('✅ Lista gare aggiornata!');

        // ============================================================
        // 6. CERCA LA GARA NELLA LISTA (CON waitForFunction)
        // ============================================================
        console.log(`🐛 [DEBUG] Step 8: 🔍 Ricerca gara: "${iscrizione.gare.nome}"`);

        let idPortale = null; // ✅ DICHIARATO QUI (fuori dal try)

        try {
            // Attendi che la gara appaia nella tabella
            await page.waitForFunction(
                (nomeGara) => {
                    const rows = document.querySelectorAll('#eventiDT tbody tr');
                    return Array.from(rows).some(row => row.textContent.includes(nomeGara));
                },
                { timeout: 10000, polling: 300 },
                iscrizione.gare.nome
            );

            // Estrai i dati
            const garaTrovata = await page.evaluate((nomeGara) => {
                const rows = document.querySelectorAll('#eventiDT tbody tr');
                for (const row of rows) {
                    if (row.textContent.includes(nomeGara)) {
                        return { id: row.id, html: row.outerHTML };
                    }
                }
                return null;
            }, iscrizione.gare.nome);

            console.log(`✅ Gara trovata! ID riga: ${garaTrovata.id}`);

            // FALLBACK: se non trovata, prova a rimuovere il filtro regione
            if (!garaTrovata) {
                console.log('⚠️ Gara non trovata con i filtri attuali. Provo senza filtro regione...');
                
                // Rimuovi il filtro regione (desOrganizzatore_f = 0)
                await page.evaluate(() => {
                    const select = document.querySelector('select[name="desOrganizzatore_f"]');
                    if (select) {
                        select.value = '0';
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                    return false;
                });
                
                // Attendine il ricaricamento
                await page.waitForSelector('#eventiDT tbody tr', { timeout: 10000 });
                
                // Riprova a cercare con waitForFunction
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
                    // Assegna alla variabile garaTrovata
                    Object.assign(garaTrovata, garaTrovataFallback);
                }
            }

            if (!garaTrovata) {
                throw new Error(`Gara non trovata: ${iscrizione.gare.nome}`);
            }

            console.log('🐛 [DEBUG] ✅ Gara trovata!');
            console.log(`🆔 ID riga: ${garaTrovata.id}`);

            // ✅ Estrai l'ID dal formato "SE_XXXXX" (SENZA let, perché già dichiarato)
            if (garaTrovata.id && garaTrovata.id.startsWith('SE_')) {
                idPortale = garaTrovata.id.replace('SE_', '');
                console.log(`🔑 ID portale estratto: ${idPortale}`);
            } else {
                idPortale = garaTrovata.id;
                console.log(`🔑 ID portale: ${idPortale}`);
            }

        } catch (error) {
            // Se va in timeout, logga lo stato della tabella
            const debugInfo = await page.evaluate(() => {
                const rows = document.querySelectorAll('#eventiDT tbody tr');
                return Array.from(rows).map(r => r.textContent.replace(/\s+/g, ' ').trim());
            });
            console.log('⚠️ Contenuto tabella al timeout:', debugInfo);
            throw new Error(`Gara non trovata: ${iscrizione.gare.nome}`);
        }

        // ============================================================
        // 7. NAVIGAZIONE DIRETTA ALLA PAGINA ISCRIZIONI
        // ============================================================
        console.log('🐛 [DEBUG] Step 9: 🔗 Navigazione alla pagina iscrizioni...');
        const urlIscrizioni = `https://tesseramento.fibis.it/GS_accreditiEvento?idE=${idPortale}`;
        console.log(`🔗 URL iscrizioni: ${urlIscrizioni}`);

        await page.goto(urlIscrizioni, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        console.log(`🐛 [DEBUG] ✅ Pagina iscrizioni caricata! URL: ${page.url()}`);
        console.log('✅ Pagina iscrizioni caricata!');

        // ✅ Aspetta che la pagina sia completamente caricata
        await page.waitForSelector('h3.ui-accordion-header', { timeout: 10000 });
        console.log('✅ Sezione iscrizioni trovata');

        // ============================================================
        // 8. VERIFICA STATO ISCRIZIONI
        // ============================================================
        console.log('🐛 [DEBUG] Step 10: 🔍 Verifica stato iscrizioni...');

        const statoIscrizioni = await page.evaluate(() => {
            const header = document.querySelector('h3.ui-accordion-header');
            const text = header ? header.textContent?.trim() : null;
            console.log(`🐛 [DEBUG] Stato iscrizioni trovato: "${text}"`);
            return text;
        });

        if (statoIscrizioni === 'Iscrizioni') {
            console.log('🐛 [DEBUG] ✅ Iscrizioni APERTE!');
            console.log('✅ Iscrizioni APERTE! Procedo...');

            // Clicca per espandere la sezione
            console.log('🐛 [DEBUG] Espando la sezione...');
            await page.evaluate(() => {
                const header = document.querySelector('h3.ui-accordion-header');
                if (header) {
                    header.click();
                    console.log('🐛 [DEBUG] ✅ Click su header eseguito!');
                } else {
                    console.log('🐛 [DEBUG] ❌ Header non trovato!');
                }
            });
            console.log('🐛 [DEBUG] ✅ Sezione espansa!');
            await new Promise(resolve => setTimeout(resolve, 1000));

            // ============================================================
            // 9. LEGGI I GIORNI DISPONIBILI DAL PORTALE
            // ============================================================
            console.log('🐛 [DEBUG] Step 11: 📋 Leggo i giorni disponibili...');

            const giorniDisponibili = await page.evaluate(() => {
                const select = document.querySelector('select#turno_sel');
                if (!select) {
                    console.log('🐛 [DEBUG] ❌ Select #turno_sel non trovato!');
                    return [];
                }

                const options = select.querySelectorAll('option');
                const giorni = [];
                options.forEach(opt => {
                    const testo = opt.textContent?.trim() || '';
                    const value = opt.value;
                    if (value && testo && !testo.includes('Esubero')) {
                        giorni.push({
                            value: value,
                            testo: testo,
                            data: testo.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1] || '',
                            postiLiberi: testo.match(/(\d+)\s*posti\s*liberi/)?.[1] || '0'
                        });
                    }
                });
                console.log(`🐛 [DEBUG] Trovati ${giorni.length} giorni validi`);
                return giorni;
            });

            console.log(`🐛 [DEBUG] 📊 Trovati ${giorniDisponibili.length} giorni disponibili:`);
            giorniDisponibili.forEach(g => {
                console.log(`🐛 [DEBUG]   - ${g.data}: ${g.postiLiberi} posti liberi (value: ${g.value})`);
            });

            // ============================================================
            // ✅ NOVITÀ: SALVA I GIORNI E INVIA VIA WEBSOCKET
            // ============================================================
            
            // 1. SALVA NEL DATABASE
            console.log('📝 Salvo i giorni disponibili nel database...');
            await supabaseAdmin
                .from('iscrizioni_gare')
                .update({
                    giorni_disponibili: JSON.stringify(giorniDisponibili),
                    stato: 'in_attesa_giorni'
                })
                .eq('id', idIscrizione);
            console.log('✅ Giorni salvati nel database');

            // 2. INVIA I GIORNI ALL'APP VIA WEBSOCKET
            const userId = iscrizione.user_id || iscrizione.tesserati?.user_id;
            if (userId) {
                console.log(`📤 Invio giorni via WebSocket all'utente: ${userId}`);
                try {
                    const { sendToApp } = await import('../services/websocketService.js');
                    sendToApp(userId, 'GIORNI_DISPONIBILI', {
                        iscrizioneId: idIscrizione,
                        giorni: giorniDisponibili
                    });
                    console.log('✅ Giorni inviati via WebSocket');
                } catch (wsError) {
                    console.log('⚠️ Errore invio WebSocket:', wsError.message);
                }
            } else {
                console.log('⚠️ Nessun user_id trovato per l\'iscrizione');
            }

            // 3. ATTENDI LA SCELTA DELL'UTENTE (POLLING DB)
            console.log('⏳ In attesa della scelta dell\'utente (max 60 secondi)...');
            let giornoScelto = null;
            const startTime = Date.now();
            const maxWaitTime = 60000; // 60 secondi

            while (Date.now() - startTime < maxWaitTime) {
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
                }

                // Attendi 1 secondo prima di ricontrollare
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            if (!giornoScelto) {
                console.log('⏰ Timeout: nessun giorno selezionato entro 60 secondi');
                throw new Error('Timeout attesa scelta utente');
            }

            // ============================================================
            // 10. SELEZIONA IL GIORNO SCELTO
            // ============================================================
            console.log(`📅 Seleziono il giorno: ${giornoScelto}`);

            // Cerca il value corrispondente al giorno scelto
            const giornoSelezionato = giorniDisponibili.find(g => 
                g.data === giornoScelto || g.value === giornoScelto
            );

            if (giornoSelezionato) {
                console.log(`✅ Giorno trovato: ${giornoSelezionato.data} (value: ${giornoSelezionato.value})`);
                await page.select('select#turno_sel', giornoSelezionato.value);
                console.log('✅ Giorno selezionato!');
            } else {
                console.log(`⚠️ Giorno ${giornoScelto} non trovato tra quelli disponibili. Usa il primo.`);
                if (giorniDisponibili.length > 0) {
                    await page.select('select#turno_sel', giorniDisponibili[0].value);
                    console.log(`✅ Selezionato il primo giorno: ${giorniDisponibili[0].data}`);
                }
            }

            // ============================================================
            // 11. RICERCA E SELEZIONE ATLETA
            // ============================================================
            console.log('🐛 [DEBUG] Step 12: 🔍 Ricerca atleta...');
            console.log(`🔍 Ricerca atleta: ${iscrizione.tesserati.cognome}`);

            try {
                const inputAtleta = await page.waitForSelector(
                    'input.atletaIscritto',
                    { visible: true, timeout: 5000 }
                );
                if (inputAtleta) {
                    console.log('🐛 [DEBUG] ✅ Campo atleta trovato!');
                    await inputAtleta.type(iscrizione.tesserati.cognome, { delay: 100 });
                    console.log(`🐛 [DEBUG] Cognome digitato: ${iscrizione.tesserati.cognome}`);
                    console.log('✅ Cognome digitato!');

                    const lente = await page.waitForSelector(
                        'img.elencoIscritti',
                        { visible: true, timeout: 5000 }
                    );
                    if (lente) {
                        console.log('🐛 [DEBUG] ✅ Lente di ingrandimento trovata!');
                        await lente.click();
                        console.log('✅ Click sulla lente di ingrandimento eseguito!');
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } else {
                        console.log('⚠️ Lente di ingrandimento non trovata');
                    }

                    try {
                        const atletaTrovato = await page.waitForSelector(
                            'table tbody tr:first-child, .ui-menu-item, .autocomplete-item, #elencoAtleti tr:first-child',
                            { visible: true, timeout: 3000 }
                        );
                        if (atletaTrovato) {
                            await atletaTrovato.click();
                            console.log('✅ Atleta selezionato!');
                        }
                    } catch (e) {
                        console.log('⚠️ Nessun atleta trovato o selezione automatica');
                    }
                } else {
                    console.log('⚠️ Campo atleta non trovato');
                }
            } catch (e) {
                console.log('⚠️ Errore ricerca atleta:', e.message);
            }

            // ============================================================
            // 12. SALVATAGGIO
            // ============================================================
            console.log('💾 Salvataggio iscrizione...');

            try {
                const btnSalva = await page.waitForSelector(
                    'button.salvaP.show_button',
                    { visible: true, timeout: 5000 }
                );
                if (btnSalva) {
                    console.log('🐛 [DEBUG] ✅ Pulsante "Salva" trovato!');
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
            // 13. AGGIORNA STATO DATABASE
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

            // ✅ NOTIFICA COMPLETAMENTO VIA WEBSOCKET
            if (userId) {
                try {
                    const { sendToApp } = await import('../services/websocketService.js');
                    sendToApp(userId, 'ISCRIZIONE_COMPLETATA', {
                        iscrizioneId: idIscrizione,
                        message: 'Iscrizione completata con successo!'
                    });
                    console.log('📤 Notifica completamento inviata via WebSocket');
                } catch (wsError) {
                    console.log('⚠️ Errore invio notifica completamento:', wsError.message);
                }
            }

        } else if (statoIscrizioni === 'Estrazioni') {
            console.log('🐛 [DEBUG] ⚠️ Iscrizioni CHIUSE per questa gara.');
            console.log('⚠️ Iscrizioni CHIUSE per questa gara.');
            throw new Error('Iscrizioni chiuse');
        } else {
            console.log(`🐛 [DEBUG] ❌ Stato non riconosciuto: ${statoIscrizioni}`);
            console.log('❌ Stato non riconosciuto:', statoIscrizioni);
            throw new Error(`Stato iscrizioni non riconosciuto: ${statoIscrizioni}`);
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ [ISCRIZIONE WORKER] Completata in ${elapsed}s`);

        return { success: true };

    } catch (error) {
        console.error('❌ [ISCRIZIONE WORKER] Errore:', error);

        // Salvo screenshot dell'errore per debug
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

