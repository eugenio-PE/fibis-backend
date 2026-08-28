import cron from 'node-cron';
import { scrapeRanking } from './rankingScraper.js';
import { checkAndSendNotifications } from './notificationWorker.js';

console.log('🕐 [CRON] Avvio Cron Job...');

// ============================================================
// JOB 1: Ranking - Ogni notte alle 3:00 AM
// ============================================================
cron.schedule('0 3 * * *', async () => {
    console.log('🔄 [CRON] Esecuzione job notturno (Ranking)...');
    try {
        await scrapeRanking();
        console.log('✅ [CRON] Job Ranking completato con successo');
    } catch (error) {
        console.error('❌ [CRON] Errore nel job Ranking:', error);
    }
});

// ============================================================
// JOB 2: Notifiche push - 2 volte al giorno (8:00 e 20:00)
// ============================================================
cron.schedule('0 8,20 * * *', async () => {
    console.log('📢 [CRON] Esecuzione job notifiche push...');
    try {
        await checkAndSendNotifications();
        console.log('✅ [CRON] Job Notifiche completato con successo');
    } catch (error) {
        console.error('❌ [CRON] Errore nel job Notifiche:', error);
    }
});

console.log('✅ [CRON] Cron Job avviato:');
console.log('   📊 Ranking → Ogni notte alle 3:00');
console.log('   📢 Notifiche → Ogni giorno alle 8:00 e 20:00');

// Mantieni il processo in esecuzione
process.stdin.resume();