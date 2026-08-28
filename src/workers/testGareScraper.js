// src/workers/testGareScraper.js
import { supabaseAdmin } from '../config/supabase.js';
import puppeteer from 'puppeteer';

// ============================================================
// CONFIGURAZIONE TEST - FIBIS CHALLENGE + CALABRIA (da gen 2026)
// ============================================================
const BASE_URL = 'https://www.fibis.it/stecca/fibis-gare-stecca.html';

// 🔧 ORDINE: prima le NAZIONALI, poi la CALABRIA
const CONFIGURAZIONI = [
    // === FASE 1: GARE NAZIONALI ===
    { 
        tipologia: 'Fibis Challenge',
        id_tipologia: '2',
        hasComitato: false,
        comitatoNome: 'Nazionale'
    },
    // === FASE 2: GARE REGIONALI (CALABRIA) ===
    { 
        tipologia: 'Istituzionale',
        id_tipologia: '4',
        hasComitato: true,
        comitatoId: '17',
        comitatoNome: 'Calabria'
    },
    { 
        tipologia: 'Libera',
        id_tipologia: '5',
        hasComitato: true,
        comitatoId: '17',
        comitatoNome: 'Calabria'
    },
    { 
        tipologia: 'Riservata',
        id_tipologia: '6',
        hasComitato: true,
        comitatoId: '17',
        comitatoNome: 'Calabria'
    },
];

// 🔧 FILTRO DATA: prendi solo le gare con iscrizioni da gennaio 2026
const DATA_FILTRO = new Date('2026-01-01');

// ============================================================
// MAPPA MESI ITALIANO → NUMERO
// ============================================================
const MESI_MAP = {
    'gen': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'mag': 5, 'giu': 6,
    'lug': 7, 'ago': 8, 'set': 9, 'ott': 10, 'nov': 11, 'dic': 12
};

// ============================================================
// FUNZIONE PER PARSARE LE DATE DI ISCRIZIONE
// ============================================================
function parseIscrizioni(iscrizioniText) {
    if (!iscrizioniText) return { inizio: null, fine: null };
    
    const match = iscrizioniText.match(/dal\s+(\d{2}\/\d{2}\/\d{4})\s+[\d:]+\s+al\s+(\d{2}\/\d{2}\/\d{4})/);
    if (!match) return { inizio: null, fine: null };
    
    const [_, inizioStr, fineStr] = match;
    
    const parseData = (str) => {
        const [day, month, year] = str.split('/');
        return `${year}-${month}-${day}`;
    };
    
    return {
        inizio: parseData(inizioStr),
        fine: parseData(fineStr)
    };
}

// ============================================================
// FUNZIONE PER ESTRARRE LE GARE DA UNA PAGINA
// ============================================================
async function estraiGareDaPagina(page, tipologiaForzata) {
    return await page.evaluate((tipologiaForzata) => {
        const items = document.querySelectorAll('.current_match');
        return Array.from(items).map(item => {
            const titolo = item.querySelector('.info h5')?.textContent?.trim() || '';
            const giorno = item.querySelector('.date_cont .day')?.textContent?.trim() || '';
            const mese = item.querySelector('.date_cont .month')?.textContent?.trim() || '';
            const luogo = item.querySelector('.loc')?.textContent?.trim() || '';
            const iscrizioni = item.querySelector('.iscrizioni')?.textContent?.trim() || '';
            
            let tipologia = tipologiaForzata || 'Istituzionale';
            if (!tipologiaForzata) {
                if (item.closest('.challenge')) tipologia = 'Fibis Challenge';
                else if (item.closest('.libera')) tipologia = 'Libera';
                else if (item.closest('.riservata')) tipologia = 'Riservata';
            }
            
            const categoriaMatch = titolo.match(/(\d+)\s*[^CATEGORIA]*CATEGORIA/i);
            const categoria = categoriaMatch ? `${categoriaMatch[1]}ª Categoria` : null;

            return {
                titolo,
                giorno,
                mese,
                luogo,
                iscrizioni,
                tipologia,
                categoria,
            };
        });
    }, tipologiaForzata);
}

// ============================================================
// FUNZIONE PER OTTENERE IL NUMERO DI PAGINE
// ============================================================
async function getNumeroPagine(page) {
    const pagine = await page.evaluate(() => {
        const elements = document.querySelectorAll('.paginazione span.pagina');
        return Array.from(elements).map(el => parseInt(el.textContent?.trim() || '0')).filter(n => n > 0);
    });
    
    if (pagine.length === 0) return 1;
    return Math.max(...pagine);
}

// ============================================================
// FUNZIONE PER CLICCARE SU UNA PAGINA
// ============================================================
async function cliccaPagina(page, numeroPagina) {
    await page.evaluate((num) => {
        const elements = document.querySelectorAll('.paginazione span.pagina');
        for (let el of elements) {
            if (parseInt(el.textContent?.trim() || '0') === num) {
                el.click();
                return;
            }
        }
    }, numeroPagina);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.waitForSelector('.current_match', { timeout: 10000 }).catch(() => {});
}

