import express from 'express';
import { 
  scanQR,
  getProdotti,
  verificaLotto,
  registraIntervento,
  getStorico
} from '../controllers/interventoController.js';
import { authenticate } from '../middleware/auth.js';
import { requireOTP } from '../middleware/otp.js';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import multer from 'multer';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ============================================
// ROTTE PUBBLICHE
// ============================================
router.get('/asd/:qrCode', scanQR);

// ============================================
// ROTTE PROTETTE
// ============================================
router.get('/prodotti', getProdotti);
router.post('/verifica-lotto', authenticate, verificaLotto);
router.post('/interventi', authenticate, requireOTP, registraIntervento);
router.get('/storico/:asdId', authenticate, getStorico);

// ============================================
// ULTIMI INTERVENTI PER LA DASHBOARD
// ============================================

router.get('/interventi/ultimi', authenticate, async (req, res) => {
  try {
    console.log('🔵 GET /interventi/ultimi - Inizio');
    const limit = req.query.limit || 10;
    const { data, error } = await supabaseAdmin
      .from('interventi')
      .select(`
        id,
        tipo_intervento,
        data_intervento,
        biliardi (
          nome_tavolo,
          asd_centri (nome)
        )
      `)
      .order('data_intervento', { ascending: false })
      .limit(limit);

    if (error) {
      console.log('❌ Errore Supabase:', error);
      throw error;
    }
    
    const formatted = data.map(i => ({
      ...i,
      biliardo_nome: i.biliardi?.nome_tavolo,
      asd_nome: i.biliardi?.asd_centri?.nome
    }));
    console.log('✅ Ultimi interventi:', formatted.length);
    res.json(formatted);
  } catch (error) {
    console.log('❌ Errore generale:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// LISTA INTERVENTI CON FILTRI
// ============================================

router.get('/interventi', authenticate, async (req, res) => {
  try {
    console.log('🔵 GET /interventi - Inizio');
    const { asdId } = req.query;
    
    // Costruisci la query base
    let query = supabaseAdmin
      .from('interventi')
      .select(`
        *,
        manutentori!interventi_id_manutentore_fkey (
          nome,
          cognome
        ),
        biliardi!interventi_id_biliardo_fkey (
          nome_tavolo,
          asd_centri!biliardi_id_asd_fkey (
            nome
          )
        )
      `);
    
    // Se asdId è fornito e non è 'tutte', filtra per ASD
    if (asdId && asdId !== 'tutte') {
      console.log(`🔵 Filtro per ASD ID: ${asdId}`);
      // Filtra gli interventi basati sull'ASD attraverso la relazione biliardi
      query = query.eq('biliardi.asd_centri.id', parseInt(asdId));
    }
    
    const { data, error } = await query.order('data_intervento', { ascending: false });

    if (error) {
      console.log('❌ Errore Supabase:', error);
      throw error;
    }

    const formatted = data.map(i => ({
      ...i,
      manutentore_nome: i.manutentori ? `${i.manutentori.nome} ${i.manutentori.cognome}` : 'N/A',
      biliardo_nome: i.biliardi?.nome_tavolo || 'N/A',
      asd_nome: i.biliardi?.asd_centri?.nome || 'N/A'
    }));

    console.log('✅ Interventi trovati:', formatted.length);
    res.json(formatted);
  } catch (error) {
    console.log('❌ Errore generale:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// DETTAGLIO INTERVENTO
// ============================================

router.get('/interventi/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔵 GET /interventi/${id} - Inizio`);
    
    const { data, error } = await supabaseAdmin
      .from('interventi')
      .select(`
        *,
        manutentori!interventi_id_manutentore_fkey (
          nome,
          cognome,
          email
        ),
        biliardi!interventi_id_biliardo_fkey (
          nome_tavolo,
          asd_centri!biliardi_id_asd_fkey (
            nome
          )
        ),
        prodotti_omologati!interventi_id_prodotto_usato_fkey (
          marca,
          modello
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.log('❌ Errore Supabase:', error);
      throw error;
    }

    const formatted = {
      ...data,
      manutentore_nome: data.manutentori ? `${data.manutentori.nome} ${data.manutentori.cognome}` : 'N/A',
      biliardo_nome: data.biliardi?.nome_tavolo || 'N/A',
      asd_nome: data.biliardi?.asd_centri?.nome || 'N/A',
      prodotto_marca: data.prodotti_omologati?.marca || 'N/A',
      prodotto_modello: data.prodotti_omologati?.modello || 'N/A'
    };

    console.log('✅ Dettaglio intervento trovato');
    res.json(formatted);
  } catch (error) {
    console.log('❌ Errore generale:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// VALIDA INTERVENTO
// ============================================

router.put('/interventi/:id/valida', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔵 PUT /interventi/${id}/valida - Inizio`);
    
    const { data, error } = await supabase
      .from('interventi')
      .update({ stato: 'validato' })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.log('❌ Errore Supabase:', error);
      throw error;
    }
    console.log('✅ Intervento validato');
    res.json(data);
  } catch (error) {
    console.log('❌ Errore generale:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// LISTA ASD PER FILTRI (SOLO ADMIN)
// ============================================

router.get('/asd', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    console.log('🔵 GET /asd - Inizio');
    const { data, error } = await supabase  // ← CAMBIA: supabase (non supabaseAdmin)
      .from('asd_centri')
      .select('id, nome')
      .eq('attivo', true)
      .order('nome', { ascending: true });

    if (error) {
      console.log('❌ Errore Supabase:', error);
      throw error;
    }
    console.log('✅ ASD trovate:', data.length);
    res.json(data);
  } catch (error) {
    console.log('❌ Errore generale:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// BILIARDI PER ASD
// ============================================

router.get('/biliardi', async (req, res) => {
  try {
    const { asdId } = req.query;
    
    if (!asdId) {
      return res.status(400).json({ error: 'asdId richiesto' });
    }

    
    const { data, error } = await supabaseAdmin 
      .from('biliardi')
      .select('*')
      .eq('id_asd', parseInt(asdId))
      .eq('attivo', true);

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// UPLOAD FOTO
// ============================================

router.post('/upload-foto', authenticate, upload.single('foto'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'Nessun file caricato' });
    }

    const fileName = `${Date.now()}_${file.originalname}`;
    const filePath = `interventi/${req.userId}/${fileName}`;

    const { error } = await supabaseAdmin.storage
      .from('foto-interventi')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
      });

    if (error) throw error;

    const { data: publicUrl } = supabaseAdmin.storage
      .from('foto-interventi')
      .getPublicUrl(filePath);

    res.json({ url: publicUrl.publicUrl });
  } catch (error) {
    console.log('❌ Errore upload:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;