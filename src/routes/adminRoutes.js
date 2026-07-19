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
    const { nome, cognome, email, telefono, azienda, data_scadenza_albo, ruolo } = req.body;

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
        azienda: azienda || '',
        data_scadenza_albo,
        ruolo: ruolo || 'manutentore',
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT: Aggiorna un manutentore
router.put('/admin/manutentori/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, cognome, email, telefono, azienda, data_scadenza_albo, ruolo, is_active } = req.body;

    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .update({
        nome,
        cognome,
        email,
        telefono,
        azienda,
        data_scadenza_albo,
        ruolo,
        is_active,
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

// POST: Crea una nuova ASD
router.post('/admin/asd', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { nome, indirizzo, referente_nome, referente_email, referente_telefono } = req.body;

    const { data, error } = await supabaseAdmin
      .from('asd_centri')
      .insert({
        nome,
        indirizzo,
        referente_nome,
        referente_email,
        referente_telefono,
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

// PUT: Aggiorna una ASD
router.put('/admin/asd/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, indirizzo, referente_nome, referente_email, referente_telefono } = req.body;

    const { data, error } = await supabaseAdmin
      .from('asd_centri')
      .update({
        nome,
        indirizzo,
        referente_nome,
        referente_email,
        referente_telefono,
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
export default router;