// ============================================================
// FUNZIONE PRINCIPALE (TEST)
// ============================================================
export async function scrapeGareTest() {
    console.log(`🧪 [TEST] Fibis Challenge + Calabria (iscrizioni da gen 2026)\n`);
    const startTime = Date.now();

    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    try {
        let totaleGareValide = 0;
        let totaleGareScartate = 0;
        let totalePagine = 0;
        let totalePagineSaltate = 0;

        for (const config of CONFIGURAZIONI) {
            let url = `${BASE_URL}?id_tipologia=${config.id_tipologia}`;
            if (config.hasComitato) {
                url += `&id_comitato=${config.comitatoId}`;
            }
            
            console.log(`\n📂 Scraping: ${config.tipologia} - ${config.comitatoNome}`);
            console.log(`🔗 URL: ${url}`);
            console.log(`📅 Filtro iscrizioni da: ${DATA_FILTRO.toLocaleDateString()}`);

            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            try {
                await page.waitForSelector('#iubenda-cs-banner .iubenda-cs-accept-btn', { timeout: 3000 });
                await page.click('#iubenda-cs-banner .iubenda-cs-accept-btn');
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (e) {}

            const numPagine = await getNumeroPagine(page);
            console.log(`  📄 Pagine trovate: ${numPagine}`);
            totalePagine += numPagine;

            let stopScraping = false;

            for (let pagina = 1; pagina <= numPagine; pagina++) {
                if (stopScraping) {
                    console.log(`  ⏭️ Pagina ${pagina} saltata (fermo per questa tipologia)`);
                    totalePagineSaltate++;
                    continue;
                }

                console.log(`\n  📄 Pagina ${pagina}/${numPagine}`);
                
                if (pagina > 1) {
                    await cliccaPagina(page, pagina);
                }

                // Estrai TUTTE le gare
                const gareTotali = await estraiGareDaPagina(page, config.tipologia);
                
                // 🔧 APPLICA IL FILTRO BASATO SULLE DATE DI ISCRIZIONE
                const gareValide = [];
                const gareScartate = [];

                for (const g of gareTotali) {
                    const iscrizioni = parseIscrizioni(g.iscrizioni);
                    
                    // Se non ci sono date di iscrizione, scarta la gara
                    if (!iscrizioni.inizio || !iscrizioni.fine) {
                        gareScartate.push(g);
                        continue;
                    }
                    
                    const dataInizio = new Date(iscrizioni.inizio);
                    
                    // Se la data di inizio iscrizioni è >= DATA_FILTRO, la tengo
                    if (dataInizio >= DATA_FILTRO) {
                        gareValide.push(g);
                    } else {
                        gareScartate.push(g);
                    }
                }
                
                console.log(`    📋 Gare totali: ${gareTotali.length}`);
                console.log(`    📋 Gare valide (iscrizioni da gen 2026): ${gareValide.length}`);
                console.log(`    📋 Gare scartate (iscrizioni precedenti): ${gareScartate.length}`);
                
                totaleGareValide += gareValide.length;
                totaleGareScartate += gareScartate.length;
                
                // 🔧 LOGICA DI STOP: se TUTTE le gare sono scartate e la pagina non è vuota
                if (gareTotali.length > 0 && gareScartate.length === gareTotali.length) {
                    console.log(`  ⏹️ Tutte le gare sono precedenti al filtro. Fermo lo scraping per questa tipologia.`);
                    stopScraping = true;
                }
                
                // Mostra i dettagli delle prime 3 gare VALIDE
                if (gareValide.length > 0) {
                    console.log('\n  📋 DETTAGLI GARE VALIDE (prime 3):');
                    gareValide.slice(0, 3).forEach((g, i) => {
                        const iscrizioni = parseIscrizioni(g.iscrizioni);
                        console.log(`    ${i+1}. ${g.titolo}`);
                        console.log(`       Iscrizioni: ${iscrizioni.inizio || 'N/A'} → ${iscrizioni.fine || 'N/A'}`);
                        console.log(`       Tipologia: ${g.tipologia}`);
                        console.log(`       ---`);
                    });
                }
                
                // Mostra anche le prime 3 gare SCARTATE (per debug)
                if (gareScartate.length > 0 && gareValide.length === 0) {
                    console.log('\n  ⚠️ DETTAGLI GARE SCARTATE (prime 3):');
                    gareScartate.slice(0, 3).forEach((g, i) => {
                        const iscrizioni = parseIscrizioni(g.iscrizioni);
                        console.log(`    ${i+1}. ${g.titolo}`);
                        console.log(`       Iscrizioni: ${iscrizioni.inizio || 'N/A'} → ${iscrizioni.fine || 'N/A'}`);
                        console.log(`       Tipologia: ${g.tipologia}`);
                        console.log(`       ---`);
                    });
                }

                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n✅ [TEST] Completato:`);
        console.log(`  📊 Gare valide (iscrizioni da gen 2026): ${totaleGareValide}`);
        console.log(`  📊 Gare scartate (iscrizioni precedenti): ${totaleGareScartate}`);
        console.log(`  📄 Pagine visitate: ${totalePagine - totalePagineSaltate}`);
        console.log(`  ⏭️ Pagine saltate: ${totalePagineSaltate}`);
        console.log(`  ⏱️ Tempo: ${elapsed}s`);

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
    console.log('🧪 Avvio test (Fibis Challenge + Calabria, iscrizioni da gen 2026)...');
    try {
        await scrapeGareTest();
        console.log('✅ Test completato!');
    } catch (error) {
        console.error('❌ Errore durante il test:', error);
    }
})();