import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// ============================================
// ROTTE PER GARE
// ============================================
// GET: Lista tutte le gare
router.get('/gare', authenticate, async (req, res) => {
  try {
    console.log('🔵 GET /gare - req.userId:', req.userId);

    if (!req.userId) {
      console.error('❌ req.userId è undefined!');
      return res.status(401).json({ error: 'Utente non autenticato' });
    }

    // Verifica il ruolo dell'utente
    const { data: manutentore } = await supabaseAdmin
      .from('manutentori')
      .select('ruolo, asd_id')
      .eq('user_id', req.userId)
      .maybeSingle();

    console.log('🔵 manutentore trovato:', manutentore);

    // Costruisci la query base
    let query = supabaseAdmin
      .from('gare')
      .select(`
        *,
        asd_centri (id, nome),
        manutentori!gare_id_direttore_fkey (id, nome, cognome, email)
      `);

    // Se non è admin o settore tecnico, filtra per ASD
    if (!['admin', 'settore_tecnico'].includes(manutentore?.ruolo)) {
      query = query.eq('id_asd', manutentore?.asd_id);
    }

    const { data, error } = await query.order('data_gara', { ascending: false });

    if (error) {
      console.error('❌ Errore query gare:', error);
      throw error;
    }
    
    console.log('✅ Gare trovate:', data?.length || 0);
    res.json(data);
  } catch (error) {
    console.error('❌ Errore GET /gare:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET: Dettaglio di una gara
router.get('/gare/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('gare')
      .select(`
        *,
        asd_centri (id, nome),
        manutentori!gare_id_direttore_fkey (id, nome, cognome, email)
      `)
      .eq('id', id)
      .maybeSingle();  // ← MODIFICATO

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Errore GET /gare/:id:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Crea una nuova gara
router.post('/gare', authenticate, async (req, res) => {
  try {
    const { id_asd, id_direttore, nulla_osta, tipologia, data_gara, note } = req.body;

    // Verifica che l'utente sia autorizzato
    const { data: manutentore } = await supabaseAdmin
      .from('manutentori')
      .select('ruolo, asd_id')
      .eq('user_id', req.userId)
      .maybeSingle();  // ← MODIFICATO

    const isAdmin = manutentore?.ruolo === 'admin';
    const isSettoreTecnico = manutentore?.ruolo === 'settore_tecnico';
    const isPresidente = manutentore?.ruolo === 'presidente';
    const isSameAsd = manutentore?.asd_id === id_asd;

    // Autorizzazione
    const canInsert = isAdmin || isSettoreTecnico || (isPresidente && isSameAsd && tipologia === 'libera');

    if (!canInsert) {
      return res.status(403).json({ error: 'Accesso non autorizzato' });
    }

    const { data, error } = await supabaseAdmin
      .from('gare')
      .insert({
        id_asd,
        id_direttore,
        nulla_osta,
        tipologia,
        data_gara,
        stato: 'inserita',
        inserito_da: req.userId,
        note,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('❌ Errore POST /gare:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT: Aggiorna una gara
router.put('/gare/:id', authenticate, requireRole(['admin', 'settore_tecnico', 'presidente']), async (req, res) => {
  try {
    const { id } = req.params;
    const { id_direttore, nulla_osta, data_gara, stato, note } = req.body;

    // Verifica che il presidente possa modificare solo le sue ASD
    const { data: manutentore } = await supabaseAdmin
      .from('manutentori')
      .select('ruolo, asd_id')
      .eq('user_id', req.userId)
      .maybeSingle();  // ← MODIFICATO

    let query = supabaseAdmin
      .from('gare')
      .update({
        id_direttore,
        nulla_osta,
        data_gara,
        stato,
        note,
        updated_at: new Date()
      })
      .eq('id', id);

    // Se è presidente, filtra per ASD
    if (manutentore?.ruolo === 'presidente') {
      query = query.eq('id_asd', manutentore.asd_id);
    }

    const { data, error } = await query.select().single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Errore PUT /gare/:id:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Elimina una gara
router.delete('/gare/:id', authenticate, requireRole(['admin', 'settore_tecnico']), async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('gare')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'Gara eliminata con successo' });
  } catch (error) {
    console.error('❌ Errore DELETE /gare/:id:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET: Lista gare per ASD
router.get('/gare/asd/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('gare')
      .select(`
        *,
        manutentori!gare_id_direttore_fkey (id, nome, cognome, email)
      `)
      .eq('id_asd', id)
      .order('data_gara', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Errore GET /gare/asd/:id:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET: Lista gare per Direttore
router.get('/gare/direttore/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('gare')
      .select(`
        *,
        asd_centri (id, nome)
      `)
      .eq('id_direttore', id)
      .order('data_gara', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Errore GET /gare/direttore/:id:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET: Lista verifiche per gara
router.get('/gare/:id/verifiche', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('verifiche')
      .select(`
        *,
        biliardi (id, nome_tavolo),
        manutentori!verifiche_id_direttore_fkey (id, nome, cognome, email)
      `)
      .eq('id_gara', id)
      .order('data_verifica', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Errore GET /gare/:id/verifiche:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;