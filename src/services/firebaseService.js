// src/services/firebaseService.js
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let firebaseApp = null;
let messaging = null;

function initFirebase() {
    if (firebaseApp) return firebaseApp;

    try {
        const jsonPath = resolve(__dirname, '../../credentials/firebase.json');
        console.log('🔍 Cerco file in:', jsonPath);
        
        const serviceAccount = JSON.parse(readFileSync(jsonPath, 'utf8'));
        console.log('✅ File JSON letto. Project ID:', serviceAccount.project_id);

        firebaseApp = initializeApp({
            credential: cert(serviceAccount),
        });

        messaging = getMessaging(firebaseApp);
        console.log('✅ Firebase Admin inizializzato correttamente (con named imports)');
        return firebaseApp;
    } catch (error) {
        console.error('❌ Errore inizializzazione Firebase:', error.message);
        console.error('📚 Dettaglio:', error);
        return null;
    }
}

export async function sendPushNotification(fcmToken, title, body, data = null) {
    try {
        const app = initFirebase();
        if (!app) {
            console.log('❌ Firebase non configurato, notifica non inviata');
            return null;
        }

        const message = {
            notification: { title, body },
            token: fcmToken,
            data: data || {},
            android: { priority: 'high', notification: { sound: 'default' } },
            apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
        };

        const response = await messaging.send(message);
        console.log(`✅ Notifica inviata a: ${fcmToken.substring(0, 15)}...`);
        return response;
    } catch (error) {
        console.error('❌ Errore invio notifica:', error.message);
        console.error('📚 Dettaglio errore:', error);
        return null;
    }
}

export async function sendPushNotificationMultiple(fcmTokens, title, body, data = null) {
    try {
        const app = initFirebase();
        if (!app) {
            console.log('❌ Firebase non configurato, notifiche non inviate');
            return null;
        }

        if (!fcmTokens || fcmTokens.length === 0) {
            console.log('ℹ️ Nessun token FCM da inviare');
            return null;
        }

        const tokens = fcmTokens.slice(0, 500);
        const message = {
            notification: { title, body },
            tokens: tokens,
            data: data || {},
            android: { priority: 'high' },
            apns: { headers: { 'apns-priority': '10' } },
        };

        const response = await messaging.sendEachForMulticast(message);
        console.log(`✅ Notifiche inviate: ${response.successCount}/${response.failureCount + response.successCount}`);
        return response;
    } catch (error) {
        console.error('❌ Errore invio notifiche multiple:', error.message);
        return null;
    }
}