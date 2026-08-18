import cron from 'node-cron';
import { scrapeRanking } from './rankingScraper.js';

console.log('🕐 [CRON] Avvio Cron Job...');

// Esegui ogni notte alle 3:00 AM
cron.schedule('0 3 * * *', async () => {
    console.log('🔄 [CRON] Esecuzione job notturno...');
    try {
        await scrapeRanking();
        console.log('✅ [CRON] Job completato con successo');
    } catch (error) {
        console.error('❌ [CRON] Errore nel job:', error);
    }
});

console.log('✅ [CRON] Cron Job avviato - In esecuzione ogni notte alle 3:00 AM');

// Mantieni il processo in esecuzione
process.stdin.resume();