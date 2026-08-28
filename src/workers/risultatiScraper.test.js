// src/workers/risultatiScraper.test.js
import { supabaseAdmin } from '../config/supabase.js';
import puppeteer from 'puppeteer';

// ============================================================
// CONFIGURAZIONE TEST - SOLO FIBIS CHALLENGE (NAZIONALE)
// ============================================================
const BASE_URL = 'https://www.fibis.it/stecca/fibis-gare-stecca.html';

const TIPOLOGIE = [
    { id: '2', nome: 'Fibis Challenge', hasComitato: false },
];

const MESE_FILTER = 'mag';

// ============================================================
// MAPPA FASI → POSIZIONE
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

// ============================================================
// MAPPA CATEGORIE
// ============================================================
const MAPPA_CATEGORIE = {
    'MASTER': 'M',
    'NAZIONALEPRO': 'NP',
    'NAZIONALE': 'N',
    'PRIMA': '1ª',
    'SECONDA': '2ª',
    'TERZA': '3ª',
};

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
    if (match) {
        return parseInt(match[1]);
    }
    return null;
}

// ============================================================
// FUNZIONE PER ESTRARRE GLI ATLETI DAL TABELLONE FINALE
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

        await page.waitForSelector('.match_body .main_title', { timeout: 10000 }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 2000));

        const fasi = await page.evaluate(() => {
            const elements = document.querySelectorAll('.info_fasi span');
            return Array.from(elements).map(el => el.textContent?.trim() || '');
        });

        console.log(`      📋 Fasi tabellone: ${fasi.length > 0 ? fasi.join(', ') : 'nessuna'}`);

        for (const fase of fasi) {
            console.log(`        🔄 Clic su "${fase}"...`);

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

                await new Promise(resolve => setTimeout(resolve, 2000));

                // 🔧 TUTTE LE FUNZIONI DENTRO evaluate
                datiFase = await page.evaluate((faseNome) => {
                    const MAPPA_CATEGORIE = {
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
                        return MAPPA_CATEGORIE[match[1]] || match[1];
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

                                    if (!punteggio) {
                                        const detailScore = row.closest('.panel_row')?.parentElement?.querySelector('.detail_score');
                                        if (detailScore) {
                                            const scoreText = detailScore.textContent?.trim() || '';
                                            const match = scoreText.match(/\d+\s*[-:]\s*\d+/);
                                            if (match) punteggio = match[0];
                                        }
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
// FUNZIONE PER ESTRARRE GLI ATLETI DALLE BATTERIE (PRIME 4)
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

        console.log(`      📋 Batterie trovate nel primo turno: ${batterieElements.join(', ')}`);

        if (batterieElements.length === 0) {
            console.log('      ⚠️ Nessuna batteria trovata');
            return [];
        }

        const primeBatterie = batterieElements.slice(0, 4);
        console.log(`      📋 Prime 4 batterie: ${primeBatterie.join(', ')}`);

        for (const nomeBatteria of primeBatterie) {
            console.log(`        🔄 Batteria: ${nomeBatteria}...`);

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

                // 🔧 TUTTE LE FUNZIONI DENTRO evaluate
                datiBatteria = await page.evaluate((nome) => {
                    const MAPPA_CATEGORIE = {
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
                        return MAPPA_CATEGORIE[match[1]] || match[1];
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
                    console.log(`          ✅ Trovati ${datiBatteria.length} atleti (tentativo ${tentativi + 1})`);
                    console.log(`          📋 Atleti in ${nomeBatteria}:`);
                    datiBatteria.forEach((a, i) => {
                        const categoriaDisplay = a.categoria ? `[${a.categoria}]` : '';
                        console.log(`            ${i+1}. ${a.nomeCompleto} ${categoriaDisplay}`);
                    });
                } else {
                    tentativi++;
                    console.log(`          ⚠️ Tentativo ${tentativi} fallito, riprovo...`);
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
// FUNZIONE PER IDENTIFICARE VINCITORE E FINALISTA
// ============================================================
function trovaFinalisti(risultati) {
    const finalisti = risultati.filter(a => a.fase === 'finale');
    const conPunteggio = finalisti.filter(a => {
        if (!a.punteggio) return false;
        const score = estraiPunteggio(a.punteggio);
        return score !== null;
    });

    if (conPunteggio.length === 2) {
        conPunteggio.sort((a, b) => {
            const scoreA = estraiPunteggio(a.punteggio);
            const scoreB = estraiPunteggio(b.punteggio);
            return (scoreB || 0) - (scoreA || 0);
        });
        return { vincitore: conPunteggio[0], finalista: conPunteggio[1] };
    }

    if (finalisti.length >= 2) {
        return { vincitore: finalisti[0], finalista: finalisti[1] };
    }

    return { vincitore: null, finalista: null };
}

// ============================================================
// FUNZIONE PRINCIPALE (TEST)
// ============================================================
export async function scrapeRisultatiTest() {
    console.log(`🧪 [TEST] Scraping Fibis Challenge (mese: ${MESE_FILTER})...`);
    const startTime = Date.now();

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage'
        ]
    });
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    });

    try {
        for (const tipologia of TIPOLOGIE) {
            const url = `${BASE_URL}?id_tipologia=${tipologia.id}`;
            console.log(`\n📂 Scraping: ${tipologia.nome}`);
            console.log(`🔗 URL: ${url}`);

            await new Promise(resolve => setTimeout(resolve, 2000));

            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 60000
            });

            try {
                await page.waitForSelector('.current_match', { timeout: 15000 });
            } catch (e) {
                console.log('  ⚠️ Nessuna gara trovata');
                return;
            }

            const gare = await page.evaluate((meseFilter) => {
                const items = document.querySelectorAll('.current_match');
                return Array.from(items)
                    .filter(item => {
                        const mese = item.querySelector('.date_cont .month')?.textContent?.trim() || '';
                        return mese === meseFilter;
                    })
                    .map(item => {
                        const titolo = item.querySelector('.info h5')?.textContent?.trim() || '';
                        const eventoId = item.querySelector('.date_cont')?.getAttribute('evento-id') || '';
                        return { titolo, eventoId };
                    });
            }, MESE_FILTER);

            console.log(`  📊 Gare trovate (${MESE_FILTER}): ${gare.length}`);

            const gareDaProcessare = gare.slice(0, 1);
            console.log(`  🧪 Test limitato a ${gareDaProcessare.length} gara`);

            for (const gara of gareDaProcessare) {
                console.log(`\n    📋 Elaborazione: ${gara.titolo.substring(0, 50)}...`);

                console.log('    📊 Scraping tabellone finale...');
                const risultatiTabellone = await estraiRisultatiTabellone(page, gara.eventoId);
                console.log(`      ✅ Estratti ${risultatiTabellone.length} atleti dal tabellone`);

                console.log('    📊 Scraping prime 4 batterie...');
                const risultatiBatterie = await estraiRisultatiBatterie(page, gara.eventoId);
                console.log(`      ✅ Estratti ${risultatiBatterie.length} atleti dalle batterie`);

                const tutti = [...risultatiTabellone, ...risultatiBatterie];
                const map = new Map();
                tutti.forEach(a => {
                    const key = normalizzaNome(a.nomeCompleto);
                    if (!map.has(key)) {
                        map.set(key, a);
                    } else {
                        const existing = map.get(key);
                        if (getValoreFase(a.fase) < getValoreFase(existing.fase)) {
                            map.set(key, a);
                        }
                    }
                });
                const risultati = Array.from(map.values());
                risultati.sort((a, b) => getValoreFase(a.fase) - getValoreFase(b.fase));

                console.log(`      ✅ Estratti ${risultati.length} atleti unici (combinati)`);

                console.log('\n      📊 TOP 10 ATLETI (per posizione):');
                risultati.slice(0, 10).forEach((a, i) => {
                    const categoriaDisplay = a.categoria ? `[${a.categoria}]` : '';
                    console.log(`        ${i+1}. ${a.nomeCompleto} ${categoriaDisplay} → ${a.fase}`);
                });

                console.log('\n      📊 RIEPILOGO PER FASE:');
                const faseCount = {};
                risultati.forEach(a => {
                    faseCount[a.fase] = (faseCount[a.fase] || 0) + 1;
                });
                const fasiOrdinate = Object.keys(faseCount).sort((a, b) => getValoreFase(a) - getValoreFase(b));
                fasiOrdinate.forEach(f => {
                    console.log(`        ${f}: ${faseCount[f]} atleti`);
                });

                const { vincitore, finalista } = trovaFinalisti(risultati);
                console.log('\n      🏆 VINCITORE E FINALISTA:');
                if (vincitore) {
                    console.log(`        1°: ${vincitore.nomeCompleto} ${vincitore.categoria ? `[${vincitore.categoria}]` : ''} (${vincitore.punteggio || ''})`);
                }
                if (finalista) {
                    console.log(`        2°: ${finalista.nomeCompleto} ${finalista.categoria ? `[${finalista.categoria}]` : ''} (${finalista.punteggio || ''})`);
                }

                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n✅ [TEST] Completato in ${elapsed}s`);

    } catch (error) {
        console.error('❌ [TEST] Errore:', error);
    } finally {
        await browser.close();
    }
}

// ============================================================
// AVVIO DIRETTO
// ============================================================
(async () => {
    console.log('🧪 Avvio test scraper risultati (Fibis Challenge - Maggio)...');
    try {
        await scrapeRisultatiTest();
        console.log('✅ Test completato!');
    } catch (error) {
        console.error('❌ Errore durante il test:', error);
    }
})();