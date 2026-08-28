// src/services/firebaseService.js
import admin from 'firebase-admin';
import dotenv from 'dotenv';
dotenv.config();

// ============================================================
// INIZIALIZZAZIONE FIREBASE ADMIN
// ============================================================
let firebaseApp = null;

function initFirebase() {
    if (firebaseApp) return firebaseApp;

    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

    if (!privateKey || !projectId || !clientEmail) {
        console.warn('⚠️ Firebase non configurato. Le notifiche non funzioneranno.');
        console.warn('   Assicurati che FIREBASE_PRIVATE_KEY, FIREBASE_PROJECT_ID e FIREBASE_CLIENT_EMAIL siano impostate su Railway.');
        return null;
    }

    try {
        firebaseApp = admin.initializeApp({
            credential: admin.credential.cert({
                projectId,
                clientEmail,
                privateKey
            }),
            projectId
        });
        console.log('✅ Firebase Admin inizializzato correttamente');
        return firebaseApp;
    } catch (error) {
        console.error('❌ Errore inizializzazione Firebase:', error.message);
        return null;
    }
}

// ============================================================
// INVIO NOTIFICA SINGOLA
// ============================================================
export async function sendPushNotification(fcmToken, title, body, data = null) {
    try {
        const app = initFirebase();
        if (!app) {
            console.log('❌ Firebase non configurato, notifica non inviata');
            return null;
        }

        const message = {
            notification: {
                title,
                body,
            },
            token: fcmToken,
            data: data || {},
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                },
            },
            apns: {
                headers: {
                    'apns-priority': '10',
                },
                payload: {
                    aps: {
                        sound: 'default',
                    },
                },
            },
        };

        const response = await admin.messaging().send(message);
        console.log(`✅ Notifica inviata a: ${fcmToken.substring(0, 15)}...`);
        return response;
    } catch (error) {
        console.error('❌ Errore invio notifica:', error.message);
        return null;
    }
}

// ============================================================
// INVIO NOTIFICA MULTIPLA (batch)
// ============================================================
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

        // Firebase limita a 500 token per batch
        const tokens = fcmTokens.slice(0, 500);

        const message = {
            notification: {
                title,
                body,
            },
            tokens: tokens,
            data: data || {},
            android: {
                priority: 'high',
            },
            apns: {
                headers: {
                    'apns-priority': '10',
                },
            },
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`✅ Notifiche inviate: ${response.successCount}/${response.failureCount + response.successCount}`);
        
        // Log dei fallimenti
        if (response.failureCount > 0) {
            console.log(`⚠️ ${response.failureCount} notifiche fallite`);
            response.responses.forEach((res, i) => {
                if (!res.success) {
                    console.log(`   - Token ${i}: ${res.error?.message}`);
                }
            });
        }
        
        return response;
    } catch (error) {
        console.error('❌ Errore invio notifiche multiple:', error.message);
        return null;
    }
}

// ============================================================
// TEST CONNESSIONE FIREBASE
// ============================================================
export async function testFirebaseConnection() {
    const app = initFirebase();
    if (app) {
        console.log('✅ Connessione Firebase attiva');
        return true;
    } else {
        console.log('❌ Connessione Firebase fallita');
        return false;
    }
}