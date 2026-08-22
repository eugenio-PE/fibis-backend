import { supabaseAdmin } from '../config/supabase.js';
import puppeteer from 'puppeteer';

// ============================================================
// CONFIGURAZIONE
// ============================================================
const BASE_URL = 'https://www.fibis.it/stecca/fibis-gare-stecca.html';

// 🔧 MODIFICA PER TEST: usa solo una tipologia e un comitato
const TIPOLOGIE = [
    { id: '4', nome: 'Istituzionale' },
];

const COMITATI = [
    { id: '2', nome: 'Lombardia' },
];

// ============================================================
// MAPPA MESI ITALIANO → NUMERO
// ============================================================
const MESI_MAP = {
    'gen': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'mag': 5, 'giu': 6,
    'lug': 7, 'ago': 8, 'set': 9, 'ott': 10, 'nov': 11, 'dic': 12
};

// ============================================================
// FUNZIONE PER PARSARE LA DATA
// ============================================================
function parseDataItaliana(giorno, mese) {
    if (!giorno || !mese) return null;
    
    const meseNum = MESI_MAP[mese.toLowerCase()];
    if (!meseNum) return null;
    
    const anno = new Date().getFullYear();
    const dataStr = `${anno}-${String(meseNum).padStart(2, '0')}-${String(giorno).padStart(2, '0')}`;
    const data = new Date(dataStr);
    
    // Verifica che la data sia valida
    if (isNaN(data.getTime())) return null;
    
    return data;
}

