// src/services/firebaseService.js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { supabaseAdmin } from '../config/supabase.js';

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
// ============================================================
// INVIA PUSH CHIAMATA PARTITA
// ============================================================
// Invia una notifica ai 2 giocatori + arbitro quando Luca
// chiama una partita.
//
// Parametri:
// - id_tesserato_1, id_tesserato_2: i 2 giocatori
// - id_arbitro: l'arbitro assegnato
// - info_partita: { fase, posizione, biliardo, numero_chiamata, timer_minuti }
//
// TODO PRODUZIONE: se un giocatore non ha device_token, la push
// non parte. In futuro, potremmo inviare anche SMS o email.
// ============================================================

export async function inviaPushChiamata(
  id_tesserato_1,
  id_tesserato_2,
  id_arbitro,
  info_partita
) {
  try {
    //const { supabaseAdmin } = await import('../config/supabase.js');

    // 1. Recupera i device_token dei 2 giocatori
    const idTesserati = [id_tesserato_1, id_tesserato_2].filter(Boolean);
    const { data: tokensTesserati } = await supabaseAdmin
      .from('device_tokens')
      .select('fcm_token, tesserato_id')
      .in('tesserato_id', idTesserati)
      .eq('is_active', true);

    // 2. Recupera il device_token dell'arbitro
    let tokensArbitro = [];
    if (id_arbitro) {
      const { data: tokens } = await supabaseAdmin
        .from('device_tokens')
        .select('fcm_token, manutentore_id')
        .eq('manutentore_id', id_arbitro)
        .eq('is_active', true);
      tokensArbitro = tokens || [];
    }

    // 3. Recupera i nomi dei giocatori per il messaggio
    const { data: tesserati } = await supabaseAdmin
      .from('tesserati')
      .select('id, nome, cognome')
      .in('id', idTesserati);

    const giocatore1 = tesserati?.find(t => t.id === id_tesserato_1);
    const giocatore2 = tesserati?.find(t => t.id === id_tesserato_2);

    const nomeG1 = giocatore1 ? `${giocatore1.cognome} ${giocatore1.nome}` : 'Giocatore 1';
    const nomeG2 = giocatore2 ? `${giocatore2.cognome} ${giocatore2.nome}` : 'Giocatore 2';

    // 4. Prepara il messaggio
    const numeroChiamata = info_partita.numero_chiamata || 1;
    const faseLabel = 
      info_partita.fase === 'quarti' ? 'Quarti' :
      info_partita.fase === 'semifinale' ? 'Semifinale' :
      info_partita.fase === 'finale' ? 'Finale' : info_partita.fase;

    const title = `📢 Chiamata #${numeroChiamata} — ${faseLabel}`;
    const body = `${nomeG1} vs ${nomeG2}${info_partita.biliardo ? ` — Biliardo ${info_partita.biliardo}` : ''}`;

    const data = {
      tipo: 'chiamata_partita',
      id_batteria_partita: String(info_partita.id_batteria_partita || ''),
      numero_chiamata: String(numeroChiamata),
      fase: info_partita.fase || '',
      biliardo: info_partita.biliardo || '',
      timer_minuti: String(info_partita.timer_minuti || 10),
      timestamp: new Date().toISOString()
    };

    // 5. Invia push ai giocatori
    const tuttiTokens = [
      ...(tokensTesserati || []).map(t => t.fcm_token),
      ...tokensArbitro.map(t => t.fcm_token)
    ];

    if (tuttiTokens.length === 0) {
      console.log('ℹ️ Nessun device_token attivo per questa chiamata');
      return { inviati: 0, totale: 0 };
    }

    const result = await sendPushNotificationMultiple(tuttiTokens, title, body, data);

    // 6. Log
    const successCount = result?.successCount || 0;
    console.log(`📢 Push chiamata: ${successCount}/${tuttiTokens.length} inviate`);

    // 7. TODO PRODUZIONE: registra in notifiche_inviate
    // await supabaseAdmin.from('notifiche_inviate').insert({...});

    return { inviati: successCount, totale: tuttiTokens.length };

  } catch (error) {
    console.error('❌ Errore inviaPushChiamata:', error);
    return { inviati: 0, totale: 0, errore: error.message };
  }
}