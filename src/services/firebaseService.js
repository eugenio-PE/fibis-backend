// src/services/firebaseService.js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

let firebaseApp = null;
let messaging = null;

function getFirebaseApp() {
    if (firebaseApp) return firebaseApp;

    // ✅ Controlla se Firebase è già inizializzato
    if (getApps().length > 0) {
        firebaseApp = getApps()[0];
        messaging = getMessaging(firebaseApp);
        return firebaseApp;
    }

    // 🔥 USA LE VARIABILI D'AMBIENTE (Railway)
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
        console.error('❌ Variabili d\'ambiente Firebase mancanti!');
        console.error('   FIREBASE_PROJECT_ID:', projectId ? '✅' : '❌');
        console.error('   FIREBASE_CLIENT_EMAIL:', clientEmail ? '✅' : '❌');
        console.error('   FIREBASE_PRIVATE_KEY:', privateKey ? '✅' : '❌');
        return null;
    }

    // ✅ Gestisce le newline e le virgolette
    privateKey = privateKey
        .replace(/^"(.*)"$/, '$1')  // Rimuove virgolette esterne
        .replace(/\\n/g, '\n');      // Converte \n in newline

    console.log('✅ Firebase inizializzato con variabili d\'ambiente');
    console.log('   Project ID:', projectId);

    firebaseApp = initializeApp({
        credential: cert({
            projectId,
            clientEmail,
            privateKey,
        }),
    });

    messaging = getMessaging(firebaseApp);
    console.log('✅ Firebase Admin inizializzato correttamente');
    return firebaseApp;
}

export async function sendPushNotification(fcmToken, title, body, data = null) {
    try {
        const app = getFirebaseApp();  // ← INIZIALIZZA QUI
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
        return null;
    }
}

export async function sendPushNotificationMultiple(fcmTokens, title, body, data = null) {
    try {
        const app = getFirebaseApp();  // ← INIZIALIZZA QUI
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