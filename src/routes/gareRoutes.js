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
      .select('ruolo')
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
    // Nota: il filtro per ASD è stato rimosso perché la colonna asd_id non esiste in manutentori
    // In futuro, se aggiungerai la colonna, potrai ripristinarlo

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

// GET: Lista gare per ASD (SPOSTATA SOPRA /gare/:id PER EVITARE CONFLITTI DI ROUTING)
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

// GET: Lista gare per Direttore (SPOSTATA SOPRA /gare/:id)
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
      .maybeSingle();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Errore GET /gare/:id:', error);
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
// GET: Lista verifiche per ASD (usata dal Presidente)
router.get('/asd/:id/verifiche', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 1. Prima ottieni i biliardi dell'ASD
    const { data: biliardi, error: biliardiError } = await supabaseAdmin
      .from('biliardi')
      .select('id')
      .eq('id_asd', id);

    if (biliardiError) throw biliardiError;

    const biliardiIds = biliardi.map(b => b.id);

    if (biliardiIds.length === 0) {
      return res.json([]);
    }

    // 2. Poi ottieni le verifiche per quei biliardi
    const { data, error } = await supabaseAdmin
      .from('verifiche')
      .select(`
        *,
        biliardi (id, nome_tavolo),
        manutentori!verifiche_id_direttore_fkey (id, nome, cognome, email),
        gare (id, nulla_osta, data_gara)
      `)
      .in('id_biliardo', biliardiIds)
      .order('data_verifica', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Errore GET /asd/:id/verifiche:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Crea una nuova gara
router.post('/gare', authenticate, async (req, res) => {
  try {
    const { id_asd, id_direttore, nulla_osta, tipologia, data_gara, note } = req.body;

    console.log('🔵 [POST /gare] - Inizio creazione gara per user_id:', req.userId);
    console.log('📥 [POST /gare] - Payload ricevuto:', { id_asd, id_direttore, tipologia, data_gara });

    // 1. Recupera il manutentore associato all'utente autenticato
    const { data: manutentore, error: manutentoreError } = await supabaseAdmin
      .from('manutentori')
      .select('id, ruolo')  // ← RIMOSSO asd_id
      .eq('user_id', req.userId)
      .maybeSingle();

    if (manutentoreError) {
      console.error('❌ [POST /gare] - Errore query manutentori:', manutentoreError.message);
      return res.status(500).json({ error: 'Errore durante la verifica dei permessi' });
    }

    if (!manutentore) {
      console.warn('⚠️ [POST /gare] - Nessun manutentore trovato per user_id:', req.userId);
      return res.status(403).json({ error: 'Utente non registrato come manutentore' });
    }

    console.log('👤 [POST /gare] - Manutentore trovato:', manutentore);

    // 2. Controlli di Ruolo
    const isAdmin = manutentore.ruolo === 'admin';
    const isSettoreTecnico = manutentore.ruolo === 'settore_tecnico';
    const isPresidente = manutentore.ruolo === 'presidente';

    // 3. Verifica dell'autorizzazione
    // Il presidente può creare solo gare di tipologia 'libera'
    const canInsert = isAdmin || isSettoreTecnico || (isPresidente && tipologia === 'libera');

    console.log('🔍 [POST /gare] - Esito controlli autorizzazione:', {
      isAdmin,
      isSettoreTecnico,
      isPresidente,
      tipologia,
      canInsert
    });

    if (!canInsert) {
      console.warn('❌ [POST /gare] - Autorizzazione negata (403)');
      return res.status(403).json({ 
        error: 'Accesso non autorizzato per la creazione di questa gara' 
      });
    }

    // Sanificazione dati di input
    const parsedDirettoreId = id_direttore ? Number(id_direttore) : null;

// 4. Inserimento della gara su Supabase
const { data: nuovaGara, error: insertError } = await supabaseAdmin
  .from('gare')
  .insert({
    id_asd,
    id_direttore: parsedDirettoreId,
    nulla_osta,
    tipologia,
    data_gara,
    stato: 'inserita',
    inserito_da: manutentore.id,  // ← MODIFICA QUI (era req.userId)
    note,
  })
  .select()
  .single();

    if (insertError) {
      console.error('❌ [POST /gare] - Errore durante l\'inserimento su DB:', insertError);
      return res.status(500).json({ error: insertError.message });
    }

    console.log('✅ [POST /gare] - Gara creata con successo. ID:', nuovaGara.id);
    return res.status(201).json(nuovaGara);

  } catch (error) {
    console.error('❌ [POST /gare] - Eccezione server:', error);
    return res.status(500).json({ error: error.message });
  }
});

// PUT: Aggiorna una gara
router.put('/gare/:id', authenticate, requireRole(['admin', 'settore_tecnico', 'presidente']), async (req, res) => {
  try {
    const { id } = req.params;
    const { id_direttore, nulla_osta, data_gara, stato, note } = req.body;

    const { data: manutentore } = await supabaseAdmin
      .from('manutentori')
      .select('ruolo')  // ← RIMOSSO asd_id
      .eq('user_id', req.userId)
      .maybeSingle();

    let query = supabaseAdmin
      .from('gare')
      .update({
        id_direttore: id_direttore ? Number(id_direttore) : null,
        nulla_osta,
        data_gara,
        stato,
        note,
        updated_at: new Date()
      })
      .eq('id', id);

    // Il filtro per presidente è stato rimosso perché asd_id non esiste
    // In futuro, se aggiungerai la colonna, potrai ripristinarlo

    const { data, error } = await query.select().single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Errore PUT /gare/:id:', error);
    res.status(500).json({ error: error.message });
  }
});
// PUT: Assegna un direttore a una gara (per Presidenti ASD)
router.put('/gare/:id/direttore', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { id_direttore } = req.body;

    if (!id_direttore) {
      return res.status(400).json({ error: 'id_direttore è obbligatorio' });
    }

    // Verifica il ruolo e l'ASD del presidente
    const { data: manutentore } = await supabaseAdmin
      .from('manutentori')
      .select('ruolo, asd_id')
      .eq('user_id', req.userId)
      .maybeSingle();

    if (!manutentore) {
      return res.status(403).json({ error: 'Utente non autorizzato' });
    }

    const isAdmin = manutentore.ruolo === 'admin';
    const isSettoreTecnico = manutentore.ruolo === 'settore_tecnico';
    const isPresidente = manutentore.ruolo === 'presidente';

    // Solo admin, settore tecnico o presidente possono assegnare
    if (!isAdmin && !isSettoreTecnico && !isPresidente) {
      return res.status(403).json({ error: 'Accesso non autorizzato' });
    }

    // Verifica che la gara esista e appartenga alla ASD del presidente
    const { data: gara, error: garaError } = await supabaseAdmin
      .from('gare')
      .select('id_asd')
      .eq('id', id)
      .maybeSingle();

    if (garaError || !gara) {
      return res.status(404).json({ error: 'Gara non trovata' });
    }

    // Se è presidente, verifica che la gara sia della sua ASD
    if (isPresidente && gara.id_asd !== manutentore.asd_id) {
      return res.status(403).json({ error: 'Non sei autorizzato per questa ASD' });
    }

    // Assegna il direttore alla gara
    const { data, error } = await supabaseAdmin
      .from('gare')
      .update({
        id_direttore,
        updated_at: new Date()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Errore PUT /gare/:id/direttore:', error);
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

export default router;