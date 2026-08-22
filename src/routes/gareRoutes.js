import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// ============================================
// ROTTE PER GARE
// ============================================

// ============================================================
// GET /api/gare (PUBBLICA PER APP TESSERATI)
// Lista tutte le gare con filtri (disciplina, tipologia, regione, categoria, aperte)
// ============================================================
router.get('/gare', authenticate, async (req, res) => {
  try {
    const { disciplina, tipologia, regione, categoria, aperte } = req.query;

    console.log('🔵 GET /gare - req.userId:', req.userId);

    if (!req.userId) {
      console.error('❌ req.userId è undefined!');
      return res.status(401).json({ error: 'Utente non autenticato' });
    }

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

    // Filtra solo gare con iscrizioni aperte (dal giorno prima dell'apertura fino alla chiusura)
    if (aperte === 'true') {
      const oggi = new Date();
      const oggiStr = oggi.toISOString().split('T')[0];
      const ieriStr = new Date(oggi.setDate(oggi.getDate() - 1)).toISOString().split('T')[0];
      
      // Gare visibili se: data_inizio_iscrizioni <= oggi <= data_fine_iscrizioni
      // Oppure se oggi è il giorno prima dell'apertura (data_inizio_iscrizioni = domani)
      query = query
        .or(`data_inizio_iscrizioni.lte.${oggiStr},data_inizio_iscrizioni.eq.${new Date(Date.now() + 86400000).toISOString().split('T')[0]}`)
        .gte('data_fine_iscrizioni', oggiStr);
    }

    // Ordina per data
    const { data, error } = await query
      .order('data_gara', { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('❌ Errore GET /gare:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ROTTE ESISTENTI
// ============================================================

// GET: Lista tutte le gare CON CONTEGGIO VERIFICHE (usata dalla Dashboard Admin)
router.get('/gare-admin', authenticate, async (req, res) => {
  try {
    console.log('🔵 GET /gare-admin - req.userId:', req.userId);

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

    // 1. Prima ottieni le gare
    let query = supabaseAdmin
      .from('gare')
      .select(`
        *,
        asd_centri (id, nome),
        manutentori!gare_id_direttore_fkey (id, nome, cognome, email)
      `);

    const { data: gareData, error: gareError } = await query.order('data_gara', { ascending: false });

    if (gareError) {
      console.error('❌ Errore query gare:', gareError);
      throw gareError;
    }

    // 2. Per ogni gara, conta le verifiche
    const gareConVerifiche = await Promise.all(
      (gareData || []).map(async (gara) => {
        const { count, error: countError } = await supabaseAdmin
          .from('verifiche')
          .select('*', { count: 'exact', head: true })
          .eq('id_gara', gara.id);

        if (countError) {
          console.error(`❌ Errore conteggio verifiche per gara ${gara.id}:`, countError);
          return { ...gara, verifiche_count: 0 };
        }

        return { ...gara, verifiche_count: count || 0 };
      })
    );

    console.log('✅ Gare trovate:', gareConVerifiche?.length || 0);
    res.json(gareConVerifiche);
  } catch (error) {
    console.error('❌ Errore GET /gare-admin:', error);
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

// GET: Lista verifiche per gara (usata dalle app Flutter)
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

// GET: Lista verifiche DETTAGLIO per gara (usata dalla Dashboard Admin per il modal)
router.get('/gare/:id/verifiche-dettaglio', authenticate, requireRole(['admin']), async (req, res) => {
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
    console.error('❌ Errore GET /gare/:id/verifiche-dettaglio:', error);
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
      .select('id, ruolo')
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
        stato: 'programmata',
        inserito_da: manutentore.id,
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
      .select('ruolo')
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