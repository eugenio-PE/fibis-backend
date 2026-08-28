// src/workers/risultatiScraperTest2.js
import { supabaseAdmin } from '../config/supabase.js';
import puppeteer from 'puppeteer';

// ============================================================
// 🔧 MODALITÀ TEST - MODIFICA SOLO QUESTE 2 RIGHE!
// ============================================================
const TEST_MODE = true;
const TEST_GARA_ID = 763;
// ============================================================

// ============================================================
// CONFIGURAZIONE ROBUSTA
// ============================================================
const BASE_URL = 'https://www.fibis.it/stecca/fibis-gare-stecca.html';

const CONFIG = {
    DELAY: {
        SHORT: 2000,
        MEDIUM: 3000,
        LONG: 5000,
        EXTRA: 8000,
    },
    TIMEOUT: {
        NAVIGATION: 60000,
        SELECTOR: 15000,
    },
    RETRY: {
        MAX: 3,
        DELAY: 2000,
    },
    BATTERIE: {
        LIMITE: 50,
    },
};

// ============================================================
// MAPPE
// ============================================================
const MAPPA_FASI = {
    'finale': 1,
    'semifinali': 2,
    'quarti di finale': 3,
    'ottavi di finale': 4,
    'sedicesimi di finale': 5,
    'trentaduesimi di finale': 6,
    'sessantaquattresimi di finale': 7,
    'centoventottesimi di finale': 8,
    'duecentocinquantaseiesimi di finale': 9,
    'spareggi': 10,
    'batterie': 11,
};

const MAPPA_CATEGORIE = {
    'MASTER': 'M',
    'NAZIONALEPRO': 'NP',
    'NAZIONALE': 'N',
    'PRIMA': '1ª',
    'SECONDA': '2ª',
    'TERZA': '3ª',
};

