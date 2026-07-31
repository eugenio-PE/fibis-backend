import express from 'express';
import { generaControlli, aggiornaEsito, importaManutentori } from '../controllers/controlliController.js';
import { scanQR } from '../controllers/interventoController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// ============================================
// ROTTE PER MANUTENTORI (CRUD)
// ============================================

// GET: Lista tutti i manutentori
router.get('/admin/manutentori', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .select('*')
      .order('cognome', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Crea un nuovo manutentore
router.post('/admin/manutentori', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { nome, cognome, email, telefono, azienda, data_scadenza_albo, ruolo, asd_id } = req.body;

    const { data: authData, error: authError } = await supabaseAdmin.auth.signUp({
      email,
      password: 'PasswordTemporanea123!',
    });

    if (authError) throw authError;

    const insertData = {
      user_id: authData.user.id,
      nome,
      cognome,
      email,
      telefono: telefono || '',
      azienda: azienda || '',
      data_scadenza_albo,
      ruolo: ruolo || 'manutentore',
      is_active: true,
    };

    if (ruolo === 'presidente' && asd_id) {
      insertData.asd_id = asd_id;
    }

    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('❌ Errore creazione manutentore:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT: Aggiorna un manutentore
router.put('/admin/manutentori/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, cognome, email, telefono, azienda, data_scadenza_albo, ruolo, is_active, asd_id } = req.body;

    const updateData = {
      nome,
      cognome,
      email,
      telefono,
      azienda,
      data_scadenza_albo,
      ruolo,
      is_active,
    };

    if (ruolo === 'presidente') {
      updateData.asd_id = asd_id || null;
    } else {
      updateData.asd_id = null;
    }

    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Errore aggiornamento manutentore:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Elimina un manutentore
router.delete('/admin/manutentori/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    const { data: manutentore, error: findError } = await supabaseAdmin
      .from('manutentori')
      .select('user_id')
      .eq('id', id)
      .single();

    if (findError) throw findError;

    const { error: deleteError } = await supabaseAdmin
      .from('manutentori')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    if (manutentore.user_id) {
      await supabaseAdmin.auth.admin.deleteUser(manutentore.user_id);
    }

    res.json({ message: 'Manutentore eliminato con successo' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROTTE PER PRODOTTI (CRUD)
// ============================================

// GET: Lista tutti i prodotti
router.get('/admin/prodotti', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('prodotti_omologati')
      .select('*')
      .order('marca', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Crea un nuovo prodotto
router.post('/admin/prodotti', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id_produttore, categoria, marca, modello, codice_omologazione } = req.body;

    const { data, error } = await supabaseAdmin
      .from('prodotti_omologati')
      .insert({
        id_produttore,
        categoria,
        marca,
        modello,
        codice_omologazione,
        attivo: true,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT: Aggiorna un prodotto
router.put('/admin/prodotti/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { id_produttore, categoria, marca, modello, codice_omologazione, attivo } = req.body;

    const { data, error } = await supabaseAdmin
      .from('prodotti_omologati')
      .update({
        id_produttore,
        categoria,
        marca,
        modello,
        codice_omologazione,
        attivo,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Elimina un prodotto
router.delete('/admin/prodotti/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('prodotti_omologati')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'Prodotto eliminato con successo' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROTTE PER DIRETTORI DI GARA (CRUD)
// ============================================

// GET: Lista tutti i direttori di gara
router.get('/admin/direttori', authenticate, requireRole(['admin', 'settore_tecnico']), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .select('*')
      .eq('ruolo', 'direttore')
      .order('cognome', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Crea un nuovo direttore di gara
router.post('/admin/direttori', authenticate, requireRole(['admin', 'settore_tecnico']), async (req, res) => {
  try {
    const { nome, cognome, email, telefono, data_scadenza_albo } = req.body;

    const { data: authData, error: authError } = await supabaseAdmin.auth.signUp({
      email,
      password: 'PasswordTemporanea123!',
    });

    if (authError) throw authError;

    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .insert({
        user_id: authData.user.id,
        nome,
        cognome,
        email,
        telefono: telefono || '',
        ruolo: 'direttore',
        is_active: true,
        data_scadenza_albo: data_scadenza_albo || '2099-12-31',
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT: Aggiorna un direttore di gara
router.put('/admin/direttori/:id', authenticate, requireRole(['admin', 'settore_tecnico']), async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, cognome, email, telefono, is_active } = req.body;

    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .update({
        nome,
        cognome,
        email,
        telefono,
        is_active,
      })
      .eq('id', id)
      .eq('ruolo', 'direttore')
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Elimina un direttore di gara
router.delete('/admin/direttori/:id', authenticate, requireRole(['admin', 'settore_tecnico']), async (req, res) => {
  try {
    const { id } = req.params;

    const { data: direttore, error: findError } = await supabaseAdmin
      .from('manutentori')
      .select('user_id')
      .eq('id', id)
      .eq('ruolo', 'direttore')
      .single();

    if (findError) throw findError;

    const { error: deleteError } = await supabaseAdmin
      .from('manutentori')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    if (direttore.user_id) {
      await supabaseAdmin.auth.admin.deleteUser(direttore.user_id);
    }

    res.json({ message: 'Direttore di gara eliminato con successo' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: Lista direttori disponibili (per Presidenti ASD)
router.get('/direttori/disponibili', authenticate, async (req, res) => {
  try {
    const { data: manutentore } = await supabaseAdmin
      .from('manutentori')
      .select('ruolo')
      .eq('user_id', req.userId)
      .maybeSingle();

    if (!manutentore || manutentore.ruolo !== 'presidente') {
      return res.status(403).json({ error: 'Accesso riservato ai presidenti ASD' });
    }

    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .select('id, nome, cognome, email')
      .eq('ruolo', 'direttore')
      .eq('is_active', true)
      .order('cognome', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Errore GET /direttori/disponibili:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROTTE PER CONTROLLI A SORPRESA
// ============================================

router.post('/controlli/genera', authenticate, requireRole(['admin']), generaControlli);
router.put('/controlli/:id', authenticate, requireRole(['admin', 'ispettore']), aggiornaEsito);

// ============================================
// ROTTA PER IMPORTAZIONE CSV
// ============================================

router.post('/admin/manutentori/import', authenticate, requireRole(['admin']), importaManutentori);

// ============================================
// ROTTE PER ASD
// ============================================

// GET: Lista tutte le ASD
router.get('/admin/asd', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('asd_centri')
      .select(`
        *,
        biliardi (*)
      `)
      .order('nome', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Crea una nuova ASD (AGGIORNATO con nuovi campi)
router.post('/admin/asd', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { 
      nome, indirizzo, 
      responsabile_nome, responsabile_email, responsabile_telefono,
      codice, stagione, cap, comune, provincia, regione, 
      email_contatto, telefono_contatto, pec,
      responsabile_cognome, cf_responsabile, cf_asd
    } = req.body;

    const { data, error } = await supabaseAdmin
      .from('asd_centri')
      .insert({
        nome,
        indirizzo,
        responsabile_nome,
        responsabile_email,
        responsabile_telefono,
        codice,
        stagione,
        cap,
        comune,
        provincia,
        regione,
        email_contatto,
        telefono_contatto,
        pec,
        responsabile_cognome,
        cf_responsabile,
        cf_asd,
        attivo: true,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('❌ Errore creazione ASD:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT: Aggiorna una ASD (AGGIORNATO con nuovi campi)
router.put('/admin/asd/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      nome, indirizzo, 
      responsabile_nome, responsabile_email, responsabile_telefono,
      codice, stagione, cap, comune, provincia, regione, 
      email_contatto, telefono_contatto, pec,
      responsabile_cognome, cf_responsabile, cf_asd
    } = req.body;

    const { data, error } = await supabaseAdmin
      .from('asd_centri')
      .update({
        nome,
        indirizzo,
        responsabile_nome,
        responsabile_email,
        responsabile_telefono,
        codice,
        stagione,
        cap,
        comune,
        provincia,
        regione,
        email_contatto,
        telefono_contatto,
        pec,
        responsabile_cognome,
        cf_responsabile,
        cf_asd,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Errore aggiornamento ASD:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Elimina una ASD
router.delete('/admin/asd/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    await supabaseAdmin
      .from('biliardi')
      .delete()
      .eq('id_asd', id);

    const { error } = await supabaseAdmin
      .from('asd_centri')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'ASD eliminata con successo' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: Genera QR per ASD
router.get('/asd/:id/qr', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('asd_centri')
      .select('qr_code, nome')
      .eq('id', id)
      .single();

    if (error) throw error;

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const qrUrl = `${baseUrl}/asd/${data.qr_code}`;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}`;

    res.json({
      qr_url: qrImageUrl,
      qr_code: data.qr_code,
      asd_nome: data.nome,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROTTA PUBBLICA PER QR
// ============================================

router.get('/asd/:qrCode', scanQR);

// ============================================
// ROTTE PER BILIARDI
// ============================================

// POST: Aggiungi biliardo
router.post('/admin/biliardi', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id_asd, nome_tavolo, tipo, dimensioni } = req.body;
    
    const { data, error } = await supabaseAdmin
      .from('biliardi')
      .insert({
        id_asd,
        nome_tavolo,
        tipo: tipo || 'pool',
        dimensioni: dimensioni || '9ft',
        attivo: true
      })
      .select()
      .single();
      
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Elimina biliardo
router.delete('/admin/biliardi/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabaseAdmin
      .from('biliardi')
      .delete()
      .eq('id', id);
      
    if (error) throw error;
    res.json({ message: 'Biliardo eliminato con successo' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// STATISTICHE PER LA DASHBOARD
// ============================================

router.get('/stats/asd', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('asd_centri')
      .select('*', { count: 'exact', head: true });
    
    if (error) throw error;
    res.json(count || 0);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats/biliardi', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('biliardi')
      .select('*', { count: 'exact', head: true });
    
    if (error) throw error;
    res.json(count || 0);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats/interventi', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('interventi')
      .select('*', { count: 'exact', head: true });
    
    if (error) throw error;
    res.json(count || 0);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats/manutentori', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('manutentori')
      .select('*', { count: 'exact', head: true });
    
    if (error) throw error;
    res.json(count || 0);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROTTA PER IMPORTAZIONE CSV ASD
// ============================================

router.post('/admin/asd/import', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { asd } = req.body;

    if (!asd || asd.length === 0) {
      return res.status(400).json({ error: 'Nessun dato da importare' });
    }

    let importati = 0;
    let aggiornati = 0;
    let errori = 0;

    for (const record of asd) {
      try {
        // Mappatura campi CSV -> DB
        const data = {
          codice: record['Codice']?.trim() || null,
          stagione: record['Stagione']?.trim() || null,
          nome: record['Denominazione']?.trim() || null,
          indirizzo: record['Indirizzo sede legale']?.trim() || null,
          cap: record['CAP']?.toString() || null,
          comune: record['Comune sede legale']?.trim() || null,
          provincia: record['Prov.']?.trim() || null,
          regione: record['Regione']?.trim() || null,
          email_contatto: record['e-mail']?.trim() || null,
          telefono_contatto: record['telefono']?.toString() || null,
          pec: record['PEC']?.trim() || null,
          responsabile_cognome: record['Cognome Resp.Legale']?.trim() || null,
          responsabile_nome: record['Nome Resp.Legale']?.trim() || null,
          cf_responsabile: record['Codice Fiscale']?.trim() || null,
          cf_asd: record['Codice fiscale']?.trim() || null,
          attivo: true
        };

        // Verifica se esiste già una ASD con questo codice
        if (data.codice) {
          const { data: existing, error: findError } = await supabaseAdmin
            .from('asd_centri')
            .select('id')
            .eq('codice', data.codice)
            .maybeSingle();

          if (findError) throw findError;

          if (existing) {
            // UPSERT: aggiorna record esistente
            const { error: updateError } = await supabaseAdmin
              .from('asd_centri')
              .update(data)
              .eq('id', existing.id);

            if (updateError) throw updateError;
            aggiornati++;
          } else {
            // INSERT: nuovo record
            const { error: insertError } = await supabaseAdmin
              .from('asd_centri')
              .insert(data);

            if (insertError) throw insertError;
            importati++;
          }
        } else {
          // Se non c'è codice, inserisce come nuovo
          const { error: insertError } = await supabaseAdmin
            .from('asd_centri')
            .insert(data);

          if (insertError) throw insertError;
          importati++;
        }
      } catch (recordError) {
        console.error('❌ Errore su record:', recordError);
        errori++;
      }
    }

    res.json({
      importati,
      aggiornati,
      errori,
      totale: asd.length
    });

  } catch (error) {
    console.error('❌ Errore importazione ASD:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;