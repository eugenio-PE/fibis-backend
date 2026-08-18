import { supabaseAdmin } from '../config/supabase.js';

// ============================================================
// WORKER DI SCRAPING PER IL RANKING
// Da eseguire con cron job (es. ogni notte alle 3:00 AM)
// ============================================================

// URL del ranking su FIBiS Gare (DA VERIFICARE/CAMBIARE)
const BASE_URL = 'https://fibisgare.it/ranking';
const DELAY_BETWEEN_REQUESTS = 1500; // 1.5 secondi

// Mappa qualifica → disciplina
const DISCIPLINE_MAP = {
    'Stecca': 'stecca',
    'Carambola': 'carambola',
    'Boccette': 'boccette',
    'Pool/Snooker': 'pool_snooker',
    'Bowling': 'bowling'
};

// ============================================================
// Funzione principale di scraping
// ============================================================
export async function scrapeRanking() {
    console.log('🔄 [SCRAPER] Avvio scraping ranking...');
    const startTime = Date.now();

    try {
        // Utilizza fetch nativo per ottenere la pagina
        // NOTA: Se il sito richiede JavaScript, dovrai usare Puppeteer
        // Per ora usiamo fetch con cheerio (più leggero)
        const allRankings = [];
        const discipline = ['stecca', 'carambola', 'boccette', 'pool_snooker', 'bowling'];

        for (const disciplina of discipline) {
            console.log(`📊 [SCRAPER] Scraping ${disciplina}...`);
            
            try {
                const url = `${BASE_URL}/${disciplina}`;
                const response = await fetch(url);
                const html = await response.text();
                
                // Parsing HTML base (senza cheerio, solo regex per esempio)
                // NOTA: Per un parsing robusto, installa cheerio: npm install cheerio
                const rankingData = parseRankingHTML(html, disciplina);
                
                console.log(`  ✅ Trovati ${rankingData.length} atleti per ${disciplina}`);
                allRankings.push(...rankingData);
                
                // Attendi prima della prossima richiesta
                await sleep(DELAY_BETWEEN_REQUESTS);
            } catch (error) {
                console.error(`  ❌ Errore scraping ${disciplina}:`, error.message);
            }
        }

        // Salva in Supabase
        await saveRankingSnapshot(allRankings);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ [SCRAPER] Scraping completato: ${allRankings.length} atleti in ${elapsed}s`);

        return allRankings;

    } catch (error) {
        console.error('❌ [SCRAPER] Errore durante lo scraping:', error);
        throw error;
    }
}

// ============================================================
// Parsing HTML (placeholder - da adattare al sito reale)
// ============================================================
function parseRankingHTML(html, disciplina) {
    // NOTA: Questa è una versione placeholder.
    // Dovrai adattare i selettori al sito FIBiS Gare reale.
    // Per un parsing robusto, usa cheerio: 
    // npm install cheerio
    // const cheerio = require('cheerio');
    // const $ = cheerio.load(html);
    // $('table.ranking tbody tr').each((i, row) => { ... });

    console.log(`  ℹ️ Parsing HTML per ${disciplina} - da implementare con cheerio`);

    // Placeholder: dati di esempio per test
    return [
        { nome: 'Mario', cognome: 'Rossi', posizione: 1, punteggio: 1250, categoria: 'Senior', disciplina },
        { nome: 'Luca', cognome: 'Bianchi', posizione: 2, punteggio: 1180, categoria: 'Senior', disciplina },
        { nome: 'Marco', cognome: 'Verdi', posizione: 3, punteggio: 1120, categoria: 'Senior', disciplina },
    ];
}

// ============================================================
// Salvataggio in Supabase
// ============================================================
async function saveRankingSnapshot(rankings) {
    console.log('💾 [SCRAPER] Salvataggio ranking in Supabase...');

    let saved = 0;
    let errors = 0;

    for (const ranking of rankings) {
        try {
            // Cerca il tesserato per nome e cognome
            const { data: tesserato } = await supabaseAdmin
                .from('tesserati')
                .select('id')
                .ilike('nome', ranking.nome)
                .ilike('cognome', ranking.cognome)
                .maybeSingle();

            if (tesserato) {
                // Calcola il trend (confronto con l'ultimo snapshot)
                const { data: previous } = await supabaseAdmin
                    .from('ranking_snapshot')
                    .select('posizione')
                    .eq('id_tesserato', tesserato.id)
                    .order('data_snapshot', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                const trend = previous ? previous.posizione - ranking.posizione : 0;

                // Salva lo snapshot
                await supabaseAdmin
                    .from('ranking_snapshot')
                    .insert({
                        id_tesserato: tesserato.id,
                        posizione: ranking.posizione,
                        punteggio: ranking.punteggio,
                        trend: trend,
                        categoria: ranking.categoria,
                        disciplina: ranking.disciplina
                    });

                saved++;
            } else {
                // Tesserato non trovato: salviamo comunque? Oppure logghiamo
                console.log(`  ⚠️ Tesserato non trovato: ${ranking.nome} ${ranking.cognome}`);
                errors++;
            }
        } catch (error) {
            console.error('❌ Errore salvataggio ranking:', error.message);
            errors++;
        }
    }

    console.log(`✅ [SCRAPER] Salvataggio completato: ${saved} salvati, ${errors} errori`);
}

// ============================================================
// Helper: sleep
// ============================================================
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Avvio diretto (per test)
// ============================================================
if (import.meta.url === `file://${process.argv[1]}`) {
    scrapeRanking().catch(console.error);
}