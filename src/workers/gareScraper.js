// src/workers/gareScraper.js
import { supabaseAdmin } from '../config/supabase.js';
import puppeteer from 'puppeteer';

// ============================================================
// CONFIGURAZIONE PRODUZIONE
// ============================================================
const BASE_URL = 'https://www.fibis.it/stecca/fibis-gare-stecca.html';

// 🔧 MAPPA MESI ITALIANO → NUMERO
const MESI_MAP = {
    'gen': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'mag': 5, 'giu': 6,
    'lug': 7, 'ago': 8, 'set': 9, 'ott': 10, 'nov': 11, 'dic': 12
};

// 🔧 TUTTE le tipologie
const TIPOLOGIE = [
    { id: '2', nome: 'Fibis Challenge', hasComitato: false },
    { id: '4', nome: 'Istituzionale', hasComitato: true },
    { id: '5', nome: 'Libera', hasComitato: true },
    { id: '6', nome: 'Riservata', hasComitato: true },
];

// 🔧 TUTTI i comitati regionali
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
// FUNZIONI PER GESTIRE I SEGNALIBRI PER COMBINAZIONE
// ============================================================

// Ottiene l'ultima data di SCRAPER per una combinazione
async function getUltimaDataPerCombinazione(tipologiaId, comitatoId) {
    const nomeComitato = comitatoId ? COMITATI.find(c => c.id === comitatoId)?.nome || 'Nazionale' : 'Nazionale';
    const tipologia = TIPOLOGIE.find(t => t.id === tipologiaId);
    
    const { data, error } = await supabaseAdmin
        .from('scraper_combinazioni')
        .select('ultima_data')
        .eq('tipologia', tipologia.nome)
        .eq('comitato', nomeComitato)
        .maybeSingle();
    
    if (error || !data) {
        // Se non esiste, usa il 1° gennaio 2026 come fallback
        console.log(`  ⚠️ Nessun segnalibro per ${tipologia.nome}-${nomeComitato}, uso fallback: 2026-01-01`);
        return new Date('2026-01-01');
    }
    
    return new Date(data.ultima_data);
}

// Aggiorna il segnalibro con la DATA DELLO SCRAPER (OGGI)
async function aggiornaUltimaDataPerCombinazione(tipologiaId, comitatoId) {
    const nomeComitato = comitatoId ? COMITATI.find(c => c.id === comitatoId)?.nome || 'Nazionale' : 'Nazionale';
    const tipologia = TIPOLOGIE.find(t => t.id === tipologiaId);
    
    // 🔥 DATA DI OGGI (QUANDO VIENE ESEGUITO LO SCRAPER)
    const oggi = new Date().toISOString().split('T')[0];
    
    const { error } = await supabaseAdmin
        .from('scraper_combinazioni')
        .upsert({
            tipologia: tipologia.nome,
            comitato: nomeComitato,
            ultima_data: oggi,  // ← DATA DELLO SCRAPER!
            ultimo_aggiornamento: new Date().toISOString()
        }, {
            onConflict: 'tipologia, comitato'
        });
    
    if (error) {
        console.error(`  ❌ Errore aggiornamento segnalibro per ${tipologia.nome}-${nomeComitato}:`, error);
    }
}

// ============================================================
// FUNZIONE PER PARSARE LA DATA DELLA GARA
// ============================================================
function parseDataGara(giorno, mese, anno) {
    if (!giorno || !mese) return null;
    
    const meseNum = MESI_MAP[mese.toLowerCase()];
    if (!meseNum) return null;
    
    const annoFinale = anno || new Date().getFullYear();
    const dataStr = `${annoFinale}-${String(meseNum).padStart(2, '0')}-${String(giorno).padStart(2, '0')}`;
    const data = new Date(dataStr);
    
    if (isNaN(data.getTime())) return null;
    return data;
}

