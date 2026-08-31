// src/routes/iscrizioniRoutes.js
import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// ============================================================
// POST /api/iscrizioni/:id/giorno - Aggiorna il giorno scelto
// ============================================================
router.post('/:id/giorno', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { giorno } = req.body;
        const userId = req.user.id;

        if (!giorno) {
            return res.status(400).json({ error: 'Giorno mancante' });
        }

        // Verifica che l'iscrizione appartenga all'utente
        const { data: iscrizione, error: findError } = await supabaseAdmin
            .from('iscrizioni_gare')
            .select('user_id, stato')
            .eq('id', id)
            .single();

        if (findError || !iscrizione) {
            return res.status(404).json({ error: 'Iscrizione non trovata' });
        }

        if (iscrizione.user_id !== userId) {
            return res.status(403).json({ error: 'Non autorizzato' });
        }

        if (iscrizione.stato !== 'in_attesa_giorni') {
            return res.status(400).json({ 
                error: `Stato non valido: ${iscrizione.stato}. Deve essere 'in_attesa_giorni'` 
            });
        }

        // Aggiorna il giorno
        const { error: updateError } = await supabaseAdmin
            .from('iscrizioni_gare')
            .update({
                giorno_iscrizione: giorno,
                stato: 'in_attesa_completamento'
            })
            .eq('id', id);

        if (updateError) {
            throw updateError;
        }

        res.json({
            success: true,
            message: 'Giorno selezionato con successo',
            id: id,
            giorno: giorno,
            stato: 'in_attesa_completamento'
        });

    } catch (error) {
        console.error('❌ Errore aggiornamento giorno:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;