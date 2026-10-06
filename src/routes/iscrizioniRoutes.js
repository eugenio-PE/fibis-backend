// src/routes/iscrizioniRoutes.js
import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// ============================================================
// 🔥 NUOVA ROTTA: GET /api/iscrizioni/tesserato/:idTesserato
// Recupera tutte le iscrizioni di un tesserato
// ============================================================
router.get('/tesserato/:idTesserato', authenticate, requireRole(['admin', 'settore_tecnico', 'presidente', 'tesserato']), async (req, res) => {
    try {
        const { idTesserato } = req.params;

        console.log(`🔵 GET /iscrizioni/tesserato/${idTesserato}`);

        // 🔐 Controllo proprietario per tesserati (presidente e admin/settore_tecnico passano)
        const { data: manutentore } = await supabaseAdmin
            .from('manutentori')
            .select('ruolo')
            .eq('user_id', req.userId)
            .maybeSingle();

        if (!manutentore) {
            // È un tesserato → verifica che stia vedendo le proprie iscrizioni
            const { data: tesserato } = await supabaseAdmin
                .from('tesserati')
                .select('id')
                .eq('user_id', req.userId)
                .maybeSingle();

            if (!tesserato || tesserato.id !== parseInt(idTesserato)) {
                return res.status(403).json({ error: 'Non autorizzato' });
            }
        }

        const { data, error } = await supabaseAdmin
            .from('iscrizioni_gare')
            .select('id_gara, stato, giorno_iscrizione, id_tesserato')
            .eq('id_tesserato', idTesserato)
            .order('data_iscrizione', { ascending: false });  // ✅ MODIFICA QUI

        if (error) {
            console.error('❌ Errore getIscrizioniByTesserato:', error);
            return res.status(500).json({ error: error.message });
        }

        console.log(`✅ Trovate ${data?.length || 0} iscrizioni`);
        res.json(data);
    } catch (error) {
        console.error('❌ Errore GET /iscrizioni/tesserato/:idTesserato:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// POST /api/iscrizioni/:id/giorno - Aggiorna il giorno scelto
// ============================================================
router.post('/:id/giorno', authenticate, requireRole(['tesserato']), async (req, res) => {
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