// ============================================================
// FUNZIONE PER PARSARE LE DATE DI ISCRIZIONE
// ============================================================
function parseIscrizioni(iscrizioniText) {
    if (!iscrizioniText) return { inizio: null, fine: null };
    
    // Esempio: "Iscrizioni dal 04/05/2026 15:15 al 20/05/2026 13:00"
    const match = iscrizioniText.match(/dal\s+(\d{2}\/\d{2}\/\d{4})\s+[\d:]+\s+al\s+(\d{2}\/\d{2}\/\d{4})/);
    if (!match) return { inizio: null, fine: null };
    
    const [_, inizioStr, fineStr] = match;
    
    // Converti formato DD/MM/YYYY → YYYY-MM-DD
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
// FUNZIONE PRINCIPALE
// ============================================================
export async function scrapeGare() {
    console.log('🔄 [SCRAPER GARE] Avvio scraping...');
    const startTime = Date.now();
    let totaleGare = 0;

    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    try {
        for (const tipologia of TIPOLOGIE) {
            for (const comitato of COMITATI) {
                const url = `${BASE_URL}?id_tipologia=${tipologia.id}&id_comitato=${comitato.id}`;
                console.log(`\n📂 Scraping: ${tipologia.nome} - ${comitato.nome}`);
                console.log(`🔗 URL: ${url}`);

                await page.goto(url, {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                });

                try {
                    await page.waitForSelector('#iubenda-cs-banner .iubenda-cs-accept-btn', { timeout: 3000 });
                    await page.click('#iubenda-cs-banner .iubenda-cs-accept-btn');
                    console.log('  ✅ Cookie accettati');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (e) {
                    // Nessun banner cookie
                }

                await new Promise(resolve => setTimeout(resolve, 3000));

                const gareCount = await page.evaluate(() => {
                    return document.querySelectorAll('.current_match').length;
                });

                console.log(`  📊 Gare trovate: ${gareCount}`);

                if (gareCount > 0) {
                    const gare = await page.evaluate(() => {
                        const items = document.querySelectorAll('.current_match');
                        return Array.from(items).map(item => {
                            const titolo = item.querySelector('.info h5')?.textContent?.trim() || '';
                            const giorno = item.querySelector('.date_cont .day')?.textContent?.trim() || '';
                            const mese = item.querySelector('.date_cont .month')?.textContent?.trim() || '';
                            const luogo = item.querySelector('.loc')?.textContent?.trim() || '';
                            const iscrizioni = item.querySelector('.iscrizioni')?.textContent?.trim() || '';
                            const linkLocandina = item.querySelector('.locandina')?.href || '';
                            const isInternational = item.closest('.international') !== null;
                            
                            let tipologia = 'Istituzionale';
                            if (item.closest('.challenge')) tipologia = 'Fibis Challenge';
                            else if (item.closest('.libera')) tipologia = 'Libera';
                            else if (item.closest('.riservata')) tipologia = 'Riservata';
                            
                            const categoriaMatch = titolo.match(/(\d+)\s*[^CATEGORIA]*CATEGORIA/i);
                            const categoria = categoriaMatch ? `${categoriaMatch[1]}ª Categoria` : null;

                            return {
                                titolo,
                                giorno,
                                mese,
                                luogo,
                                iscrizioni,
                                linkLocandina,
                                isInternational,
                                tipologia,
                                categoria,
                            };
                        });
                    });

                    console.log('  📝 DEBUG - Prime 3 gare estratte:');
                    gare.slice(0, 3).forEach((g, i) => {
                        console.log(`    ${i+1}. Titolo: "${g.titolo}"`);
                        console.log(`       Giorno: "${g.giorno}", Mese: "${g.mese}"`);
                        console.log(`       Iscrizioni: "${g.iscrizioni}"`);
                        console.log(`       ---`);
                    });

                    await saveGare(gare, comitato.nome);
                    totaleGare += gare.length;
                }

                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n✅ [SCRAPER GARE] Completato: ${totaleGare} gare in ${elapsed}s`);

        return totaleGare;

    } catch (error) {
        console.error('❌ [SCRAPER GARE] Errore:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

// ============================================================
// SALVATAGGIO IN SUPABASE
// ============================================================
async function saveGare(gare, regioneDefault) {
    console.log('  💾 Salvataggio in Supabase...');

    let saved = 0;
    let errors = 0;

    for (const gara of gare) {
        try {
            // 1. Parserizza la data della gara
            const dataGara = parseDataItaliana(gara.giorno, gara.mese);
            if (!dataGara) {
                console.log(`    ⏭️ Salto: ${gara.titolo} - data non parsabile`);
                continue;
            }

            // 2. Parserizza le date di iscrizione
            const iscrizioni = parseIscrizioni(gara.iscrizioni);

            // 3. Verifica se la gara esiste già
            const { data: existing } = await supabaseAdmin
                .from('gare')
                .select('id')
                .eq('nome', gara.titolo)
                .eq('data_gara', dataGara.toISOString().split('T')[0])
                .maybeSingle();

            if (existing) {
                continue;
            }

// 4. Inserisci la nuova gara
const { error } = await supabaseAdmin
    .from('gare')
    .insert({
        nome: gara.titolo,
        data_gara: dataGara.toISOString().split('T')[0],
        id_asd: null,
        id_direttore: null,
        nulla_osta: 'N/A',  // Valore di default
        tipologia: gara.tipologia.toLowerCase(),  // ← MODIFICA QUI (aggiungi .toLowerCase())
        categoria: gara.categoria,
        regione: regioneDefault,
        stato: 'programmata',
        inserito_da: null,
        inserito_il: new Date().toISOString(),
        data_inizio_iscrizioni: iscrizioni.inizio,
        data_fine_iscrizioni: iscrizioni.fine,
        note: `Luogo: ${gara.luogo}`,
    });

            if (error) throw error;
            saved++;
            console.log(`    ✅ Salvata: ${gara.titolo}`);

        } catch (error) {
            console.error(`    ❌ Errore salvataggio: ${gara.titolo}`, error.message);
            errors++;
        }
    }

    if (saved > 0 || errors > 0) {
        console.log(`  📊 Salvataggio: ${saved} salvate, ${errors} errori`);
    }
}

// ============================================================
// AVVIO DIRETTO (per test)
// ============================================================
(async () => {
    console.log('🚀 Avvio manuale dello scraper gare...');
    try {
        await scrapeGare();
        console.log('✅ Scraping completato con successo!');
    } catch (error) {
        console.error('❌ Errore durante lo scraping:', error);
    }
})();