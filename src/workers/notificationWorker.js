// src/workers/notificationWorker.js
import { supabaseAdmin } from '../config/supabase.js';
import { sendPushNotificationMultiple, testFirebaseConnection } from '../services/firebaseService.js';

// ============================================================
// FUNZIONE PRINCIPALE - CONTROLLO E INVIO NOTIFICHE
// ============================================================
export async function checkAndSendNotifications() {
    console.log('📢 [NOTIFICATION WORKER] Avvio controllo gare...');
    const startTime = Date.now();

    try {
        // Test connessione Firebase
        const firebaseOk = await testFirebaseConnection();
        if (!firebaseOk) {
            console.log('❌ Firebase non disponibile, interrompo');
            return;
        }

        const oggi = new Date().toISOString().split('T')[0];
        const domani = new Date(Date.now() + 86400000).toISOString().split('T')[0];

        // 1. Trova le gare con eventi imminenti
        const { data: gare, error } = await supabaseAdmin
            .from('gare')
            .select('id, nome, data_gara, data_inizio_iscrizioni, data_fine_iscrizioni, tipologia, regione, categoria')
            .eq('stato', 'programmata')
            .or(`data_inizio_iscrizioni.eq.${oggi},data_inizio_iscrizioni.eq.${domani},data_fine_iscrizioni.eq.${oggi}`)
            .order('data_gara', { ascending: true });

        if (error) {
            console.error('❌ Errore recupero gare:', error);
            return;
        }

        console.log(`📋 Trovate ${gare.length} gare con eventi imminenti`);

        if (gare.length === 0) {
            console.log('✅ Nessuna gara da notificare');
            return;
        }

        let totaleNotifiche = 0;
        let totaleGareNotificate = 0;

        for (const gara of gare) {
            console.log(`\n📋 Elaborazione: ${gara.nome} (ID: ${gara.id})`);

            // 2. Determina il tipo di notifica
            let tipo = null;
            let titolo = '';
            let messaggio = '';

            if (gara.data_inizio_iscrizioni === domani) {
                tipo = 'apertura_domani';
                titolo = `🔜 ${gara.nome}`;
                messaggio = `Le iscrizioni per "${gara.nome}" aprono DOMANI! Preparati!`;
            } else if (gara.data_inizio_iscrizioni === oggi) {
                tipo = 'apertura_oggi';
                titolo = `📢 ${gara.nome}`;
                messaggio = `Le iscrizioni per "${gara.nome}" sono APERTE! Iscriviti ora!`;
            } else if (gara.data_fine_iscrizioni === oggi) {
                tipo = 'ultimo_giorno';
                titolo = `⏳ ${gara.nome}`;
                messaggio = `⚠️ ULTIMO GIORNO per iscriverti a "${gara.nome}"!`;
            }

            if (!tipo) continue;

            // 3. Verifica se la notifica è già stata inviata (evita duplicati)
            const { data: notificaEsistente } = await supabaseAdmin
                .from('notifiche_inviate')
                .select('id')
                .eq('id_gara', gara.id)
                .eq('tipo', tipo)
                .maybeSingle();

            if (notificaEsistente) {
                console.log(`  ⏭️ Notifica "${tipo}" già inviata per ${gara.nome}, salto`);
                continue;
            }

            // 4. Trova i tesserati che possono partecipare a questa gara
            const tesserati = await getTesseratiPerGara(gara);
            if (tesserati.length === 0) {
                console.log(`  ℹ️ Nessun tesserato idoneo per ${gara.nome}`);
                continue;
            }

            console.log(`  🎯 Tesserati idonei: ${tesserati.length}`);

            // 5. Recupera i token FCM di questi tesserati
            const tesseratiConToken = await getTokensTesserati(tesserati.map(t => t.id));
            const tokens = tesseratiConToken.map(t => t.fcm_token).filter(t => t);

            if (tokens.length === 0) {
                console.log(`  ℹ️ Nessun token FCM valido per ${gara.nome}`);
                continue;
            }

            console.log(`  📱 Token FCM trovati: ${tokens.length}`);

            // 6. Invia le notifiche
            await sendPushNotificationMultiple(tokens, titolo, messaggio, {
                gara_id: String(gara.id),
                tipo: tipo,
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
            });

            // 7. Registra l'invio nel database
            await registraInvioNotifica(gara.id, tipo, tokens.length);

            totaleNotifiche += tokens.length;
            totaleGareNotificate++;
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n✅ [NOTIFICATION WORKER] Completato in ${elapsed}s`);
        console.log(`  📊 Gare notificate: ${totaleGareNotificate}`);
        console.log(`  📱 Notifiche inviate: ${totaleNotifiche}`);

    } catch (error) {
        console.error('❌ [NOTIFICATION WORKER] Errore:', error);
    }
}

// ============================================================
// FUNZIONI DI SUPPORTO
// ============================================================

/**
 * Recupera i tesserati che possono partecipare a una gara
 * Filtra per regione e categoria (come fa l'app)
 */
async function getTesseratiPerGara(gara) {
    try {
        let query = supabaseAdmin
            .from('tesserati')
            .select('id, nome, cognome, regione, categoria_ranking')
            .eq('regione', gara.regione);

        // Filtra per categoria se specificata
        if (gara.categoria) {
            query = query.eq('categoria_ranking', gara.categoria);
        }

        const { data, error } = await query;

        if (error) {
            console.error(`❌ Errore recupero tesserati per ${gara.nome}:`, error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('❌ Errore getTesseratiPerGara:', error);
        return [];
    }
}

/**
 * Recupera i token FCM dei tesserati
 */
async function getTokensTesserati(tesseratiIds) {
    if (!tesseratiIds || tesseratiIds.length === 0) return [];

    try {
        const { data, error } = await supabaseAdmin
            .from('device_tokens')
            .select('tesserato_id, fcm_token, device_os')
            .in('tesserato_id', tesseratiIds)
            .eq('is_active', true);

        if (error) {
            console.error('❌ Errore recupero token FCM:', error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('❌ Errore getTokensTesserati:', error);
        return [];
    }
}

/**
 * Registra l'invio della notifica nel database
 */
async function registraInvioNotifica(garaId, tipo, count) {
    try {
        const { error } = await supabaseAdmin
            .from('notifiche_inviate')
            .insert({
                id_gara: garaId,
                tipo: tipo,
                destinatari_count: count,
                inviata_il: new Date().toISOString(),
            });

        if (error) {
            console.error('❌ Errore registrazione notifica:', error);
        }
    } catch (error) {
        console.error('❌ Errore registraInvioNotifica:', error);
    }
}

// ============================================================
// AVVIO DIRETTO (per test)
// ============================================================
(async () => {
    console.log('🚀 Avvio manuale notificationWorker...');
    try {
        await checkAndSendNotifications();
        console.log('✅ Test completato!');
    } catch (error) {
        console.error('❌ Errore durante il test:', error);
    }
})();