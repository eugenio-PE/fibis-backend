// src/controllers/notificationController.js
import { supabaseAdmin } from '../config/supabase.js';

// ============================================================
// SALVA IL TOKEN FCM DEL DISPOSITIVO
// POST /api/notifiche/device-token
// ============================================================
export const saveDeviceToken = async (req, res) => {
    try {
        const { fcm_token, device_os } = req.body;
        const userId = req.userId;

        if (!fcm_token) {
            return res.status(400).json({ error: 'FCM token obbligatorio' });
        }

        if (!device_os) {
            return res.status(400).json({ error: 'device_os obbligatorio (android, ios, web)' });
        }

        // 1. Recupera il tesserato associato all'utente
        const { data: tesserato, error: tesseratoError } = await supabaseAdmin
            .from('tesserati')
            .select('id')
            .eq('user_id', userId)
            .single();

        if (tesseratoError || !tesserato) {
            return res.status(404).json({ error: 'Tesserato non trovato per questo utente' });
        }

        // 2. Salva o aggiorna il token
        const { data, error } = await supabaseAdmin
            .from('device_tokens')
            .upsert({
                tesserato_id: tesserato.id,
                fcm_token: fcm_token,
                device_os: device_os,
                is_active: true,
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'tesserato_id, fcm_token'
            })
            .select()
            .single();

        if (error) {
            console.error('❌ Errore salvataggio token:', error);
            return res.status(500).json({ error: 'Errore salvataggio token' });
        }

        console.log(`✅ Token FCM salvato per tesserato ${tesserato.id}: ${fcm_token.substring(0, 15)}...`);
        res.json({ success: true, message: 'Token salvato con successo', data });

    } catch (error) {
        console.error('❌ Errore saveDeviceToken:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// ELIMINA TOKEN FCM (disattiva)
// DELETE /api/notifiche/device-token
// ============================================================
export const deleteDeviceToken = async (req, res) => {
    try {
        const { fcm_token } = req.body;
        const userId = req.userId;

        if (!fcm_token) {
            return res.status(400).json({ error: 'FCM token obbligatorio' });
        }

        // 1. Recupera il tesserato associato all'utente
        const { data: tesserato, error: tesseratoError } = await supabaseAdmin
            .from('tesserati')
            .select('id')
            .eq('user_id', userId)
            .single();

        if (tesseratoError || !tesserato) {
            return res.status(404).json({ error: 'Tesserato non trovato' });
        }

        // 2. Disattiva il token
        const { error } = await supabaseAdmin
            .from('device_tokens')
            .update({
                is_active: false,
                updated_at: new Date().toISOString()
            })
            .eq('tesserato_id', tesserato.id)
            .eq('fcm_token', fcm_token);

        if (error) {
            console.error('❌ Errore eliminazione token:', error);
            return res.status(500).json({ error: 'Errore eliminazione token' });
        }

        console.log(`✅ Token FCM disattivato per tesserato ${tesserato.id}`);
        res.json({ success: true, message: 'Token disattivato con successo' });

    } catch (error) {
        console.error('❌ Errore deleteDeviceToken:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// TEST NOTIFICA (invia una notifica di test)
// POST /api/notifiche/test
// ============================================================
export const sendTestNotification = async (req, res) => {
    try {
        const userId = req.userId;
        const { title, body } = req.body;

        // 1. Recupera il tesserato
        const { data: tesserato, error: tesseratoError } = await supabaseAdmin
            .from('tesserati')
            .select('id')
            .eq('user_id', userId)
            .single();

        if (tesseratoError || !tesserato) {
            return res.status(404).json({ error: 'Tesserato non trovato' });
        }

        // 2. Recupera il token del tesserato
        const { data: tokens, error: tokenError } = await supabaseAdmin
            .from('device_tokens')
            .select('fcm_token')
            .eq('tesserato_id', tesserato.id)
            .eq('is_active', true)
            .limit(1);

        if (tokenError || !tokens || tokens.length === 0) {
            return res.status(404).json({ error: 'Nessun token FCM attivo trovato per questo tesserato' });
        }

        const fcmToken = tokens[0].fcm_token;

        // 3. Importa la funzione di invio
        const { sendPushNotification } = await import('../services/firebaseService.js');

        const result = await sendPushNotification(
            fcmToken,
            title || '🔔 Test Notifica FIBiS',
            body || 'Questa è una notifica di test. Se la stai vedendo, le notifiche funzionano! ✅',
            { type: 'test', timestamp: new Date().toISOString() }
        );

        if (result) {
            res.json({ success: true, message: 'Notifica di test inviata con successo' });
        } else {
            res.status(500).json({ error: 'Errore invio notifica di test' });
        }

    } catch (error) {
        console.error('❌ Errore sendTestNotification:', error);
        res.status(500).json({ error: error.message });
    }
};