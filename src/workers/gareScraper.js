import { supabaseAdmin } from '../config/supabase.js';
import puppeteer from 'puppeteer';

// ============================================================
// CONFIGURAZIONE
// ============================================================
const BASE_URL = 'https://www.fibis.it/stecca/fibis-gare-stecca.html';

// Parametri da testare (aggiungi/modifica secondo necessità)
const TIPOLOGIE = [
    { id: '2', nome: 'Fibis Challenge' },
    { id: '4', nome: 'Istituzionale' },
    { id: '5', nome: 'Libera' },
    { id: '6', nome: 'Riservata' },
];

const COMITATI = [
    { id: '2', nome: 'Lombardia' },
    { id: '6', nome: 'Lazio' },
    { id: '12', nome: 'Sicilia' },
    // Aggiungi altri comitati se necessario
];

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
                // Costruisci l'URL con i parametri
                const url = `${BASE_URL}?id_tipologia=${tipologia.id}&id_comitato=${comitato.id}`;
                console.log(`\n📂 Scraping: ${tipologia.nome} - ${comitato.nome}`);
                console.log(`🔗 URL: ${url}`);

                // Vai alla pagina
                await page.goto(url, {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                });

                // Accetta i cookie (se presente il banner)
                try {
                    await page.waitForSelector('#iubenda-cs-banner .iubenda-cs-accept-btn', { timeout: 3000 });
                    await page.click('#iubenda-cs-banner .iubenda-cs-accept-btn');
                    console.log('  ✅ Cookie accettati');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (e) {
                    // Nessun banner cookie
                }

                // Aspetta che le gare vengano caricate
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Controlla se ci sono gare
                const gareCount = await page.evaluate(() => {
                    return document.querySelectorAll('.current_match').length;
                });

                console.log(`  📊 Gare trovate: ${gareCount}`);

                if (gareCount > 0) {
                    // Estrai i dati delle gare
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
                            
                            // Determina la tipologia dal contesto
                            let tipologia = 'Istituzionale';
                            if (item.closest('.challenge')) tipologia = 'Fibis Challenge';
                            else if (item.closest('.libera')) tipologia = 'Libera';
                            else if (item.closest('.riservata')) tipologia = 'Riservata';
                            
                            // Estrai categoria (es. "1^CATEGORIA", "2^CATEGORIA", "3^CATEGORIA")
                            const categoriaMatch = titolo.match(/(\d+)\s*[^CATEGORIA]*CATEGORIA/i);
                            const categoria = categoriaMatch ? `${categoriaMatch[1]}ª Categoria` : null;
                            
                            // Estrai regione dal contesto o dal comitato
                            // La regione è determinata dal comitato selezionato
                            let regione = null;
                            if (item.closest('.comitato')) {
                                const comitatoEl = item.closest('.comitato');
                                regione = comitatoEl?.textContent?.trim() || null;
                            }

                            return {
                                titolo,
                                giorno,
                                mese,
                                luogo,
                                iscrizioni,
                                linkLocandina,
                                isInternational,
                                tipologia,
                                categoria,      // ← NUOVO
                                regione,        // ← NUOVO
                            };
                        });
                    });

                    // Salva in Supabase
                    await saveGare(gare);
                    totaleGare += gare.length;
                }

                // Pausa tra una richiesta e l'altra
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
async function saveGare(gare) {
    console.log('  💾 Salvataggio in Supabase...');

    let saved = 0;
    let errors = 0;

    for (const gara of gare) {
        try {
            // Costruisci la data (giorno/mese - anno corrente)
            const dataStr = `${gara.giorno}/${gara.mese}/${new Date().getFullYear()}`;
            const data = new Date(dataStr);

            // Verifica se la gara esiste già
            const { data: existing } = await supabaseAdmin
                .from('gare')
                .select('id')
                .eq('nome', gara.titolo)
                .eq('data_gara', data.toISOString().split('T')[0])
                .maybeSingle();

            if (existing) {
                // console.log(`    ⏭️ Gara già esistente: ${gara.titolo}`);
                continue;
            }

            // Inserisci la nuova gara
            const { error } = await supabaseAdmin
                .from('gare')
                .insert({
                    nome: gara.titolo,
                    data_gara: data.toISOString().split('T')[0],
                    id_asd: null,
                    id_direttore: null,
                    nulla_osta: null,
                    tipologia: gara.tipologia,
                    categoria: gara.categoria,     // ← NUOVO
                    regione: gara.regione,         // ← NUOVO
                    stato: 'programmata',
                    inserito_da: null,
                    inserito_il: new Date().toISOString(),
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