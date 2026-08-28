// src/workers/risultatiScraper.js
import { supabaseAdmin } from '../config/supabase.js';
import puppeteer from 'puppeteer';

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
        LIMITE: 10,
    },
};

// ============================================================
// MAPPE (DAL TEST)
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
// 🔥 SEZIONE COMITATI E TIPOLOGIE (AGGIUNTA!)
// ============================================================

// 🔧 TIPOLOGIE (per la navigazione)
const TIPOLOGIE = [
    { id: '2', nome: 'Fibis Challenge', hasComitato: false, btn: '#btn_internazionale' },
    { id: '4', nome: 'Istituzionale', hasComitato: true, btn: '#btn_istituzionale' },
    { id: '5', nome: 'Libera', hasComitato: true, btn: '#btn_libera' },
    { id: '6', nome: 'Riservata', hasComitato: true, btn: '#btn_riservata' },
];

// 🔧 COMITATI REGIONALI (CORRETTI!)
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
// FUNZIONI DI SUPPORTO (DAL TEST)
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
// FUNZIONI ROBUSTE (NAVIGAZIONE CON RETRY)
// ============================================================
async function waitForPageStable(page, timeout = 15000) {
    try {
        await page.waitForFunction(
            () => document.readyState === 'complete',
            { timeout: timeout }
        );
        await page.waitForTimeout(1000);
        return true;
    } catch (error) {
        console.log('  ⚠️ Timeout attesa stabilità pagina');
        return false;
    }
}

async function clickWithRetry(page, selector, maxRetry = 3) {
    for (let i = 0; i < maxRetry; i++) {
        try {
            await page.waitForSelector(selector, { visible: true, timeout: 10000 });
            await page.click(selector);
            await page.waitForTimeout(2000);
            return true;
        } catch (error) {
            console.log(`  ⚠️ Tentativo ${i+1}/${maxRetry} fallito per ${selector}`);
            await page.waitForTimeout(2000);
        }
    }
    return false;
}

// ============================================================
// FUNZIONE DI NAVIGAZIONE PER TIPOLOGIA/COMITATO (AGGIUNTA!)
// ============================================================
async function navigaPerTipologia(page, tipologia, comitatoId = null) {
    const config = TIPOLOGIE.find(t => t.id === tipologia.id);
    if (!config) {
        throw new Error(`Tipologia non supportata: ${tipologia.id}`);
    }

    // Vai alla pagina
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });

    // Seleziona tipologia
    await page.select('#id_tipologia', config.id);

    // Seleziona comitato (se necessario)
    if (config.hasComitato && comitatoId) {
        await page.select('#id_comitato', comitatoId);
    }

    // Clicca sul pulsante Cerca specifico
    await page.click(config.btn);

    // Aspetta i risultati
    await page.waitForSelector('.current_match', { timeout: 15000 });
}

