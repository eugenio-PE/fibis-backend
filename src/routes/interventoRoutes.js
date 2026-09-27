import express from 'express';
import { 
  scanQR,
  getProdotti,
  verificaLotto,
  registraIntervento,
  getStorico
} from '../controllers/interventoController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
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
    
    if (asdId && asdId !== 'tutte') {
      console.log(`🔵 Filtro per ASD ID: ${asdId}`);
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
// LISTA ASD CON RIEPILOGO INTERVENTI (Livello 1)
// ============================================
router.get('/interventi/raggruppati-asd', authenticate, async (req, res) => {
  try {
    console.log('🔵 GET /interventi/raggruppati-asd');

    const { data: interventi, error } = await supabaseAdmin
      .from('interventi')
      .select(`
        id,
        stato,
        biliardi!interventi_id_biliardo_fkey (
          id,
          id_asd,
          asd_centri!biliardi_id_asd_fkey (
            id,
            nome
          )
        )
      `);

    if (error) throw error;

    const asdMap = {};

    (interventi || []).forEach(i => {
      const asd = i.biliardi?.asd_centri;
      const idAsd = asd?.id;
      if (!idAsd) return;

      if (!asdMap[idAsd]) {
        asdMap[idAsd] = {
          id_asd: idAsd,
          nome: asd.nome,
          biliardi_ids: new Set(),
          n_interventi: 0,
          n_da_validare: 0,
          n_validati: 0,
          n_contestati: 0
        };
      }

      const a = asdMap[idAsd];
      if (i.biliardi?.id) a.biliardi_ids.add(i.biliardi.id);
      a.n_interventi++;
      if (i.stato === 'registrato') a.n_da_validare++;
      else if (i.stato === 'validato') a.n_validati++;
      else if (i.stato === 'contestato') a.n_contestati++;
    });

    const asdArray = Object.values(asdMap).map(a => ({
      id_asd: a.id_asd,
      nome: a.nome,
      n_biliardi: a.biliardi_ids.size,
      n_interventi: a.n_interventi,
      n_da_validare: a.n_da_validare,
      n_validati: a.n_validati,
      n_contestati: a.n_contestati
    })).sort((a, b) => a.nome.localeCompare(b.nome));

    res.json({
      success: true,
      totale: asdArray.length,
      asd: asdArray
    });

  } catch (error) {
    console.error('❌ Errore raggruppati-asd:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// BILIARDI + GRUPPI INTERVENTI DI UN'ASD (Livello 2)
// ============================================
router.get('/interventi/asd/:idAsd/raggruppati', authenticate, async (req, res) => {
  try {
    const { idAsd } = req.params;
    console.log(`🔵 GET /interventi/asd/${idAsd}/raggruppati`);

    // 1. Recupera biliardi dell'ASD (con omologato + esente)
    const { data: biliardi, error: bError } = await supabaseAdmin
      .from('biliardi')
      .select('id, nome_tavolo, tipo, dimensioni, omologato, esente')
      .eq('id_asd', idAsd)
      .eq('attivo', true)
      .order('id', { ascending: true });

    if (bError) throw bError;

    if (!biliardi || biliardi.length === 0) {
      return res.json({ 
        success: true, 
        id_asd: parseInt(idAsd), 
        biliardi: [],
        esenzione: {
          num_tesserati: 0,
          max_esenti: 0,
          biliardi_esenti: 0,
          biliardi_totali: 0,
          biliardi_omologati: 0
        }
      });
    }

    const idsBiliardi = biliardi.map(b => b.id);

    // 2. Recupera interventi di quei biliardi
    const { data: interventi, error: iError } = await supabaseAdmin
      .from('interventi')
      .select(`
        id,
        id_biliardo,
        tipo_intervento,
        stato,
        data_intervento,
        id_manutentore,
        numero_lotto_dichiarato,
        note,
        data_validazione,
        validato_da,
        foto_confezione,
        foto_marchio,
        foto_biliardo,
        manutentori!interventi_id_manutentore_fkey (id, nome, cognome),
        prodotti_omologati!interventi_id_prodotto_usato_fkey (marca, modello)
      `)
      .in('id_biliardo', idsBiliardi)
      .order('data_intervento', { ascending: false });

    if (iError) throw iError;

    // 3. Raggruppa per biliardo + data + manutentore
    const biliardiConGruppi = biliardi.map(b => {
      const intBiliardo = (interventi || []).filter(i => i.id_biliardo === b.id);

      const gruppiMap = {};
      intBiliardo.forEach(i => {
        const chiave = `${b.id}_${i.data_intervento}_${i.id_manutentore}`;
        if (!gruppiMap[chiave]) {
          gruppiMap[chiave] = {
            chiave,
            data_intervento: i.data_intervento,
            id_manutentore: i.id_manutentore,
            manutentore_nome: i.manutentori ? `${i.manutentori.nome} ${i.manutentori.cognome}` : 'N/A',
            tipi: [],
            stato: null,
            id_interventi: [],
            interventi: []
          };
        }
        const g = gruppiMap[chiave];
        g.tipi.push(i.tipo_intervento);
        g.id_interventi.push(i.id);
        g.interventi.push(i);
      });

      Object.values(gruppiMap).forEach(g => {
        const stati = g.interventi.map(i => i.stato);
        const tuttiUguali = stati.every(s => s === stati[0]);
        g.stato = tuttiUguali ? stati[0] : 'misto';
      });

      return {
        id_biliardo: b.id,
        nome_tavolo: b.nome_tavolo,
        tipo: b.tipo,
        dimensioni: b.dimensioni,
        omologato: b.omologato === true,
        esente: b.esente === true,
        gruppi: Object.values(gruppiMap).sort((a, b) => 
          new Date(b.data_intervento) - new Date(a.data_intervento)
        )
      };
    });

    // 4. Calcola esenzione per includerla nella response
    const { data: tesseratiData } = await supabaseAdmin
      .from('tesserati')
      .select('codice_fiscale')
      .eq('asd_id', idAsd)
      .eq('stato', 'attivo')
      .in('categoria', ['Ordinaria', 'Pre-Agonistica'])
      .not('codice_fiscale', 'is', null);

    const cfUnici = new Set((tesseratiData || []).map(t => t.codice_fiscale));
    const numTesserati = cfUnici.size;
    const maxEsenti = Math.floor(numTesserati * 0.15);
    const biliardiEsentiCount = biliardiConGruppi.filter(b => b.esente === true).length;
    const biliardiOmologatiCount = biliardiConGruppi.filter(b => b.omologato === true).length;

    res.json({
      success: true,
      id_asd: parseInt(idAsd),
      biliardi: biliardiConGruppi,
      esenzione: {
        num_tesserati: numTesserati,
        max_esenti: maxEsenti,
        biliardi_esenti: biliardiEsentiCount,
        biliardi_totali: biliardiConGruppi.length,
        biliardi_omologati: biliardiOmologatiCount
      }
    });

  } catch (error) {
    console.error('❌ Errore raggruppati ASD:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CALCOLA ESENZIONE ISI (default + verifica)
// POST /api/interventi/asd/:idAsd/calcola-esenzione
// ============================================
router.post('/interventi/asd/:idAsd/calcola-esenzione', authenticate, async (req, res) => {
  try {
    const { idAsd } = req.params;
    console.log(`🔵 POST /interventi/asd/${idAsd}/calcola-esenzione`);

    // 1. Conta tesserati attivi (CF univoci, categoria Ordinaria/Pre-Agonistica)
    const { data: tesseratiData, error: tError } = await supabaseAdmin
      .from('tesserati')
      .select('codice_fiscale')
      .eq('asd_id', idAsd)
      .eq('stato', 'attivo')
      .in('categoria', ['Ordinaria', 'Pre-Agonistica'])
      .not('codice_fiscale', 'is', null);

    if (tError) throw tError;

    const cfUnici = new Set((tesseratiData || []).map(t => t.codice_fiscale));
    const numTesserati = cfUnici.size;
    const maxEsenti = Math.floor(numTesserati * 0.15);
    console.log(`📊 Tesserati: ${numTesserati}, Max esenti: ${maxEsenti}`);

    // 2. Recupera tutti i biliardi dell'ASD
    const { data: biliardi, error: bError } = await supabaseAdmin
      .from('biliardi')
      .select('id, nome_tavolo, omologato, esente')
      .eq('id_asd', idAsd)
      .eq('attivo', true)
      .order('id', { ascending: true });

    if (bError) throw bError;

    if (!biliardi || biliardi.length === 0) {
      return res.json({
        success: true,
        num_tesserati: numTesserati,
        max_esenti: maxEsenti,
        biliardi_esenti: 0,
        biliardi_totali: 0,
        biliardi_omologati: 0,
        biliardi: []
      });
    }

    // 3. Filtra SOLO i biliardi OMOLOGATI (requisito per esenzione)
    const biliardiOmologati = biliardi
      .filter(b => b.omologato === true)
      .sort((a, b) => a.id - b.id);

    // 4. Logica Caso A/B/C (solo su biliardi omologati)
    const esistentiEsenti = biliardiOmologati
      .filter(b => b.esente === true)
      .map(b => b.id)
      .sort((a, b) => a - b);

    let idEsenti = [];

    if (esistentiEsenti.length === 0) {
      idEsenti = biliardiOmologati.slice(0, maxEsenti).map(b => b.id);
      console.log(`✨ Default: primi ${idEsenti.length} biliardi omologati`);
    } else if (esistentiEsenti.length > maxEsenti) {
      idEsenti = esistentiEsenti.slice(0, maxEsenti);
      console.log(`✂️ Ridotti da ${esistentiEsenti.length} a ${maxEsenti} esenti`);
    } else {
      idEsenti = esistentiEsenti;
      console.log(`✅ Mantenuti ${idEsenti.length} esenti`);
    }

    // 5. Aggiorna TUTTI i biliardi
    const idEsentiSet = new Set(idEsenti);
    const now = new Date().toISOString();
    let aggiornati = 0;

    for (const b of biliardi) {
      const shouldBeEsente = idEsentiSet.has(b.id);
      if (b.esente !== shouldBeEsente) {
        await supabaseAdmin
          .from('biliardi')
          .update({ 
            esente: shouldBeEsente,
            data_calcolo_esenzione: now
          })
          .eq('id', b.id);
        aggiornati++;
      }
    }

    console.log(`✅ ${aggiornati} biliardi aggiornati`);

    res.json({
      success: true,
      num_tesserati: numTesserati,
      max_esenti: maxEsenti,
      biliardi_esenti: idEsenti.length,
      biliardi_totali: biliardi.length,
      biliardi_omologati: biliardiOmologati.length,
      biliardi: biliardi.map(b => ({
        ...b,
        esente: idEsentiSet.has(b.id)
      }))
    });

  } catch (error) {
    console.error('❌ Errore calcola-esenzione:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// GET STATO ESENZIONE ISI
// GET /api/interventi/asd/:idAsd/biliardi-esenzione
// ============================================
router.get('/interventi/asd/:idAsd/biliardi-esenzione', authenticate, async (req, res) => {
  try {
    const { idAsd } = req.params;
    console.log(`🔵 GET /interventi/asd/${idAsd}/biliardi-esenzione`);

    const { data: tesseratiData, error: tError } = await supabaseAdmin
      .from('tesserati')
      .select('codice_fiscale')
      .eq('asd_id', idAsd)
      .eq('stato', 'attivo')
      .in('categoria', ['Ordinaria', 'Pre-Agonistica'])
      .not('codice_fiscale', 'is', null);

    if (tError) throw tError;

    const cfUnici = new Set((tesseratiData || []).map(t => t.codice_fiscale));
    const numTesserati = cfUnici.size;
    const maxEsenti = Math.floor(numTesserati * 0.15);

    const { data: biliardi, error: bError } = await supabaseAdmin
      .from('biliardi')
      .select('id, nome_tavolo, tipo, dimensioni, omologato, esente, data_calcolo_esenzione')
      .eq('id_asd', idAsd)
      .eq('attivo', true)
      .order('id', { ascending: true });

    if (bError) throw bError;

    const biliardiEsenti = (biliardi || []).filter(b => b.esente === true).length;

    res.json({
      success: true,
      id_asd: parseInt(idAsd),
      num_tesserati: numTesserati,
      max_esenti: maxEsenti,
      biliardi_totali: biliardi?.length || 0,
      biliardi_esenti: biliardiEsenti,
      biliardi: biliardi || []
    });

  } catch (error) {
    console.error('❌ Errore biliardi-esenzione:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// OMOLOGA BILIARDO SINGOLO (manuale)
// PUT /api/interventi/biliardo/:idBiliardo/omologa
// Body: { omologato: true/false }
// ============================================
router.put('/interventi/biliardo/:idBiliardo/omologa', authenticate, async (req, res) => {
  try {
    const { idBiliardo } = req.params;
    const { omologato = true } = req.body;
    console.log(`🔵 PUT /interventi/biliardo/${idBiliardo}/omologa - omologato: ${omologato}`);

    const { data: admin, error: adminError } = await supabaseAdmin
      .from('manutentori')
      .select('id')
      .eq('user_id', req.userId)
      .maybeSingle();

    if (adminError || !admin) {
      return res.status(403).json({ error: 'Utente non autorizzato' });
    }

    const { data: biliardo, error: bError } = await supabaseAdmin
      .from('biliardi')
      .select('id, nome_tavolo, id_asd')
      .eq('id', idBiliardo)
      .maybeSingle();

    if (bError || !biliardo) {
      return res.status(404).json({ error: 'Biliardo non trovato' });
    }

    const updateData = {
      omologato: omologato
    };

    if (omologato) {
      updateData.data_omologazione = new Date().toISOString().split('T')[0];
      updateData.omologato_da = admin.id;
      updateData.omologato_note = 'Omologazione manuale';
    } else {
      updateData.data_omologazione = null;
      updateData.omologato_da = admin.id;
      updateData.omologato_note = 'De-omologato manualmente';
    }

    const { data, error } = await supabaseAdmin
      .from('biliardi')
      .update(updateData)
      .eq('id', idBiliardo)
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Biliardo ${biliardo.nome_tavolo} omologato: ${omologato}`);

    res.json({
      success: true,
      message: omologato ? 'Biliardo omologato' : 'Biliardo de-omologato',
      biliardo: data
    });

  } catch (error) {
    console.error('❌ Errore omologa biliardo:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// OMOLOGA TUTTI I BILIARDI DI UN'ASD (bootstrap)
// PUT /api/interventi/asd/:idAsd/omologa-tutti
// Body: { omologato: true/false }
// ============================================
router.put('/interventi/asd/:idAsd/omologa-tutti', authenticate, async (req, res) => {
  try {
    const { idAsd } = req.params;
    const { omologato = true } = req.body;
    console.log(`🔵 PUT /interventi/asd/${idAsd}/omologa-tutti - omologato: ${omologato}`);

    const { data: admin, error: adminError } = await supabaseAdmin
      .from('manutentori')
      .select('id')
      .eq('user_id', req.userId)
      .maybeSingle();

    if (adminError || !admin) {
      return res.status(403).json({ error: 'Utente non autorizzato' });
    }

    const { data: biliardi, error: bError } = await supabaseAdmin
      .from('biliardi')
      .select('id, nome_tavolo')
      .eq('id_asd', idAsd)
      .eq('attivo', true);

    if (bError) throw bError;

    if (!biliardi || biliardi.length === 0) {
      return res.status(404).json({ error: 'Nessun biliardo trovato per questa ASD' });
    }

    const updateData = {
      omologato: omologato
    };

    if (omologato) {
      updateData.data_omologazione = new Date().toISOString().split('T')[0];
      updateData.omologato_da = admin.id;
      updateData.omologato_note = 'Omologazione massiva (bootstrap)';
    } else {
      updateData.data_omologazione = null;
      updateData.omologato_da = admin.id;
      updateData.omologato_note = 'De-omologazione massiva';
    }

    const idBiliardi = biliardi.map(b => b.id);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('biliardi')
      .update(updateData)
      .in('id', idBiliardi)
      .select();

    if (updateError) throw updateError;

    console.log(`✅ ${updated.length} biliardi aggiornati`);

    res.json({
      success: true,
      message: `${updated.length} biliardi ${omologato ? 'omologati' : 'de-omologati'}`,
      biliardi_aggiornati: updated.length,
      biliardi: updated
    });

  } catch (error) {
    console.error('❌ Errore omologa-tutti:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// VALIDA GRUPPO DI INTERVENTI
// ============================================
router.put('/interventi/valida-gruppo', authenticate, async (req, res) => {
  try {
    const { id_interventi, omologato = true, note = null } = req.body;

    if (!Array.isArray(id_interventi) || id_interventi.length === 0) {
      return res.status(400).json({ error: 'id_interventi mancante o vuoto' });
    }

    console.log(`🔵 PUT /interventi/valida-gruppo - ${id_interventi.length} interventi`);

    const { data: admin, error: adminError } = await supabaseAdmin
      .from('manutentori')
      .select('id')
      .eq('user_id', req.userId)
      .maybeSingle();

    if (adminError || !admin) {
      return res.status(403).json({ error: 'Utente non autorizzato' });
    }

    const { data: interventi, error: intError } = await supabaseAdmin
      .from('interventi')
      .select('id, id_biliardo')
      .in('id', id_interventi);

    if (intError || !interventi || interventi.length === 0) {
      return res.status(404).json({ error: 'Interventi non trovati' });
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('interventi')
      .update({
        stato: 'validato',
        validato_da: admin.id,
        data_validazione: new Date().toISOString()
      })
      .in('id', id_interventi)
      .select();

    if (updateError) throw updateError;

    const verificheRecords = interventi.map(i => ({
      id_intervento: i.id,
      id_biliardo: i.id_biliardo,
      id_admin: admin.id,
      esito: 'conforme',
      omologato: omologato,
      note: note
    }));

    const { error: verError } = await supabaseAdmin
      .from('verifiche_federazione')
      .insert(verificheRecords);

    if (verError) throw verError;

    if (omologato) {
      const idBiliardi = [...new Set(interventi.map(i => i.id_biliardo))];
      for (const idBiliardo of idBiliardi) {
        await supabaseAdmin
          .from('biliardi')
          .update({
            omologato: true,
            data_omologazione: new Date().toISOString().split('T')[0],
            omologato_da: admin.id,
            omologato_note: note
          })
          .eq('id', idBiliardo);
      }
    }

    res.json({
      success: true,
      message: `${updated.length} interventi validati`,
      interventi: updated
    });

  } catch (error) {
    console.error('❌ Errore valida-gruppo:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CONTESTA GRUPPO DI INTERVENTI
// ============================================
router.put('/interventi/contesta-gruppo', authenticate, async (req, res) => {
  try {
    const { id_interventi, motivo } = req.body;

    if (!Array.isArray(id_interventi) || id_interventi.length === 0) {
      return res.status(400).json({ error: 'id_interventi mancante o vuoto' });
    }

    if (!motivo) {
      return res.status(400).json({ error: 'Motivo obbligatorio' });
    }

    console.log(`🔵 PUT /interventi/contesta-gruppo - ${id_interventi.length} interventi`);

    const { data: admin, error: adminError } = await supabaseAdmin
      .from('manutentori')
      .select('id')
      .eq('user_id', req.userId)
      .maybeSingle();

    if (adminError || !admin) {
      return res.status(403).json({ error: 'Utente non autorizzato' });
    }

    const { data: interventi, error: intError } = await supabaseAdmin
      .from('interventi')
      .select('id, id_biliardo')
      .in('id', id_interventi);

    if (intError || !interventi || interventi.length === 0) {
      return res.status(404).json({ error: 'Interventi non trovati' });
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('interventi')
      .update({
        stato: 'contestato',
        validato_da: admin.id,
        data_validazione: new Date().toISOString()
      })
      .in('id', id_interventi)
      .select();

    if (updateError) throw updateError;

    const verificheRecords = interventi.map(i => ({
      id_intervento: i.id,
      id_biliardo: i.id_biliardo,
      id_admin: admin.id,
      esito: 'non_conforme',
      omologato: false,
      note: motivo
    }));

    const { error: verError } = await supabaseAdmin
      .from('verifiche_federazione')
      .insert(verificheRecords);

    if (verError) throw verError;

    const idBiliardi = [...new Set(interventi.map(i => i.id_biliardo))];
    for (const idBiliardo of idBiliardi) {
      await supabaseAdmin
        .from('biliardi')
        .update({
          omologato: false,
          omologato_da: admin.id,
          omologato_note: motivo
        })
        .eq('id', idBiliardo);
    }

    res.json({
      success: true,
      message: `${updated.length} interventi contestati`,
      interventi: updated
    });

  } catch (error) {
    console.error('❌ Errore contesta-gruppo:', error);
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
// VALIDA INTERVENTO (singolo)
// ============================================
router.put('/interventi/:id/valida', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { omologato = true, note = null } = req.body;
    console.log(`🔵 PUT /interventi/${id}/valida - Inizio`);

    const { data: admin, error: adminError } = await supabaseAdmin
      .from('manutentori')
      .select('id')
      .eq('user_id', req.userId)
      .maybeSingle();

    if (adminError || !admin) {
      return res.status(403).json({ error: 'Utente non autorizzato' });
    }

    const { data: intervento, error: intError } = await supabaseAdmin
      .from('interventi')
      .select('id, id_biliardo')
      .eq('id', id)
      .maybeSingle();

    if (intError || !intervento) {
      return res.status(404).json({ error: 'Intervento non trovato' });
    }

    const { data, error } = await supabaseAdmin
      .from('interventi')
      .update({ 
        stato: 'validato',
        validato_da: admin.id,
        data_validazione: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await supabaseAdmin
      .from('verifiche_federazione')
      .insert({
        id_intervento: parseInt(id),
        id_biliardo: intervento.id_biliardo,
        id_admin: admin.id,
        esito: 'conforme',
        omologato: omologato,
        note: note
      });

    if (omologato) {
      await supabaseAdmin
        .from('biliardi')
        .update({
          omologato: true,
          data_omologazione: new Date().toISOString().split('T')[0],
          omologato_da: admin.id,
          omologato_note: note
        })
        .eq('id', intervento.id_biliardo);
    }

    res.json(data);
  } catch (error) {
    console.error('❌ Errore valida intervento:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CONTESTA INTERVENTO (singolo)
// ============================================
router.put('/interventi/:id/contesta', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { motivo } = req.body;
    console.log(`🔵 PUT /interventi/${id}/contesta - Inizio`);

    if (!motivo) {
      return res.status(400).json({ error: 'Motivo obbligatorio' });
    }

    const { data: admin, error: adminError } = await supabaseAdmin
      .from('manutentori')
      .select('id')
      .eq('user_id', req.userId)
      .maybeSingle();

    if (adminError || !admin) {
      return res.status(403).json({ error: 'Utente non autorizzato' });
    }

    const { data: intervento, error: intError } = await supabaseAdmin
      .from('interventi')
      .select('id, id_biliardo')
      .eq('id', id)
      .maybeSingle();

    if (intError || !intervento) {
      return res.status(404).json({ error: 'Intervento non trovato' });
    }

    const { data, error } = await supabaseAdmin
      .from('interventi')
      .update({ 
        stato: 'contestato',
        validato_da: admin.id,
        data_validazione: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await supabaseAdmin
      .from('verifiche_federazione')
      .insert({
        id_intervento: parseInt(id),
        id_biliardo: intervento.id_biliardo,
        id_admin: admin.id,
        esito: 'non_conforme',
        omologato: false,
        note: motivo
      });

    await supabaseAdmin
      .from('biliardi')
      .update({
        omologato: false,
        omologato_da: admin.id,
        omologato_note: motivo
      })
      .eq('id', intervento.id_biliardo);

    res.json(data);
  } catch (error) {
    console.error('❌ Errore contesta intervento:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// LISTA ASD PER FILTRI (SOLO ADMIN)
// ============================================
router.get('/asd', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('asd_centri')
      .select('id, nome')
      .eq('attivo', true)
      .order('nome', { ascending: true });

    if (error) throw error;
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

// POST: Registra una verifica (per Direttori)
router.post('/verifiche', authenticate, async (req, res) => {
  try {
    const { id_biliardo, id_gara, conforme, motivo, note } = req.body;

    const { data: gara, error: garaError } = await supabaseAdmin
      .from('gare')
      .select('id_direttore')
      .eq('id', id_gara)
      .single();

    if (garaError) throw garaError;

    const { data: manutentore } = await supabaseAdmin
      .from('manutentori')
      .select('id')
      .eq('user_id', req.userId)
      .single();

    if (gara.id_direttore !== manutentore.id) {
      return res.status(403).json({ error: 'Non sei autorizzato per questa gara' });
    }

    const { data, error } = await supabaseAdmin
      .from('verifiche')
      .insert({
        id_biliardo,
        id_direttore: manutentore.id,
        id_gara,
        conforme,
        motivo: conforme ? null : motivo,
        note,
        data_verifica: new Date(),
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('❌ Errore POST /verifiche:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;