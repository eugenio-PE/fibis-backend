import puppeteer from 'puppeteer';

async function testPaginazione() {
    console.log('🧪 TEST PAGINAZIONE - GARE LIBERE CAMPANIA\n');
    const startTime = Date.now();

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    try {
        // URL: Libera - Campania (id_tipologia=5, id_comitato=4)
        const url = 'https://www.fibis.it/stecca/fibis-gare-stecca.html?id_tipologia=5&id_comitato=4';
        console.log(`🔗 URL: ${url}`);

        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Leggi il totale degli eventi
        const totaleEventi = await page.evaluate(() => {
            const el = document.querySelector('.totale_eventi, .total, .pagination .info, .current_matches + div');
            return el ? el.textContent?.trim() : 'N/A';
        });
        console.log(`📊 Totale eventi: ${totaleEventi}`);

        // Leggi il numero di pagine
        const numPagine = await page.evaluate(() => {
            const pagination = document.querySelector('.pagination, .paging, .pager, .page-numbers');
            if (!pagination) return 1;
            
            const links = pagination.querySelectorAll('a, span');
            let max = 1;
            links.forEach(el => {
                const text = el.textContent?.trim() || '';
                const num = parseInt(text);
                if (!isNaN(num) && num > max) {
                    max = num;
                }
            });
            return max;
        });
        console.log(`📄 Numero di pagine: ${numPagine}`);

        // Scrapa tutte le pagine
        let totaleGare = 0;
        const tutteLeGare = [];

        for (let pagina = 1; pagina <= numPagine; pagina++) {
            console.log(`\n📄 Pagina ${pagina}/${numPagine}`);

            // Se non è la prima pagina, naviga
            if (pagina > 1) {
                // Cerca il link alla pagina
                await page.evaluate((p) => {
                    const links = document.querySelectorAll('.pagination a, .paging a, .pager a, .page-numbers a');
                    for (let link of links) {
                        const text = link.textContent?.trim() || '';
                        if (text === String(p)) {
                            link.click();
                            return;
                        }
                    }
                }, pagina);

                await page.waitForTimeout(2000);
                await page.waitForSelector('.current_match', { timeout: 10000 });
            }

            // Estrai le gare della pagina corrente
            const garePagina = await page.evaluate(() => {
                const items = document.querySelectorAll('.current_match');
                return Array.from(items).map(item => {
                    const titolo = item.querySelector('.info h5')?.textContent?.trim() || '';
                    const giorno = item.querySelector('.date_cont .day')?.textContent?.trim() || '';
                    const mese = item.querySelector('.date_cont .month')?.textContent?.trim() || '';
                    const luogo = item.querySelector('.loc')?.textContent?.trim() || '';
                    const iscrizioni = item.querySelector('.iscrizioni')?.textContent?.trim() || '';
                    return { titolo, giorno, mese, luogo, iscrizioni };
                });
            });

            console.log(`  📋 Gare trovate: ${garePagina.length}`);
            garePagina.forEach((g, i) => {
                console.log(`    ${i+1}. ${g.titolo} (${g.giorno} ${g.mese})`);
            });

            totaleGare += garePagina.length;
            tutteLeGare.push(...garePagina);

            // Aspetta tra una pagina e l'altra
            await page.waitForTimeout(1500);
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n✅ TEST COMPLETATO!`);
        console.log(`  📊 Totale gare trovate: ${totaleGare}`);
        console.log(`  📄 Pagine visitate: ${numPagine}`);
        console.log(`  ⏱️ Tempo totale: ${elapsed} secondi`);

    } catch (error) {
        console.error('❌ Errore:', error.message);
    } finally {
        await browser.close();
    }
}

testPaginazione();