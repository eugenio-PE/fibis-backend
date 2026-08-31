// src/routes/comunicatiRoutes.js
import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// ✅ MAPPA RUOLI (singolare → plurale)
const ruoliMappa = {
    'tesserato': 'tesserati',
    'presidente': 'presidenti',
    'direttore': 'direttori',
    'manutentore': 'manutentori',
};

// ============================================================
// 1. CREA UN NUOVO COMUNICATO (SOLO ADMIN)
// ============================================================
router.post('/', authenticate, async (req, res) => {
    try {
        const { titolo, contenuto, destinatari, priorita, data_scadenza } = req.body;
        const userId = req.user.id;

        const { data: user, error: userError } = await supabaseAdmin
            .from('manutentori')
            .select('id, ruolo')
            .eq('user_id', userId)
            .single();

        if (userError || !user) {
            return res.status(403).json({ error: 'Non autorizzato' });
        }

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

        res.status(201).json({ success: true, comunicato: data });

    } catch (error) {
        console.error('❌ Errore creazione comunicato:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// ============================================================
// 2. OTTIENI I COMUNICATI PER UN UTENTE (USA RPC)
// ============================================================
router.get('/', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        const { data: user, error: userError } = await supabaseAdmin
            .from('manutentori')
            .select('ruolo')
            .eq('user_id', userId)
            .maybeSingle();

        if (userError) {
            return res.status(400).json({ error: userError.message });
        }

        const ruolo = user?.ruolo || 'tesserato';
        // ✅ NORMALIZZA IL RUOLO (singolare → plurale)
        const ruoloNormalizzato = ruoliMappa[ruolo] || ruolo;

        console.log(`🔍 Ruolo: ${ruolo} → normalizzato: ${ruoloNormalizzato}`);

        // ✅ USA RPC PER IL FILTRO (funzione creata in Supabase)
        const { data, error } = await supabaseAdmin
            .rpc('get_comunicati_per_ruolo', { ruolo_input: ruoloNormalizzato });

        if (error) {
            console.error('❌ Errore RPC:', error);
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
router.post('/:id/lettura', authenticate, async (req, res) => {
    try {
        const comunicatoId = parseInt(req.params.id);
        const userId = req.user.id;

        const { data: comunicato, error: checkError } = await supabaseAdmin
            .from('comunicati')
            .select('id')
            .eq('id', comunicatoId)
            .single();

        if (checkError || !comunicato) {
            return res.status(404).json({ error: 'Comunicato non trovato' });
        }

        const { error } = await supabaseAdmin
            .from('comunicati_letti')
            .insert({
                comunicato_id: comunicatoId,
                user_id: userId,
                letto_il: new Date().toISOString()
            });

        if (error) {
            if (error.code !== '23505') {
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
// 4. OTTIENI IL NUMERO DI COMUNICATI NON LETTI (USA RPC)
// ============================================================
router.get('/non-letti', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        const { data: user, error: userError } = await supabaseAdmin
            .from('manutentori')
            .select('ruolo')
            .eq('user_id', userId)
            .maybeSingle();

        if (userError) {
            return res.status(400).json({ error: userError.message });
        }

        const ruolo = user?.ruolo || 'tesserato';
        // ✅ NORMALIZZA IL RUOLO (singolare → plurale)
        const ruoloNormalizzato = ruoliMappa[ruolo] || ruolo;

        // ✅ USA RPC PER IL FILTRO
        const { data: comunicati, error } = await supabaseAdmin
            .rpc('get_comunicati_per_ruolo', { ruolo_input: ruoloNormalizzato });

        if (error) {
            console.error('❌ Errore RPC (non-letti):', error);
            return res.status(400).json({ error: error.message });
        }

        const comunicatiIds = comunicati.map(c => c.id);

        if (comunicatiIds.length === 0) {
            return res.json({ success: true, nonLetti: 0 });
        }

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