// ============================================================
// 🔥 FUNZIONE PER CONVERTIRE DATA DD/MM/YYYY → YYYY-MM-DD
// ============================================================
function convertiData(dataStr) {
    if (!dataStr) return null;
    const parts = dataStr.split('/');
    if (parts.length !== 3) return null;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

// ============================================================
// SEZIONE COMITATI E TIPOLOGIE
// ============================================================
const TIPOLOGIE = [
    { id: '2', nome: 'Fibis Challenge', hasComitato: false, btn: '#btn_internazionale' },
    { id: '4', nome: 'Istituzionale', hasComitato: true, btn: '#btn_istituzionale' },
    { id: '5', nome: 'Libera', hasComitato: true, btn: '#btn_libera' },
    { id: '6', nome: 'Riservata', hasComitato: true, btn: '#btn_riservata' },
];

const COMITATI = [
    { id: '3', nome: 'Abruzzo-Molise' },
    { id: '17', nome: 'Calabria' },
    { id: '4', nome: 'Campania' },
    { id: '5', nome: 'Emilia Romagna' },
    { id: '18', nome: 'Friuli Venezia Giulia' },
    { id: '6', nome: 'Lazio' },
    { id: '8', nome: 'Liguria' },
    { id: '2', nome: 'Lombardia' },
    { id: '7', nome: 'Marche' },
    { id: '9', nome: 'Piemonte - Valle d\'Aosta' },
    { id: '10', nome: 'Puglia - Basilicata' },
    { id: '11', nome: 'Sardegna' },
    { id: '12', nome: 'Sicilia' },
    { id: '13', nome: 'Toscana' },
    { id: '14', nome: 'Umbria' },
    { id: '15', nome: 'Veneto - Trentino Alto Adige' },
];

// ============================================================
// FUNZIONI DI SUPPORTO
// ============================================================
function getValoreFase(fase) {
    const key = fase.toLowerCase().trim();
    return MAPPA_FASI[key] || 99;
}

function normalizzaNome(nome) {
    return nome.replace(/\s+/g, ' ').trim();
}

function estraiDatiNome(nomeCompleto) {
    let nome = nomeCompleto;
    let provincia = '';
    let asd = null;

    const provMatch = nomeCompleto.match(/\b([A-Z]{2})\b/);
    if (provMatch) {
        provincia = provMatch[1];
        nome = nomeCompleto.replace(provMatch[0], '').trim();
    }

    const asdMatch = nomeCompleto.match(/-\s*(.+)$/);
    if (asdMatch) {
        asd = asdMatch[1].trim();
        nome = nomeCompleto.replace(/-\s*.+$/, '').trim();
    }

    if (!asd && provincia) {
        nome = nomeCompleto.replace(provincia, '').trim();
    }

    return { nome, provincia, asd };
}

function estraiPunteggio(text) {
    if (!text) return null;
    const match = text.match(/(\d+)\s*[-:]\s*\d+/);
    if (match) return parseInt(match[1]);
    return null;
}

function getCategoriaFromSrc(src) {
    if (!src) return null;
    const match = src.match(/cat_([A-Z0-9_]+)\.png/i);
    if (!match) return null;
    return MAPPA_CATEGORIE[match[1]] || match[1];
}

// ============================================================
// NAVIGAZIONE DIRETTA
// ============================================================
async function navigaPerTipologia(page, tipologia, comitatoId = null) {
    const config = TIPOLOGIE.find(t => t.id === tipologia.id);
    if (!config) {
        throw new Error(`Tipologia non supportata: ${tipologia.id}`);
    }

    let url = `${BASE_URL}?id_tipologia=${config.id}`;
    if (comitatoId) {
        url += `&id_comitato=${comitatoId}`;
    }

    console.log(`    🌐 Navigazione diretta a: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    try {
        await page.waitForSelector('#iubenda-cs-banner .iubenda-cs-accept-btn', { timeout: 3000 });
        await page.click('#iubenda-cs-banner .iubenda-cs-accept-btn');
        console.log('    ✅ Cookie accettati');
        await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {}

    console.log('    ⏳ Attesa caricamento gare...');
    await page.waitForSelector('.current_match', { timeout: 20000 });
    console.log('    ✅ Gare caricate!');
}

// ============================================================
// FUNZIONE PER ESTRARRE LA STRUTTURA DEI GIORNI (CORRETTA)
// ============================================================
async function estraiStrutturaGiorni(page, eventoId, dataGara = null) {
    try {
        console.log(`      🔍 Estrazione struttura per evento ${eventoId}...`);

        const batterieClicked = await page.evaluate((id) => {
            const item = document.querySelector(`.current_match .date_cont[evento-id="${id}"]`)?.closest('.current_match');
            if (!item) return false;
            const batterie = item.querySelector('.gironi');
            if (batterie) {
                batterie.click();
                return true;
            }
            return false;
        }, eventoId);

        if (!batterieClicked) {
            console.log('      ❌ Clic su BATTERIE fallito');
            return null;
        }

        console.log('      ✅ Clic su BATTERIE eseguito');

        await page.waitForSelector('.match_body .main_title', { timeout: 15000 }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 3000));

        const turni = await page.evaluate(() => {
            const risultati = [];
            const spans = document.querySelectorAll('span');
            for (const span of spans) {
                const testo = span.textContent?.trim() || '';
                if (testo.includes('Turno del') && testo.match(/(\d{2}\/\d{2}\/\d{4})/)) {
                    const dataMatch = testo.match(/(\d{2}\/\d{2}\/\d{4})/);
                    if (dataMatch) {
                        risultati.push({
                            nome: testo,
                            data: dataMatch[1],
                            className: span.className || '(vuoto)'
                        });
                    }
                }
            }
            return risultati;
        });

        console.log(`      📋 Turni trovati: ${turni.length}`);

        if (turni.length === 0) {
            console.log('      ⚠️ Nessun turno trovato');
            return null;
        }

        const giorniMap = {};
        for (const turno of turni) {
            if (!turno.data) continue;
            if (!giorniMap[turno.data]) {
                giorniMap[turno.data] = [];
            }
            giorniMap[turno.data].push(turno.nome);
        }

        let dateUniche = Object.keys(giorniMap).sort();
        if (dateUniche.length === 0) {
            console.log('      ⚠️ Nessuna data trovata');
            return null;
        }

        console.log(`      📅 Date uniche: ${dateUniche.join(', ')}`);

        // 🔥 1. COSTRUISCI I GIORNI USANDO dataGara PER LA FINALE
        const giorni = dateUniche.map((data) => {
            const dataConvertita = convertiData(data);
            const isFinale = dataGara && dataConvertita === dataGara;
            return {
                data: data,
                turni: giorniMap[data].length,
                tipo: isFinale ? 'finale' : 'qualificazione',
                descrizione: giorniMap[data].join(', ')
            };
        });

        // 🔥 2. SE dataGara NON è nelle dateUniche, AGGIUNGILA!
        if (dataGara) {
            const dataGaraFormattata = dataGara.split('-').reverse().join('/');
            if (!dateUniche.includes(dataGaraFormattata)) {
                console.log(`      📅 Aggiungo data finale: ${dataGaraFormattata} (da data_gara)`);
                giorni.push({
                    data: dataGaraFormattata,
                    turni: 0,
                    tipo: 'finale',
                    descrizione: 'Tabellone finale'
                });
                // Aggiungi anche a dateUniche per il calcolo di data_fine_torneo
                dateUniche.push(dataGaraFormattata);
                dateUniche.sort();
            }
        }

        // 🔥 3. CALCOLA data_fine_torneo CORRETTAMENTE
        const dataFine = dateUniche[dateUniche.length - 1];

        const struttura = {
            giorni: giorni,
            data_inizio_torneo: dateUniche[0],
            data_fine_torneo: dataFine,
            totale_giorni: giorni.length,
        };

        console.log(`      ✅ Struttura rilevata: ${struttura.totale_giorni} giorni`);
        console.log(`      📅 Dal ${struttura.data_inizio_torneo} al ${struttura.data_fine_torneo}`);
        console.log(`      🏆 Giorno finale: ${dataGara}`);

        return struttura;

    } catch (error) {
        console.error('      ❌ Errore estrazione struttura:', error.message);
        return null;
    }
}

// ============================================================
// 🔥 FUNZIONE PER ESTRARRE GLI ATLETI DALLE BATTERIE (DEFINITIVA - CON GESTIONE TURNI)
// ============================================================
async function estraiRisultatiBatterie(page, eventoId, dataFiltro = null) {
    const atletiMap = new Map();

    try {
        // 1. CLICCA SU BATTERIE
        const batterieClicked = await page.evaluate((id) => {
            const item = document.querySelector(`.current_match .date_cont[evento-id="${id}"]`)?.closest('.current_match');
            if (!item) return false;
            const batterie = item.querySelector('.gironi');
            if (batterie) {
                batterie.click();
                return true;
            }
            return false;
        }, eventoId);

        if (!batterieClicked) return [];

        await page.waitForSelector('.match_body .main_title', { timeout: 10000 }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 🔥 2. SELEZIONA TUTTI I TURNI CON INDICE ASSOLUTO NEL DOM
        const elementiTurno = await page.evaluate(() => {
            const spans = document.querySelectorAll('span');
            const risultati = [];
            let index = 0;
            for (const span of spans) {
                const testo = span.textContent?.trim() || '';
                if (testo.includes('Turno del') && testo.match(/(\d{2}\/\d{2}\/\d{4})/)) {
                    const dataMatch = testo.match(/(\d{2}\/\d{2}\/\d{4})/);
                    if (dataMatch) {
                        const idNativo = span.getAttribute('data-turno-id') || span.getAttribute('value');
                        risultati.push({
                            nome: testo,
                            data: dataMatch[1],
                            className: span.className || '',
                            key: idNativo ? `${dataMatch[1]}|id-${idNativo}` : `${dataMatch[1]}|idx-${index}`,
                            index: index++
                        });
                    }
                }
            }
            return risultati;
        });

        console.log(`      📋 Turni trovati (con indice): ${elementiTurno.length}`);

        // 🔥 3. DEDUPLICA PER CHIAVE UNICA (DATA + INDICE)
        const turniMap = new Map();
        for (const turno of elementiTurno) {
            if (!turniMap.has(turno.key)) {
                turniMap.set(turno.key, turno);
            }
        }
        const turni = Array.from(turniMap.values());

        console.log(`      📋 Turni unici (per data+indice): ${turni.length}`);

        if (turni.length === 0) return [];

        // 🔥 4. FILTRA PER DATA
        let turniDaScrapare = turni;
        if (dataFiltro) {
            const parts = dataFiltro.split('-');
            const dataFiltroFormattata = `${parts[2]}/${parts[1]}/${parts[0]}`;
            turniDaScrapare = turni.filter(t => t.data === dataFiltroFormattata);
            console.log(`      📋 Turni filtrati per ${dataFiltro}: ${turniDaScrapare.length}`);
        }

        if (turniDaScrapare.length === 0) {
            console.log(`      ⚠️ Nessun turno trovato per il giorno ${dataFiltro}`);
            return [];
        }

        // 🔥 5. PER OGNI TURNO
        for (let i = 0; i < turniDaScrapare.length; i++) {
            const turno = turniDaScrapare[i];
            console.log(`        🔄 Turno ${i+1}/${turniDaScrapare.length}: ${turno.nome}`);

            // 🔥 APRI IL TURNO CON ATTESA DEL CAMBIAMENTO DOM (VERSIONE GEMINI)
            try {
                // 5a. Salva il testo della prima batteria prima del click
                const primaBatteriaPre = await page.evaluate(() => {
                    const el = document.querySelector('.acco_cont h4[data-accordion="label"]');
                    return el ? el.textContent?.trim() : 'vuoto';
                });

                // 5b. Clicca sul turno usando L'IDENTICA LOGICA di selezione usata in discovery
                await page.evaluate((targetIndex) => {
                    const nodiTurno = Array.from(document.querySelectorAll('span'))
                        .filter(span => {
                            const txt = span.textContent?.trim() || '';
                            return txt.includes('Turno del') && /\d{2}\/\d{2}\/\d{4}/.test(txt);
                        });
                    if (nodiTurno[targetIndex]) {
                        nodiTurno[targetIndex].click();
                    }
                }, turno.index);

                // 5c. Attendi l'aggiornamento del DOM (o il timeout di sicurezza)
                await page.waitForFunction(
                    (prevText) => {
                        const el = document.querySelector('.acco_cont h4[data-accordion="label"]');
                        const currentText = el ? el.textContent?.trim() : 'vuoto';
                        return currentText !== prevText;
                    },
                    { timeout: 5000 },
                    primaBatteriaPre
                ).catch(() => {
                    console.log(`          ⚠️ Timeout cambio DOM: proseguo col ritardo di sicurezza.`);
                });

                // Attesa per il rendering definitivo delle tabelle
                await new Promise(resolve => setTimeout(resolve, 1500));

            } catch (e) {
                console.log(`        ⚠️ Errore apertura turno: ${e.message}`);
            }

            // 🔥 6. TROVA LE BATTERIE DEL TURNO CORRENTE
            const batterieDelTurno = await page.evaluate((testo) => {
                const spans = document.querySelectorAll('span');
                let turnoElement = null;
                for (const span of spans) {
                    if (span.textContent?.trim() === testo) {
                        turnoElement = span;
                        break;
                    }
                }
                if (!turnoElement) return [];

                let parent = turnoElement.parentElement;
                while (parent && parent !== document.body) {
                    const batterie = parent.querySelectorAll('.acco_cont h4[data-accordion="label"]');
                    if (batterie.length > 0) {
                        return Array.from(batterie).map(el => el.textContent?.trim() || '');
                    }
                    parent = parent.parentElement;
                }
                return [];
            }, turno.nome);

            console.log(`          📋 Batterie del turno: ${batterieDelTurno.join(', ')}`);

            if (batterieDelTurno.length === 0) {
                console.log('          ⚠️ Nessuna batteria trovata in questo turno');
                continue;
            }

            // 🔥 7. PER OGNI BATTERIA
            for (const nomeBatteria of batterieDelTurno) {
                console.log(`            🔄 Batteria: ${nomeBatteria}...`);

                // 🔥 Controlla se la batteria è già aperta prima di cliccare
                const isOpen = await page.evaluate((nome) => {
                    const elements = document.querySelectorAll('.acco_cont h4[data-accordion="label"]');
                    for (const el of elements) {
                        if (el.textContent?.trim() === nome) {
                            const panel = el.closest('.acco_cont')?.querySelector('.panel');
                            if (panel) {
                                const style = window.getComputedStyle(panel);
                                return style.display !== 'none';
                            }
                        }
                    }
                    return false;
                }, nomeBatteria);

                if (!isOpen) {
                    await page.evaluate((nome) => {
                        const elements = document.querySelectorAll('.acco_cont h4[data-accordion="label"]');
                        for (const el of elements) {
                            if (el.textContent?.trim() === nome) {
                                el.click();
                                break;
                            }
                        }
                    }, nomeBatteria);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }

                // 🔥 8. ESTRAI GLI ATLETI
                const atletiBatteria = await page.evaluate((nome) => {
                    const atleti = [];
                    const batteriaElements = document.querySelectorAll('.acco_cont');
                    for (const el of batteriaElements) {
                        const h4 = el.querySelector('h4[data-accordion="label"]');
                        if (h4 && h4.textContent?.trim() === nome) {
                            const panel = el.querySelector('[data-accordion="panel"]');
                            if (panel) {
                                const panelRows = panel.querySelectorAll('.panel_row');
                                for (const row of panelRows) {
                                    const names = row.querySelectorAll('.name, .player');
                                    for (const nameEl of names) {
                                        const lastname = nameEl.querySelector('.lastname');
                                        const nome = lastname ? lastname.textContent?.trim() : nameEl.textContent?.trim();
                                        if (nome) atleti.push(nome);
                                    }
                                }
                            }
                            break;
                        }
                    }
                    return atleti;
                }, nomeBatteria);

                console.log(`              🏓 ${nomeBatteria}: ${atletiBatteria.length} atleti`);

                // 🔥 9. DEDUPLICA ATLETI PER NOME
                for (const nome of atletiBatteria) {
                    const key = normalizzaNome(nome);
                    if (!atletiMap.has(key)) {
                        const { nome: nomePulito, provincia, asd } = estraiDatiNome(nome);
                        atletiMap.set(key, {
                            nomeCompleto: nome,
                            nome: nomePulito,
                            provincia: provincia,
                            asd: asd,
                            punteggio: null,
                            fase: 'batterie',
                            categoria: null
                        });
                    }
                }
            }
        }

        console.log(`      ✅ Estratti ${atletiMap.size} atleti unici dalle batterie (giorno ${dataFiltro})`);

    } catch (error) {
        console.error('      ❌ Errore batterie:', error.message);
    }

    return Array.from(atletiMap.values());
}
// ============================================================
// FUNZIONE PER ESTRARRE IL TABELLONE FINALE
// ============================================================
async function estraiRisultatiTabellone(page, eventoId) {
    const atletiMap = new Map();

    try {
        const tabelloneClicked = await page.evaluate((id) => {
            const item = document.querySelector(`.current_match .date_cont[evento-id="${id}"]`)?.closest('.current_match');
            if (!item) return false;
            const tabellone = item.querySelector('.tabelloni');
            if (tabellone) {
                tabellone.click();
                return true;
            }
            return false;
        }, eventoId);

        if (!tabelloneClicked) return [];

        await page.waitForSelector('.match_body .main_title', { timeout: 15000 }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 3000));

        const fasi = await page.evaluate(() => {
            const elements = document.querySelectorAll('.info_fasi span');
            return Array.from(elements).map(el => el.textContent?.trim() || '');
        });

        console.log(`      📋 Fasi tabellone: ${fasi.length > 0 ? fasi.join(', ') : 'nessuna'}`);

        for (const fase of fasi) {
            let tentativi = 0;
            let datiTrovati = false;
            let datiFase = [];

            while (tentativi < 3 && !datiTrovati) {
                await page.evaluate((faseNome) => {
                    const elements = document.querySelectorAll('.info_fasi span');
                    for (let el of elements) {
                        if (el.textContent?.trim() === faseNome) {
                            el.click();
                            break;
                        }
                    }
                }, fase);

                await new Promise(resolve => setTimeout(resolve, 3000));

                datiFase = await page.evaluate((faseNome) => {
                    const MAPPA_CATEGORIE_LOCAL = {
                        'MASTER': 'M',
                        'NAZIONALEPRO': 'NP',
                        'NAZIONALE': 'N',
                        'PRIMA': '1ª',
                        'SECONDA': '2ª',
                        'TERZA': '3ª',
                    };

                    function getCategoriaFromSrc(src) {
                        if (!src) return null;
                        const match = src.match(/cat_([A-Z0-9_]+)\.png/i);
                        if (!match) return null;
                        return MAPPA_CATEGORIE_LOCAL[match[1]] || match[1];
                    }

                    function estraiNomeCompleto(el) {
                        const playerSpans = el.querySelectorAll('.player span');
                        if (playerSpans.length >= 2) {
                            return `${playerSpans[0].textContent?.trim()} ${playerSpans[1].textContent?.trim()}`.trim();
                        }
                        if (playerSpans.length === 1) {
                            return playerSpans[0].textContent?.trim() || '';
                        }
                        const lastname = el.querySelector('.lastname')?.textContent?.trim() || '';
                        const soc = el.querySelector('.soc')?.textContent?.trim() || '';
                        if (lastname) {
                            return `${lastname} ${soc}`.trim();
                        }
                        return el.textContent?.trim() || '';
                    }

                    const atleti = [];
                    const panelRows = document.querySelectorAll('.panel_row');

                    if (faseNome === 'finale' && panelRows.length === 1) {
                        const row = panelRows[0];
                        const text = row.textContent || '';
                        const parts = text.split(/\d+\s*[-:]\s*\d+/);
                        if (parts.length >= 2) {
                            const atleta1Text = parts[0].trim();
                            const atleta2Text = parts[1].trim();
                            const punteggioMatch = text.match(/(\d+\s*[-:]\s*\d+)/);
                            const punteggio = punteggioMatch ? punteggioMatch[1] : null;

                            [atleta1Text, atleta2Text].forEach((nomeText) => {
                                let nomeCompleto = nomeText.replace(/Orario\s+[\d:]+/, '').trim();
                                if (nomeCompleto) {
                                    let categoria = null;
                                    const logoImg = row.querySelector('.logo img');
                                    if (logoImg) {
                                        const src = logoImg.getAttribute('src') || '';
                                        const cat = getCategoriaFromSrc(src);
                                        if (cat) categoria = cat;
                                    }
                                    atleti.push({
                                        nomeCompleto: nomeCompleto,
                                        punteggio: punteggio,
                                        fase: faseNome,
                                        categoria: categoria
                                    });
                                }
                            });
                        }
                    } else {
                        panelRows.forEach((row) => {
                            const nameElements = row.querySelectorAll('.name, .player');
                            nameElements.forEach((nameEl) => {
                                const nomeCompleto = estraiNomeCompleto(nameEl);
                                if (nomeCompleto) {
                                    let categoria = null;
                                    const logoImg = row.querySelector('.logo img');
                                    if (logoImg) {
                                        const src = logoImg.getAttribute('src') || '';
                                        const cat = getCategoriaFromSrc(src);
                                        if (cat) categoria = cat;
                                    }
                                    let punteggio = null;
                                    const scoreEl = row.closest('.panel_row')?.parentElement?.querySelector('.score, .detail_score .score');
                                    if (scoreEl) {
                                        punteggio = scoreEl.textContent?.trim() || null;
                                    }
                                    atleti.push({
                                        nomeCompleto: nomeCompleto,
                                        punteggio: punteggio,
                                        fase: faseNome,
                                        categoria: categoria
                                    });
                                }
                            });
                        });
                    }
                    return atleti;
                }, fase);

                if (datiFase.length > 0) {
                    datiTrovati = true;
                    console.log(`          ✅ Trovati ${datiFase.length} atleti (tentativo ${tentativi + 1})`);
                } else {
                    tentativi++;
                    console.log(`          ⚠️ Tentativo ${tentativi} fallito, riprovo...`);
                }
            }

            for (const atleta of datiFase) {
                const key = normalizzaNome(atleta.nomeCompleto);
                const valoreFase = getValoreFase(atleta.fase);
                const { nome, provincia, asd } = estraiDatiNome(atleta.nomeCompleto);

                if (atletiMap.has(key)) {
                    const existing = atletiMap.get(key);
                    if (valoreFase < getValoreFase(existing.fase)) {
                        atletiMap.set(key, { ...atleta, nome, provincia, asd, fase: atleta.fase });
                    }
                } else {
                    atletiMap.set(key, { ...atleta, nome, provincia, asd });
                }
            }
        }

    } catch (error) {
        console.error('      ❌ Errore tabellone:', error.message);
    }

    return Array.from(atletiMap.values());
}

// ============================================================
// FUNZIONI PER IL DATABASE
// ============================================================
async function getGareDaProcessare() {
    const oggi = new Date().toISOString().split('T')[0];
    
    let query;
    
    if (TEST_MODE) {
        console.log(`🧪 [TEST] Forzato sulla gara ID: ${TEST_GARA_ID}`);
        query = supabaseAdmin
            .from('gare')
            .select('id, nome, data_gara, data_fine_iscrizioni, tipologia, regione, stato')
            .eq('id', TEST_GARA_ID)
            .limit(1);
    } else {
        // 🔥 MODIFICA: Prendi le gare con iscrizioni CHIUSE (data_fine_iscrizioni <= oggi)
        query = supabaseAdmin
            .from('gare')
            .select('id, nome, data_gara, data_fine_iscrizioni, tipologia, regione, stato')
            .eq('stato', 'programmata')
            .lte('data_fine_iscrizioni', oggi)  // ← CAMBIATO!
            .order('data_gara', { ascending: true })
            .limit(50);
    }
    
    const { data, error } = await query;
    
    if (error) {
        console.error('❌ Errore nel recupero delle gare:', error);
        return [];
    }
    
    if (TEST_MODE && data && data.length > 0) {
        console.log(`📋 Gara trovata: ${data[0].nome} (ID: ${data[0].id})`);
        console.log(`  📅 Data: ${data[0].data_gara}`);
        console.log(`  📂 Tipologia: ${data[0].tipologia}, Regione: ${data[0].regione || 'N/A'}`);
        console.log(`  📅 Fine iscrizioni: ${data[0].data_fine_iscrizioni}`);
    }
    
    return data || [];
}

async function salvaStrutturaGara(idGara, struttura) {
    const giorniConvertiti = struttura.giorni.map(g => ({
        ...g,
        data: convertiData(g.data)
    }));

    const { error } = await supabaseAdmin
        .from('struttura_gara')
        .upsert({
            id_gara: idGara,
            giorni: giorniConvertiti,
            data_inizio_torneo: convertiData(struttura.data_inizio_torneo),
            data_fine_torneo: convertiData(struttura.data_fine_torneo),
            totale_giorni: struttura.totale_giorni,
            rilevata_il: new Date().toISOString(),
        }, { onConflict: 'id_gara' });

    if (error) {
        console.error('❌ Errore salvataggio struttura:', error);
        return false;
    }

    for (const giorno of giorniConvertiti) {
        await supabaseAdmin
            .from('scraping_giornate_stato')
            .upsert({
                id_gara: idGara,
                data_giornata: giorno.data,
                tipo: giorno.tipo,
                scrappato: false,
            }, { onConflict: 'id_gara, data_giornata' });
    }

    return true;
}

async function getGiorniDaScrappare(idGara) {
    const oggi = new Date().toISOString().split('T')[0];
    
    // 🔥 MODIFICA: Prendi SOLO i giorni PASSATI (data_giornata <= oggi) e non ancora scrappati
    const { data, error } = await supabaseAdmin
        .from('scraping_giornate_stato')
        .select('data_giornata, tipo')
        .eq('id_gara', idGara)
        .eq('scrappato', false)
        .lte('data_giornata', oggi)  // ← AGGIUNTO!
        .order('data_giornata', { ascending: true });

    if (error) {
        console.error('❌ Errore recupero giorni da scrapare:', error);
        return [];
    }

    if (data.length > 0) {
        console.log(`  📋 Giorni passati da scrapare: ${data.length}`);
        data.forEach(g => console.log(`    - ${g.data_giornata} (${g.tipo})`));
    }

    return data || [];
}

async function salvaRisultati(idGara, risultati, dettagliGara) {
    let salvati = 0;
    let errori = 0;
    let nonTrovati = 0;

    const { count } = await supabaseAdmin
        .from('risultati_gara')
        .select('id', { count: 'exact', head: true })
        .eq('id_gara', idGara);

    if (count > 0) {
        console.log(`    ⏭️ Gara ${idGara} ha già risultati, salto`);
        return { salvati: 0, errori: 0, nonTrovati: 0, giaPresenti: true };
    }

    for (const r of risultati) {
        try {
            const { data: tesserato } = await supabaseAdmin
                .from('tesserati')
                .select('id, nome, cognome, categoria_ranking')
                .ilike('nome', `%${r.nome}%`)
                .limit(1)
                .maybeSingle();

            if (!tesserato) {
                nonTrovati++;
                continue;
            }

            const punteggio = r.punteggio ? estraiPunteggio(r.punteggio) : null;

            const { error: insertError } = await supabaseAdmin
                .from('risultati_gara')
                .insert({
                    id_gara: idGara,
                    id_tesserato: tesserato.id,
                    posizione: null,
                    punteggio: punteggio,
                    partecipanti: risultati.length,
                    stato: 'partecipato',
                    data_gara: dettagliGara?.data_gara || null,
                    tipologia: dettagliGara?.tipologia || null,
                    categoria_atleta: r.categoria || tesserato.categoria_ranking || null,
                    ha_ranking: false,
                    ha_classifica: false,
                });

            if (insertError) {
                errori++;
            } else {
                salvati++;
            }
        } catch (error) {
            errori++;
        }
    }

    if (salvati > 0) {
        await supabaseAdmin
            .from('gare')
            .update({ stato: 'completata' })
            .eq('id', idGara);
        console.log(`    ✅ Stato gara aggiornato a 'completata'`);
    }

    return { salvati, errori, nonTrovati, giaPresenti: false };
}

async function segnaGiornoScrappato(idGara, dataGiornata) {
    await supabaseAdmin
        .from('scraping_giornate_stato')
        .update({
            scrappato: true,
            data_scraping: new Date().toISOString(),
        })
        .eq('id_gara', idGara)
        .eq('data_giornata', dataGiornata);
}

// ============================================================
// FUNZIONE PRINCIPALE (TEST)
// ============================================================
export async function scrapeRisultatiTest() {
    console.log('🧪 [TEST] Avvio scraper risultati in modalità TEST...');
    const startTime = Date.now();

    const gare = await getGareDaProcessare();
    console.log(`📋 Trovate ${gare.length} gare da processare`);

    if (gare.length === 0) {
        console.log('✅ Nessuna gara da processare');
        return;
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let totaleSalvati = 0;
    let totaleErrori = 0;
    let totaleNonTrovati = 0;

    try {
        const garePerCombinazione = {};
        for (const gara of gare) {
            const key = `${gara.tipologia}|${gara.regione || 'nazionale'}`;
            if (!garePerCombinazione[key]) {
                garePerCombinazione[key] = [];
            }
            garePerCombinazione[key].push(gara);
        }

        console.log(`📋 Raggruppate in ${Object.keys(garePerCombinazione).length} combinazioni tipologia/regione`);

        for (const [key, gareGruppo] of Object.entries(garePerCombinazione)) {
            const [tipologiaNome, regioneNome] = key.split('|');
            console.log(`\n📂 Navigazione: ${tipologiaNome} - ${regioneNome}`);

            const tipologiaConfig = TIPOLOGIE.find(t => t.nome.toLowerCase() === tipologiaNome.toLowerCase());
            if (!tipologiaConfig) {
                console.log(`  ⚠️ Tipologia non supportata: ${tipologiaNome}`);
                continue;
            }

            let comitatoId = null;
            if (tipologiaConfig.hasComitato && regioneNome !== 'nazionale') {
                const comitato = COMITATI.find(c => c.nome.toLowerCase() === regioneNome.toLowerCase());
                if (comitato) {
                    comitatoId = comitato.id;
                } else {
                    console.log(`  ⚠️ Comitato non trovato: ${regioneNome}`);
                }
            }

            await navigaPerTipologia(page, tipologiaConfig, comitatoId);

            const gareLista = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('.current_match')).map(item => ({
                    titolo: item.querySelector('.info h5')?.textContent?.trim() || '',
                    eventoId: item.querySelector('.date_cont')?.getAttribute('evento-id') || '',
                    giorno: item.querySelector('.date_cont .day')?.textContent?.trim() || '',
                    mese: item.querySelector('.date_cont .month')?.textContent?.trim() || '',
                    haTabellone: !!item.querySelector('.tabelloni'),
                    haBatterie: !!item.querySelector('.gironi'),
                }));
            });

            console.log(`  📊 Trovate ${gareLista.length} gare nella lista`);

            for (const gara of gareGruppo) {
                console.log(`\n📋 Elaborazione: ${gara.nome} (ID: ${gara.id})`);
                console.log(`  📅 Data gara: ${gara.data_gara}`);

                const garaTrovata = gareLista.find(g => 
                    g.titolo?.toLowerCase().includes(gara.nome?.toLowerCase().substring(0, 20))
                );

                if (!garaTrovata || !garaTrovata.eventoId) {
                    console.log(`  ⚠️ Gara non trovata nella lista`);
                    continue;
                }

                console.log(`  🎯 Evento ID: ${garaTrovata.eventoId}`);

                const { data: strutturaEsistente } = await supabaseAdmin
                    .from('struttura_gara')
                    .select('id')
                    .eq('id_gara', gara.id)
                    .maybeSingle();

                if (!strutturaEsistente) {
                    console.log('  📊 Rilevamento struttura giorni...');
                    const struttura = await estraiStrutturaGiorni(page, garaTrovata.eventoId, gara.data_gara);
                    if (struttura) {
                        await salvaStrutturaGara(gara.id, struttura);
                        console.log(`    ✅ Struttura salvata: ${struttura.totale_giorni} giorni`);
                    } else {
                        console.log(`  ⚠️ Impossibile rilevare la struttura`);
                        continue;
                    }
                }

                const giorniDaScrappare = await getGiorniDaScrappare(gara.id);
                console.log(`  📋 Giorni da scrapare: ${giorniDaScrappare.length}`);

                if (giorniDaScrappare.length === 0) {
                    console.log(`  ✅ Tutti i giorni già scrappati`);
                    continue;
                }

                for (const giorno of giorniDaScrappare) {
                    console.log(`  📅 Scraping giorno: ${giorno.data_giornata} (${giorno.tipo})`);

                    let risultati = [];
                    if (giorno.tipo === 'finale') {
                        risultati = await estraiRisultatiTabellone(page, garaTrovata.eventoId);
                        console.log(`    ✅ Estratti ${risultati.length} atleti dal tabellone`);
                    } else {
                        risultati = await estraiRisultatiBatterie(page, garaTrovata.eventoId, giorno.data_giornata);
                        console.log(`    ✅ Estratti ${risultati.length} atleti dalle batterie`);
                    }

                    if (risultati.length > 0) {
                        const result = await salvaRisultati(gara.id, risultati, gara);
                        totaleSalvati += result.salvati;
                        totaleErrori += result.errori;
                        totaleNonTrovati += result.nonTrovati;
                    }

                    await segnaGiornoScrappato(gara.id, giorno.data_giornata);
                    console.log(`    ✅ Giorno ${giorno.data_giornata} segnato come scrappato`);
                }
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n✅ [TEST] Completato in ${elapsed}s`);
        console.log(`  📊 Gare elaborate: ${gare.length}`);
        console.log(`  💾 Risultati salvati: ${totaleSalvati}`);
        console.log(`  ⚠️ Tesserati non trovati: ${totaleNonTrovati}`);
        console.log(`  ❌ Errori: ${totaleErrori}`);

    } catch (error) {
        console.error('❌ [TEST] Errore:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

// ============================================================
// AVVIO DIRETTO
// ============================================================
(async () => {
    console.log('🧪 Avvio test scraper risultati...');
    try {
        await scrapeRisultatiTest();
        console.log('✅ Test completato!');
    } catch (error) {
        console.error('❌ Errore:', error);
    }
})();