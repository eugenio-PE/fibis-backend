// src/routes/comunicatiRoutes.js
import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// ============================================================
// 1. CREA UN NUOVO COMUNICATO (SOLO ADMIN)
// ============================================================
router.post('/comunicati', authenticate, async (req, res) => {
    try {
        const { titolo, contenuto, destinatari, priorita, data_scadenza } = req.body;
        const userId = req.user.id;

        // Verifica che l'utente sia un manutentore/admin
        const { data: user, error: userError } = await supabaseAdmin
            .from('manutentori')
            .select('id, ruolo')
            .eq('user_id', userId)
            .single();

        if (userError || !user) {
            return res.status(403).json({ error: 'Non autorizzato' });
        }

        // Solo admin o presidenti possono creare comunicati
        if (!['admin', 'presidente'].includes(user.ruolo)) {
            return res.status(403).json({ error: 'Permessi insufficienti' });
        }

        const { data, error } = await supabaseAdmin
            .from('comunicati')
            .insert({
                titolo,
                contenuto,
                destinatari,
                priorita: priorita || 'normale',
                data_scadenza: data_scadenza || null,
                pubblicato: true,
                creato_da: user.id,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        // 🔥 TODO: Invia notifica push ai destinatari
        // await inviaNotificaComunicato(data);

        res.status(201).json({ success: true, comunicato: data });

    } catch (error) {
        console.error('❌ Errore creazione comunicato:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// ============================================================
// 2. OTTIENI I COMUNICATI PER UN UTENTE
// ============================================================
router.get('/comunicati', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        // Ottieni il ruolo dell'utente
        const { data: user, error: userError } = await supabaseAdmin
            .from('manutentori')
            .select('ruolo')
            .eq('user_id', userId)
            .maybeSingle();

        if (userError) {
            return res.status(400).json({ error: userError.message });
        }

        // Se non è un manutentore, è un tesserato
        const ruolo = user?.ruolo || 'tesserato';

        // Recupera i comunicati destinati a questo ruolo
        const { data, error } = await supabaseAdmin
            .from('comunicati')
            .select('*')
            .contains('destinatari', [ruolo])
            .eq('pubblicato', true)
            .order('data_pubblicazione', { ascending: false });

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        // Recupera i comunicati già letti da questo utente
        const { data: letti, error: lettiError } = await supabaseAdmin
            .from('comunicati_letti')
            .select('comunicato_id')
            .eq('user_id', userId);

        if (lettiError) {
            return res.status(400).json({ error: lettiError.message });
        }

        const lettiIds = letti.map(l => l.comunicato_id);

        // Aggiungi flag 'letto' a ogni comunicato
        const comunicatiConLetto = data.map(c => ({
            ...c,
            letto: lettiIds.includes(c.id)
        }));

        res.json({ success: true, comunicati: comunicatiConLetto });

    } catch (error) {
        console.error('❌ Errore recupero comunicati:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// ============================================================
// 3. SEGNA UN COMUNICATO COME LETTO
// ============================================================
router.post('/comunicati/:id/lettura', authenticate, async (req, res) => {
    try {
        const comunicatoId = parseInt(req.params.id);
        const userId = req.user.id;

        // Verifica che il comunicato esista
        const { data: comunicato, error: checkError } = await supabaseAdmin
            .from('comunicati')
            .select('id')
            .eq('id', comunicatoId)
            .single();

        if (checkError || !comunicato) {
            return res.status(404).json({ error: 'Comunicato non trovato' });
        }

        // Segna come letto (evita duplicati con UNIQUE)
        const { error } = await supabaseAdmin
            .from('comunicati_letti')
            .insert({
                comunicato_id: comunicatoId,
                user_id: userId,
                letto_il: new Date().toISOString()
            });

        if (error) {
            // Se è un duplicato, va bene
            if (error.code !== '23505') { // UNIQUE violation
                return res.status(400).json({ error: error.message });
            }
        }

        res.json({ success: true, message: 'Comunicato segnato come letto' });

    } catch (error) {
        console.error('❌ Errore segnatura lettura:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// ============================================================
// 4. OTTIENI IL NUMERO DI COMUNICATI NON LETTI
// ============================================================
router.get('/comunicati/non-letti', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        // Ottieni il ruolo dell'utente
        const { data: user, error: userError } = await supabaseAdmin
            .from('manutentori')
            .select('ruolo')
            .eq('user_id', userId)
            .maybeSingle();

        if (userError) {
            return res.status(400).json({ error: userError.message });
        }

        const ruolo = user?.ruolo || 'tesserato';

        // Recupera i comunicati non letti per questo ruolo
        const { data: comunicati, error } = await supabaseAdmin
            .from('comunicati')
            .select('id')
            .contains('destinatari', [ruolo])
            .eq('pubblicato', true);

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        const comunicatiIds = comunicati.map(c => c.id);

        if (comunicatiIds.length === 0) {
            return res.json({ success: true, nonLetti: 0 });
        }

        // Recupera quelli già letti
        const { data: letti, error: lettiError } = await supabaseAdmin
            .from('comunicati_letti')
            .select('comunicato_id')
            .eq('user_id', userId)
            .in('comunicato_id', comunicatiIds);

        if (lettiError) {
            return res.status(400).json({ error: lettiError.message });
        }

        const lettiIds = letti.map(l => l.comunicato_id);
        const nonLetti = comunicatiIds.filter(id => !lettiIds.includes(id)).length;

        res.json({ success: true, nonLetti });

    } catch (error) {
        console.error('❌ Errore conteggio non letti:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

export default router;