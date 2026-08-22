import { supabaseAdmin } from '../config/supabase.js';

// ============================================================
// GET /api/gare
// Lista tutte le gare (con filtri opzionali)
// ============================================================
export const getGare = async (req, res) => {
    try {
        const { disciplina, tipologia, regione, categoria, aperte } = req.query;
        
        let query = supabaseAdmin
            .from('gare')
            .select('*');

        // Filtra per disciplina (se fornita)
        if (disciplina) {
            query = query.eq('tipo', disciplina);
        }

        // Filtra per tipologia (se fornita)
        if (tipologia) {
            query = query.eq('tipologia', tipologia);
        }

        // Filtra per regione (se fornita)
        if (regione) {
            query = query.eq('regione', regione);
        }

        // Filtra per categoria (se fornita)
        if (categoria) {
            query = query.eq('categoria', categoria);
        }

        // Filtra solo gare con iscrizioni aperte
        if (aperte === 'true') {
            const oggi = new Date().toISOString().split('T')[0];
            query = query
                .gte('data_fine_iscrizioni', oggi)
                .lte('data_inizio_iscrizioni', oggi);
        }

        // Ordina per data
        const { data, error } = await query
            .order('data_gara', { ascending: true });

        if (error) throw error;

        res.json(data);
    } catch (error) {
        console.error('❌ Errore getGare:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// GET /api/gare/:id
// Dettaglio di una singola gara
// ============================================================
export const getGaraById = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('gare')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        if (!data) {
            return res.status(404).json({ error: 'Gara non trovata' });
        }

        res.json(data);
    } catch (error) {
        console.error('❌ Errore getGaraById:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// POST /api/gare
// Crea una nuova gara (solo admin)
// ============================================================
export const createGara = async (req, res) => {
    try {
        const {
            nome,
            data_gara,
            tipologia,
            categoria,
            regione,
            luogo,
            data_inizio_iscrizioni,
            data_fine_iscrizioni,
            note,
        } = req.body;

        // Validazione base
        if (!nome || !data_gara) {
            return res.status(400).json({ error: 'Nome e data sono obbligatori' });
        }

        const { data, error } = await supabaseAdmin
            .from('gare')
            .insert({
                nome,
                data_gara,
                tipologia,
                categoria,
                regione,
                note: luogo ? `Luogo: ${luogo}` : note,
                data_inizio_iscrizioni,
                data_fine_iscrizioni,
                stato: 'programmata',
                inserito_il: new Date().toISOString(),
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            success: true,
            message: 'Gara creata con successo',
            data
        });
    } catch (error) {
        console.error('❌ Errore createGara:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// PUT /api/gare/:id
// Aggiorna una gara esistente (solo admin)
// ============================================================
export const updateGara = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nome,
            data_gara,
            tipologia,
            categoria,
            regione,
            luogo,
            data_inizio_iscrizioni,
            data_fine_iscrizioni,
            note,
            stato,
        } = req.body;

        // Verifica che la gara esista
        const { data: existing, error: checkError } = await supabaseAdmin
            .from('gare')
            .select('id')
            .eq('id', id)
            .single();

        if (checkError || !existing) {
            return res.status(404).json({ error: 'Gara non trovata' });
        }

        const { data, error } = await supabaseAdmin
            .from('gare')
            .update({
                nome,
                data_gara,
                tipologia,
                categoria,
                regione,
                note: luogo ? `Luogo: ${luogo}` : note,
                data_inizio_iscrizioni,
                data_fine_iscrizioni,
                stato,
                updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            message: 'Gara aggiornata con successo',
            data
        });
    } catch (error) {
        console.error('❌ Errore updateGara:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// DELETE /api/gare/:id
// Elimina una gara (solo admin)
// ============================================================
export const deleteGara = async (req, res) => {
    try {
        const { id } = req.params;

        // Verifica che la gara esista
        const { data: existing, error: checkError } = await supabaseAdmin
            .from('gare')
            .select('id')
            .eq('id', id)
            .single();

        if (checkError || !existing) {
            return res.status(404).json({ error: 'Gara non trovata' });
        }

        const { error } = await supabaseAdmin
            .from('gare')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Gara eliminata con successo'
        });
    } catch (error) {
        console.error('❌ Errore deleteGara:', error);
        res.status(500).json({ error: error.message });
    }
};