// ============================================================
// FUNZIONI DI ESTRASIONE (DAL TEST - COMPLETE)
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
        await page.waitForTimeout(3000);

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

                await page.waitForTimeout(3000);

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
// FUNZIONE PER ESTRARRE GLI ATLETI DALLE BATTERIE (AGGIUNTA!)
// ============================================================
async function estraiRisultatiBatterie(page, eventoId) {
    const atletiMap = new Map();

    try {
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
        await new Promise(resolve => setTimeout(resolve, 2000));

        const batterieElements = await page.evaluate(() => {
            const elements = document.querySelectorAll('.acco_cont h4[data-accordion="label"]');
            return Array.from(elements).map(el => el.textContent?.trim() || '');
        });

        if (batterieElements.length === 0) return [];

        const primeBatterie = batterieElements.slice(0, CONFIG.BATTERIE.LIMITE);
        console.log(`      📋 Batterie da scrapare: ${primeBatterie.length} (limite: ${CONFIG.BATTERIE.LIMITE})`);

        for (const nomeBatteria of primeBatterie) {
            let tentativi = 0;
            let datiTrovati = false;
            let datiBatteria = [];

            while (tentativi < 3 && !datiTrovati) {
                await page.evaluate((nome) => {
                    const elements = document.querySelectorAll('.acco_cont h4[data-accordion="label"]');
                    for (let el of elements) {
                        if (el.textContent?.trim() === nome) {
                            el.click();
                            break;
                        }
                    }
                }, nomeBatteria);

                await new Promise(resolve => setTimeout(resolve, 2000));

                datiBatteria = await page.evaluate((nome) => {
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
                    const batteriaElements = document.querySelectorAll('.acco_cont');
                    for (let el of batteriaElements) {
                        const h4 = el.querySelector('h4[data-accordion="label"]');
                        if (h4 && h4.textContent?.trim() === nome) {
                            const panel = el.querySelector('[data-accordion="panel"]');
                            if (panel) {
                                const nameElements = panel.querySelectorAll('.name, .player');
                                nameElements.forEach((nameEl) => {
                                    const nomeCompleto = estraiNomeCompleto(nameEl);
                                    if (nomeCompleto) {
                                        let categoria = null;
                                        const logoImg = nameEl.closest('.panel_row')?.querySelector('.logo img');
                                        if (logoImg) {
                                            const src = logoImg.getAttribute('src') || '';
                                            const cat = getCategoriaFromSrc(src);
                                            if (cat) categoria = cat;
                                        }
                                        atleti.push({
                                            nomeCompleto: nomeCompleto,
                                            punteggio: null,
                                            fase: 'batterie',
                                            categoria: categoria
                                        });
                                    }
                                });
                            }
                            break;
                        }
                    }
                    return atleti;
                }, nomeBatteria);

                if (datiBatteria.length > 0) {
                    datiTrovati = true;
                } else {
                    tentativi++;
                }
            }

            for (const atleta of datiBatteria) {
                const key = normalizzaNome(atleta.nomeCompleto);
                const { nome, provincia, asd } = estraiDatiNome(atleta.nomeCompleto);
                if (!atletiMap.has(key)) {
                    atletiMap.set(key, { ...atleta, nome, provincia, asd });
                }
            }
        }

    } catch (error) {
        console.error('      ❌ Errore batterie:', error.message);
    }

    return Array.from(atletiMap.values());
}