// ============================================================
// FUNZIONE PER PARSARE LE DATE DI ISCRIZIONE
// ============================================================
function parseIscrizioni(iscrizioniText) {
    if (!iscrizioniText) return { inizio: null, fine: null, anno: null };
    
    const match = iscrizioniText.match(/dal\s+(\d{2}\/\d{2}\/\d{4})\s+[\d:]+\s+al\s+(\d{2}\/\d{2}\/\d{4})/);
    if (!match) return { inizio: null, fine: null, anno: null };
    
    const [_, inizioStr, fineStr] = match;
    
    const parseData = (str) => {
        const [day, month, year] = str.split('/');
        return `${year}-${month}-${day}`;
    };
    
    const annoMatch = inizioStr.match(/(\d{4})/);
    const anno = annoMatch ? parseInt(annoMatch[1]) : null;
    
    return {
        inizio: parseData(inizioStr),
        fine: parseData(fineStr),
        anno: anno
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
            const locandinaLink = item.querySelector('.locandina')?.getAttribute('href') || '';
            
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
                locandinaLink,
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
// FUNZIONE PER PROCESSARE UNA TIPOLOGIA + COMITATO
// ============================================================
async function processaTipologia(page, tipologia, comitato) {
    const nomeComitato = comitato ? comitato.nome : 'Nazionale';
    const nomeTipologia = tipologia.nome;
    const tipologiaId = tipologia.id;
    const comitatoId = comitato?.id || null;
    
    // Contatori per questa combinazione
    let gareValide = 0;
    let gareScartate = 0;
    let pagineVisitate = 0;
    let pagineSaltate = 0;
    let salvate = 0;
    let errori = 0;
    
    // 🔧 LEGGI IL SEGNALIBRO SPECIFICO PER QUESTA COMBINAZIONE
    const dataFiltro = await getUltimaDataPerCombinazione(tipologiaId, comitatoId);
    
    // 🔧 Se il segnalibro è OGGI, salta (già eseguito oggi)
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);
    
    if (dataFiltro >= oggi) {
        console.log(`\n📂 ${nomeTipologia} - ${nomeComitato} ⏭️ (già eseguito oggi, aspetta domani)`);
        return { gareValide, gareScartate, pagineVisitate, pagineSaltate: 1, salvate, errori };
    }
    
    console.log(`\n📂 ${nomeTipologia} - ${nomeComitato} (ultimo scraper: ${dataFiltro.toLocaleDateString()})`);
    
    // Costruisci l'URL
    let url = `${BASE_URL}?id_tipologia=${tipologia.id}`;
    if (comitato) {
        url += `&id_comitato=${comitato.id}`;
    }

    await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
    });

    // Accetta i cookie se presenti
    try {
        await page.waitForSelector('#iubenda-cs-banner .iubenda-cs-accept-btn', { timeout: 3000 });
        await page.click('#iubenda-cs-banner .iubenda-cs-accept-btn');
        await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {}

    const numPagine = await getNumeroPagine(page);
    
    let stopScraping = false;

    for (let pagina = 1; pagina <= numPagine; pagina++) {
        if (stopScraping) {
            pagineSaltate++;
            continue;
        }

        if (pagina > 1) {
            await cliccaPagina(page, pagina);
        }

        const gareTotali = await estraiGareDaPagina(page, tipologia.nome);
        
        // Applica il filtro sulle date di iscrizione (usando dataFiltro)
        const gareValidePagina = [];
        const gareScartatePagina = [];

        for (const g of gareTotali) {
            const iscrizioni = parseIscrizioni(g.iscrizioni);
            if (!iscrizioni.inizio || !iscrizioni.fine) {
                gareScartatePagina.push(g);
                continue;
            }
            
            const dataInizio = new Date(iscrizioni.inizio);
            // 🔥 FILTRO: data_gara >= data_ultimo_scraper
            if (dataInizio >= dataFiltro) {
                gareValidePagina.push(g);
            } else {
                gareScartatePagina.push(g);
            }
        }

        gareValide += gareValidePagina.length;
        gareScartate += gareScartatePagina.length;
        pagineVisitate++;

        console.log(`  📄 Pag ${pagina}/${numPagine}: ${gareValidePagina.length} valide, ${gareScartatePagina.length} scartate`);

        // STOP: se tutte le gare sono scartate
        if (gareTotali.length > 0 && gareScartatePagina.length === gareTotali.length) {
            stopScraping = true;
        }

        // Salva le gare valide
        if (gareValidePagina.length > 0) {
            const risultato = await saveGare(gareValidePagina, nomeComitato);
            salvate += risultato.salvate;
            errori += risultato.errori;
        }

        await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    // 🔧 AGGIORNA IL SEGNALIBRO CON LA DATA DI OGGI (SCRAPER)
    await aggiornaUltimaDataPerCombinazione(tipologiaId, comitatoId);
    
    return { gareValide, gareScartate, pagineVisitate, pagineSaltate, salvate, errori };
}

// ============================================================
// SALVATAGGIO IN SUPABASE
// ============================================================
async function saveGare(gare, regioneDefault) {
    let saved = 0;
    let errors = 0;
    let skipped = 0;

    for (const gara of gare) {
        try {
            const iscrizioni = parseIscrizioni(gara.iscrizioni);
            if (!iscrizioni.inizio || !iscrizioni.fine) {
                skipped++;
                continue;
            }

            const anno = iscrizioni.anno || new Date().getFullYear();
            const dataGara = parseDataGara(gara.giorno, gara.mese, anno);
            const dataGaraFinale = dataGara ? dataGara.toISOString().split('T')[0] : iscrizioni.inizio;

            // Verifica duplicati
            const { data: existing, error: checkError } = await supabaseAdmin
                .from('gare')
                .select('id')
                .eq('nome', gara.titolo)
                .eq('data_inizio_iscrizioni', iscrizioni.inizio)
                .maybeSingle();

            if (checkError) {
                console.error(`    ❌ Errore verifica: ${gara.titolo}`, checkError.message);
                errors++;
                continue;
            }

            if (existing) {
                skipped++;
                continue;
            }

            const { error } = await supabaseAdmin
    .from('gare')
    .insert({
        nome: gara.titolo,
        data_gara: dataGaraFinale,
        id_asd: null,
        id_direttore: null,
        nulla_osta: 'N/A',
        tipologia: gara.tipologia ? gara.tipologia.toLowerCase() : 'istituzionale',
        categoria: gara.categoria,
        regione: regioneDefault,
        stato: 'programmata',
        inserito_da: null,
        inserito_il: new Date().toISOString(),
        data_inizio_iscrizioni: iscrizioni.inizio,
        data_fine_iscrizioni: iscrizioni.fine,
        note: `Luogo: ${gara.luogo}`,
        locandina_url: gara.locandinaLink ? `https://www.fibis.it${gara.locandinaLink}` : null,
    });

            if (error) {
                console.error(`    ❌ Errore: ${gara.titolo}`, error.message);
                errors++;
            } else {
                saved++;
            }
        } catch (error) {
            console.error(`    ❌ Errore: ${gara.titolo}`, error.message);
            errors++;
        }
    }

    if (saved > 0 || skipped > 0 || errors > 0) {
        console.log(`  💾 Salvate: ${saved}, Già presenti: ${skipped}, Errori: ${errors}`);
    }
    
    return { salvate: saved, errori: errors };
}

// ============================================================
// FUNZIONE PRINCIPALE
// ============================================================
export async function scrapeGare() {
    console.log('🔄 [SCRAPER GARE] Avvio produzione...');
    const startTime = Date.now();

    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    let totaleGareValide = 0;
    let totaleGareScartate = 0;
    let totalePagineVisitate = 0;
    let totalePagineSaltate = 0;
    let totaleSalvate = 0;
    let totaliErrori = 0;

    try {
        for (const tipologia of TIPOLOGIE) {
            if (!tipologia.hasComitato) {
                const risultato = await processaTipologia(page, tipologia, null);
                totaleGareValide += risultato.gareValide;
                totaleGareScartate += risultato.gareScartate;
                totalePagineVisitate += risultato.pagineVisitate;
                totalePagineSaltate += risultato.pagineSaltate;
                totaleSalvate += risultato.salvate;
                totaliErrori += risultato.errori;
                continue;
            }
            
            for (const comitato of COMITATI) {
                const risultato = await processaTipologia(page, tipologia, comitato);
                totaleGareValide += risultato.gareValide;
                totaleGareScartate += risultato.gareScartate;
                totalePagineVisitate += risultato.pagineVisitate;
                totalePagineSaltate += risultato.pagineSaltate;
                totaleSalvate += risultato.salvate;
                totaliErrori += risultato.errori;
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n✅ [SCRAPER GARE] Completato:`);
        console.log(`  📊 Gare valide: ${totaleGareValide}`);
        console.log(`  📊 Gare scartate: ${totaleGareScartate}`);
        console.log(`  📄 Pagine visitate: ${totalePagineVisitate}`);
        console.log(`  ⏭️ Pagine saltate: ${totalePagineSaltate}`);
        console.log(`  💾 Salvate in DB: ${totaleSalvate}`);
        console.log(`  ❌ Errori: ${totaliErrori}`);
        console.log(`  ⏱️ Tempo: ${elapsed}s`);

        return { totaleGareValide, totaleGareScartate, totaleSalvate };

    } catch (error) {
        console.error('❌ [SCRAPER GARE] Errore:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

// ============================================================
// AVVIO DIRETTO (per test)
// ============================================================
(async () => {
    console.log('🚀 Avvio scraper gare (produzione)...');
    try {
        await scrapeGare();
        console.log('✅ Scraping completato con successo!');
    } catch (error) {
        console.error('❌ Errore durante lo scraping:', error);
    }
})();