// ============================================================
// FUNZIONE PER ESTRARRE LA STRUTTURA DEI GIORNI
// ============================================================
async function estraiStrutturaGiorni(page, eventoId) {
    try {
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

        if (!batterieClicked) return null;

        await page.waitForSelector('.match_body .main_title', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(3000);

        const turni = await page.evaluate(() => {
            const elements = document.querySelectorAll('.acco_cont h4[data-accordion="label"]');
            return Array.from(elements).map(el => {
                const testo = el.textContent?.trim() || '';
                const dataMatch = testo.match(/(\d{2}\/\d{2}\/\d{4})/);
                return {
                    nome: testo,
                    data: dataMatch ? dataMatch[1] : null
                };
            });
        });

        if (turni.length === 0) return null;

        const giorniMap = {};
        for (const turno of turni) {
            if (!turno.data) continue;
            if (!giorniMap[turno.data]) {
                giorniMap[turno.data] = [];
            }
            giorniMap[turno.data].push(turno.nome);
        }

        const dateUniche = Object.keys(giorniMap).sort();
        if (dateUniche.length === 0) return null;

        const giorni = dateUniche.map((data, index) => {
            const isUltimo = index === dateUniche.length - 1;
            return {
                data: data,
                turni: giorniMap[data].length,
                tipo: isUltimo ? 'finale' : 'qualificazione',
                descrizione: giorniMap[data].join(', ')
            };
        });

        return {
            giorni: giorni,
            data_inizio_torneo: dateUniche[0],
            data_fine_torneo: dateUniche[dateUniche.length - 1],
            totale_giorni: dateUniche.length,
        };

    } catch (error) {
        console.error('      ❌ Errore estrazione struttura:', error.message);
        return null;
    }
}

// ============================================================
// FUNZIONI PER IL DATABASE
// ============================================================
async function getGareDaProcessare() {
    const oggi = new Date().toISOString().split('T')[0];
    const domani = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    
    console.log(`📅 Oggi: ${oggi}, Domani: ${domani}`);

    const { data, error } = await supabaseAdmin
        .from('gare')
        .select('id, nome, data_gara, tipologia, regione, stato')
        .or(`data_gara.eq.${oggi},data_gara.eq.${domani}`)
        .eq('stato', 'programmata')
        .order('data_gara', { ascending: true })
        .limit(50);

    if (error) {
        console.error('❌ Errore nel recupero delle gare:', error);
        return [];
    }

    return data || [];
}

async function salvaStrutturaGara(idGara, struttura) {
    const { error } = await supabaseAdmin
        .from('struttura_gara')
        .upsert({
            id_gara: idGara,
            giorni: struttura.giorni,
            data_inizio_torneo: struttura.data_inizio_torneo,
            data_fine_torneo: struttura.data_fine_torneo,
            totale_giorni: struttura.totale_giorni,
            rilevata_il: new Date().toISOString(),
        }, { onConflict: 'id_gara' });

    if (error) {
        console.error('❌ Errore salvataggio struttura:', error);
        return false;
    }

    for (const giorno of struttura.giorni) {
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
    const { data, error } = await supabaseAdmin
        .from('scraping_giornate_stato')
        .select('data_giornata, tipo')
        .eq('id_gara', idGara)
        .eq('scrappato', false)
        .order('data_giornata', { ascending: true });

    if (error) {
        console.error('❌ Errore recupero giorni da scrapare:', error);
        return [];
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
// FUNZIONE PRINCIPALE
// ============================================================
export async function scrapeRisultati() {
    console.log('🔄 [SCRAPER RISULTATI] Avvio produzione...');
    const startTime = Date.now();

    // 1. Trova le gare da processare
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
        // Raggruppa le gare per tipologia e regione (per ottimizzare la navigazione)
        const garePerCombinazione = {};
        for (const gara of gare) {
            const key = `${gara.tipologia}|${gara.regione || 'nazionale'}`;
            if (!garePerCombinazione[key]) {
                garePerCombinazione[key] = [];
            }
            garePerCombinazione[key].push(gara);
        }

        console.log(`📋 Raggruppate in ${Object.keys(garePerCombinazione).length} combinazioni tipologia/regione`);

        // Itera su ogni combinazione
        for (const [key, gareGruppo] of Object.entries(garePerCombinazione)) {
            const [tipologiaNome, regioneNome] = key.split('|');
            console.log(`\n📂 Navigazione: ${tipologiaNome} - ${regioneNome}`);

            // Trova la configurazione della tipologia
            const tipologiaConfig = TIPOLOGIE.find(t => t.nome.toLowerCase() === tipologiaNome.toLowerCase());
            if (!tipologiaConfig) {
                console.log(`  ⚠️ Tipologia non supportata: ${tipologiaNome}`);
                continue;
            }

            // Trova il comitato (se necessario)
            let comitatoId = null;
            if (tipologiaConfig.hasComitato && regioneNome !== 'nazionale') {
                const comitato = COMITATI.find(c => c.nome.toLowerCase() === regioneNome.toLowerCase());
                if (comitato) {
                    comitatoId = comitato.id;
                } else {
                    console.log(`  ⚠️ Comitato non trovato: ${regioneNome}`);
                }
            }

            // Naviga per tipologia/comitato
            console.log(`  🔍 Navigazione a: ${tipologiaConfig.nome}${comitatoId ? ` - ${regioneNome}` : ''}`);
            await navigaPerTipologia(page, tipologiaConfig, comitatoId);

            // Estrai la lista delle gare dalla pagina
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

            // Processa ogni gara del gruppo
            for (const gara of gareGruppo) {
                console.log(`\n📋 Elaborazione: ${gara.nome} (ID: ${gara.id})`);
                console.log(`  📅 Data gara: ${gara.data_gara}`);

                // Trova la gara nella lista
                const garaTrovata = gareLista.find(g => 
                    g.titolo?.toLowerCase().includes(gara.nome?.toLowerCase().substring(0, 20))
                );

                if (!garaTrovata || !garaTrovata.eventoId) {
                    console.log(`  ⚠️ Gara non trovata nella lista`);
                    continue;
                }

                console.log(`  🎯 Evento ID: ${garaTrovata.eventoId}`);

                // VERIFICA: esiste già la struttura?
                const { data: strutturaEsistente } = await supabaseAdmin
                    .from('struttura_gara')
                    .select('id')
                    .eq('id_gara', gara.id)
                    .maybeSingle();

                if (!strutturaEsistente) {
                    console.log('  📊 Rilevamento struttura giorni...');
                    const struttura = await estraiStrutturaGiorni(page, garaTrovata.eventoId);
                    if (struttura) {
                        await salvaStrutturaGara(gara.id, struttura);
                        console.log(`    ✅ Struttura salvata: ${struttura.totale_giorni} giorni`);
                    } else {
                        console.log(`  ⚠️ Impossibile rilevare la struttura`);
                        continue;
                    }
                }

                // Trova i giorni da scrapare
                const giorniDaScrappare = await getGiorniDaScrappare(gara.id);
                console.log(`  📋 Giorni da scrapare: ${giorniDaScrappare.length}`);

                if (giorniDaScrappare.length === 0) {
                    console.log(`  ✅ Tutti i giorni già scrappati`);
                    continue;
                }

                // Scrapa ogni giorno
                for (const giorno of giorniDaScrappare) {
                    console.log(`  📅 Scraping giorno: ${giorno.data_giornata} (${giorno.tipo})`);

                    let risultati = [];
                    if (giorno.tipo === 'finale') {
                        // Scrapa il tabellone finale
                        risultati = await estraiRisultatiTabellone(page, garaTrovata.eventoId);
                        console.log(`    ✅ Estratti ${risultati.length} atleti dal tabellone`);
                    } else {
                        // Scrapa le batterie del giorno specifico
                        risultati = await estraiRisultatiBatterie(page, garaTrovata.eventoId);
                        console.log(`    ✅ Estratti ${risultati.length} atleti dalle batterie`);
                    }

                    if (risultati.length > 0) {
                        const result = await salvaRisultati(gara.id, risultati, gara);
                        totaleSalvati += result.salvati;
                        totaleErrori += result.errori;
                        totaleNonTrovati += result.nonTrovati;
                    }

                    // Segna il giorno come scrappato
                    await segnaGiornoScrappato(gara.id, giorno.data_giornata);
                    console.log(`    ✅ Giorno ${giorno.data_giornata} segnato come scrappato`);
                }
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n✅ [SCRAPER RISULTATI] Completato in ${elapsed}s`);
        console.log(`  📊 Gare elaborate: ${gare.length}`);
        console.log(`  💾 Risultati salvati: ${totaleSalvati}`);
        console.log(`  ⚠️ Tesserati non trovati: ${totaleNonTrovati}`);
        console.log(`  ❌ Errori: ${totaleErrori}`);

    } catch (error) {
        console.error('❌ [SCRAPER RISULTATI] Errore:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

// ============================================================
// AVVIO DIRETTO
// ============================================================
(async () => {
    console.log('🚀 Avvio scraper risultati (produzione)...');
    try {
        await scrapeRisultati();
        console.log('✅ Scraping risultati completato!');
    } catch (error) {
        console.error('❌ Errore:', error);
    }
})();