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
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import crypto from 'crypto';

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
// ULTIMI INTERVENTI
// ============================================
router.get('/interventi/ultimi', authenticate, async (req, res) => {
  try {
    const limit = req.query.limit || 10;
    const { data, error } = await supabaseAdmin
      .from('interventi')
      .select(`id, tipo_intervento, data_intervento, biliardi (nome_tavolo, asd_centri (nome))`)
      .order('data_intervento', { ascending: false })
      .limit(limit);

    if (error) throw error;
    res.json(data.map(i => ({
      ...i,
      biliardo_nome: i.biliardi?.nome_tavolo,
      asd_nome: i.biliardi?.asd_centri?.nome
    })));
  } catch (error) {
    console.error('❌ Errore /interventi/ultimi:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// LISTA INTERVENTI CON FILTRI
// ============================================
router.get('/interventi', authenticate, async (req, res) => {
  try {
    const { asdId } = req.query;
    let query = supabaseAdmin
      .from('interventi')
      .select(`
        *,
        manutentori!interventi_id_manutentore_fkey (nome, cognome),
        biliardi!interventi_id_biliardo_fkey (nome_tavolo, asd_centri!biliardi_id_asd_fkey (nome))
      `);
    
    if (asdId && asdId !== 'tutte') {
      query = query.eq('biliardi.asd_centri.id', parseInt(asdId));
    }
    
    const { data, error } = await query.order('data_intervento', { ascending: false });
    if (error) throw error;

    res.json(data.map(i => ({
      ...i,
      manutentore_nome: i.manutentori ? `${i.manutentori.nome} ${i.manutentori.cognome}` : 'N/A',
      biliardo_nome: i.biliardi?.nome_tavolo || 'N/A',
      asd_nome: i.biliardi?.asd_centri?.nome || 'N/A'
    })));
  } catch (error) {
    console.error('❌ Errore GET /interventi:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// LISTA ASD CON RIEPILOGO INTERVENTI (Livello 1)
// ============================================
router.get('/interventi/raggruppati-asd', authenticate, async (req, res) => {
  try {
    const { data: interventi, error } = await supabaseAdmin
      .from('interventi')
      .select(`
        id,
        stato,
        biliardi!interventi_id_biliardo_fkey (
          id,
          id_asd,
          asd_centri!biliardi_id_asd_fkey (id, nome)
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

    res.json({ success: true, totale: asdArray.length, asd: asdArray });
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

    // 1. Recupera biliardi dell'ASD
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

    // 2. Recupera interventi
    const { data: interventi, error: iError } = await supabaseAdmin
      .from('interventi')
      .select(`
        id, id_biliardo, tipo_intervento, stato, data_intervento, id_manutentore,
        numero_lotto_dichiarato, note, data_validazione, validato_da,
        foto_confezione, foto_marchio, foto_biliardo,
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

    // 4. Calcola esenzione
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
// CALCOLA ESENZIONE ISI (con logica corretta A/B/C)
// POST /api/interventi/asd/:idAsd/calcola-esenzione
// ============================================
router.post('/interventi/asd/:idAsd/calcola-esenzione', authenticate, async (req, res) => {
  try {
    const { idAsd } = req.params;
    console.log(`🔵 POST /interventi/asd/${idAsd}/calcola-esenzione`);

    // 1. Conta tesserati
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

    // 2. Recupera biliardi
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

    // 3. Filtra solo omologati (ordinati per id)
    const biliardiOmologati = biliardi
      .filter(b => b.omologato === true)
      .sort((a, b) => a.id - b.id);

    // 4. Esistenti esenti (tra gli omologati)
    const esistentiEsenti = biliardiOmologati
      .filter(b => b.esente === true)
      .map(b => b.id)
      .sort((a, b) => a - b);

    let idEsenti = [];

    // ============================================================
    // LOGICA CORRETTA A/B/C
    // ============================================================
    if (esistentiEsenti.length === 0) {
      // Caso C: nessun esente → default primi N
      idEsenti = biliardiOmologati.slice(0, maxEsenti).map(b => b.id);
      console.log(`✨ Caso C - Default: primi ${idEsenti.length}`);
    } else if (esistentiEsenti.length > maxEsenti) {
      // Caso B: troppi → taglia
      idEsenti = esistentiEsenti.slice(0, maxEsenti);
      console.log(`✂️ Caso B - Ridotti da ${esistentiEsenti.length} a ${maxEsenti}`);
    } else if (esistentiEsenti.length < maxEsenti) {
      // Caso A: meno di max → mantieni + aggiungi fino a max
      const idOmologatiOrdinati = biliardiOmologati.map(b => b.id);
      const idAggiuntivi = idOmologatiOrdinati
        .filter(id => !esistentiEsenti.includes(id))
        .slice(0, maxEsenti - esistentiEsenti.length);
      
      idEsenti = [...esistentiEsenti, ...idAggiuntivi].sort((a, b) => a - b);
      console.log(`➕ Caso A - Aggiunti ${idAggiuntivi.length} esenti (totale: ${idEsenti.length})`);
    } else {
      // esistentiEsenti.length === maxEsenti → mantieni
      idEsenti = esistentiEsenti;
      console.log(`✅ Caso A - Mantenuti ${idEsenti.length} esenti`);
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

    // Ricarica per restituire lo stato aggiornato
    const { data: biliardiAggiornati } = await supabaseAdmin
      .from('biliardi')
      .select('id, nome_tavolo, omologato, esente')
      .eq('id_asd', idAsd)
      .eq('attivo', true)
      .order('id', { ascending: true });

    res.json({
      success: true,
      num_tesserati: numTesserati,
      max_esenti: maxEsenti,
      biliardi_esenti: idEsenti.length,
      biliardi_totali: biliardi.length,
      biliardi_omologati: biliardiOmologati.length,
      biliardi: biliardiAggiornati || biliardi
    });

  } catch (error) {
    console.error('❌ Errore calcola-esenzione:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// GET STATO ESENZIONE ISI
// ============================================
router.get('/interventi/asd/:idAsd/biliardi-esenzione', authenticate, async (req, res) => {
  try {
    const { idAsd } = req.params;

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
    const biliardiOmologati = (biliardi || []).filter(b => b.omologato === true).length;

    res.json({
      success: true,
      id_asd: parseInt(idAsd),
      num_tesserati: numTesserati,
      max_esenti: maxEsenti,
      biliardi_totali: biliardi?.length || 0,
      biliardi_omologati: biliardiOmologati,
      biliardi_esenti: biliardiEsenti,
      biliardi: biliardi || []
    });
  } catch (error) {
    console.error('❌ Errore biliardi-esenzione:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// OMOLOGA / REVOCA OMOLOGAZIONE BILIARDO SINGOLO
// PUT /api/interventi/biliardo/:idBiliardo/omologa
// Body: { omologato, motivo, origine }
// ============================================
router.put('/interventi/biliardo/:idBiliardo/omologa', authenticate, async (req, res) => {
  try {
    const { idBiliardo } = req.params;
    const { omologato = true, motivo = null, origine = 'admin' } = req.body;

    console.log(`🔵 PUT /interventi/biliardo/${idBiliardo}/omologa - omologato: ${omologato}`);

    // 1. Recupera operatore
    const { data: operatore, error: opError } = await supabaseAdmin
      .from('manutentori')
      .select('id, ruolo')
      .eq('user_id', req.userId)
      .maybeSingle();

    if (opError || !operatore) {
      return res.status(403).json({ error: 'Utente non autorizzato' });
    }

    // 2. Motivo obbligatorio SOLO per direttori/arbitri
    const isDirettore = operatore.ruolo === 'direttore' || operatore.ruolo === 'arbitro';
    if (isDirettore && (!motivo || motivo.trim() === '')) {
      return res.status(400).json({ error: 'Motivo obbligatorio per i direttori' });
    }

    // 3. Recupera biliardo
    const { data: biliardo, error: bError } = await supabaseAdmin
      .from('biliardi')
      .select('id, nome_tavolo, id_asd')
      .eq('id', idBiliardo)
      .maybeSingle();

    if (bError || !biliardo) {
      return res.status(404).json({ error: 'Biliardo non trovato' });
    }

    // 4. Determina origine
    let origineFinale = 'admin';
    if (operatore.ruolo === 'settore_tecnico') origineFinale = 'settore_tecnico';
    else if (isDirettore) origineFinale = 'direttore';

    // 5. Aggiorna biliardo
    const updateData = { 
      omologato,
      omologato_note: motivo ? motivo.trim() : 'Operazione da dashboard',
      omologato_origine: origineFinale,
      omologato_da: operatore.id
    };

    if (omologato) {
      updateData.data_omologazione = new Date().toISOString().split('T')[0];
    } else {
      updateData.data_omologazione = null;
    }

    const { data, error } = await supabaseAdmin
      .from('biliardi')
      .update(updateData)
      .eq('id', idBiliardo)
      .select()
      .single();

    if (error) throw error;

    // 6. Storico (sempre)
    await supabaseAdmin
      .from('storico_omologazione')
      .insert({
        id_biliardo: parseInt(idBiliardo),
        omologato,
        motivo: motivo ? motivo.trim() : null,
        origine: origineFinale,
        id_operatore: operatore.id
      });

    // 7. Ricalcola esenzione
    await fetch(`${process.env.BACKEND_URL || 'http://localhost:' + (process.env.PORT || 3000)}/api/interventi/asd/${biliardo.id_asd}/calcola-esenzione`, {
      method: 'POST',
      headers: { 'Authorization': req.headers.authorization }
    }).catch(e => console.warn('⚠️ Ricalcolo esenzione:', e.message));

    res.json({
      success: true,
      message: omologato ? 'Biliardo omologato' : 'Omologazione revocata',
      biliardo: data
    });
  } catch (error) {
    console.error('❌ Errore omologa biliardo:', error);
    res.status(500).json({ error: error.message });
  }
});
// ============================================
// OMOLOGA / REVOCA TUTTI I BILIARDI DI UN'ASD
// PUT /api/interventi/asd/:idAsd/omologa-tutti
// Body: { omologato, motivo }
// ============================================
router.put('/interventi/asd/:idAsd/omologa-tutti', authenticate, async (req, res) => {
  try {
    const { idAsd } = req.params;
    const { omologato = true, motivo = null } = req.body;

    // 1. Recupera operatore
    const { data: operatore, error: opError } = await supabaseAdmin
      .from('manutentori')
      .select('id, ruolo')
      .eq('user_id', req.userId)
      .maybeSingle();

    if (opError || !operatore) {
      return res.status(403).json({ error: 'Utente non autorizzato' });
    }

    // 2. Motivo obbligatorio SOLO per direttori/arbitri
    const isDirettore = operatore.ruolo === 'direttore' || operatore.ruolo === 'arbitro';
    if (isDirettore && (!motivo || motivo.trim() === '')) {
      return res.status(400).json({ error: 'Motivo obbligatorio per i direttori' });
    }

    // 3. Recupera biliardi
    const { data: biliardi, error: bError } = await supabaseAdmin
      .from('biliardi')
      .select('id, nome_tavolo')
      .eq('id_asd', idAsd)
      .eq('attivo', true);

    if (bError) throw bError;

    if (!biliardi || biliardi.length === 0) {
      return res.status(404).json({ error: 'Nessun biliardo trovato per questa ASD' });
    }

    // 4. Origine
    let origineFinale = 'admin';
    if (operatore.ruolo === 'settore_tecnico') origineFinale = 'settore_tecnico';
    else if (isDirettore) origineFinale = 'direttore';

    // 5. Aggiorna
    const updateData = { 
      omologato,
      omologato_note: motivo ? motivo.trim() : 'Operazione da dashboard',
      omologato_origine: origineFinale,
      omologato_da: operatore.id
    };

    if (omologato) {
      updateData.data_omologazione = new Date().toISOString().split('T')[0];
    } else {
      updateData.data_omologazione = null;
    }

    const idBiliardi = biliardi.map(b => b.id);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('biliardi')
      .update(updateData)
      .in('id', idBiliardi)
      .select();

    if (updateError) throw updateError;

    // 6. Storico (sempre)
    const storicoRecords = biliardi.map(b => ({
      id_biliardo: b.id,
      omologato,
      motivo: motivo ? motivo.trim() : null,
      origine: origineFinale,
      id_operatore: operatore.id
    }));

    await supabaseAdmin
      .from('storico_omologazione')
      .insert(storicoRecords);

    // 7. Ricalcola esenzione
    await fetch(`${process.env.BACKEND_URL || 'http://localhost:' + (process.env.PORT || 3000)}/api/interventi/asd/${idAsd}/calcola-esenzione`, {
      method: 'POST',
      headers: { 'Authorization': req.headers.authorization }
    }).catch(e => console.warn('⚠️ Ricalcolo esenzione:', e.message));

    res.json({
      success: true,
      message: `${updated.length} biliardi ${omologato ? 'omologati' : 'con omologazione revocata'}`,
      biliardi_aggiornati: updated.length,
      biliardi: updated
    });
  } catch (error) {
    console.error('❌ Errore omologa-tutti:', error);
    res.status(500).json({ error: error.message });
  }
});
// ============================================
// STORICO OMOLOGAZIONE BILIARDO
// GET /api/interventi/biliardo/:idBiliardo/storico-omologazione
// ============================================
router.get('/interventi/biliardo/:idBiliardo/storico-omologazione', authenticate, async (req, res) => {
  try {
    const { idBiliardo } = req.params;
    console.log(`🔵 GET /interventi/biliardo/${idBiliardo}/storico-omologazione`);

    const { data, error } = await supabaseAdmin
      .from('storico_omologazione')
      .select(`
        id,
        omologato,
        motivo,
        origine,
        data_operazione,
        operatore:manutentori!storico_omologazione_id_operatore_fkey (
          id, nome, cognome, ruolo
        )
      `)
      .eq('id_biliardo', idBiliardo)
      .order('data_operazione', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      id_biliardo: parseInt(idBiliardo),
      totale: data?.length || 0,
      storico: data || []
    });
  } catch (error) {
    console.error('❌ Errore storico-omologazione:', error);
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
    const { data, error } = await supabaseAdmin
      .from('interventi')
      .select(`
        *,
        manutentori!interventi_id_manutentore_fkey (nome, cognome, email),
        biliardi!interventi_id_biliardo_fkey (nome_tavolo, asd_centri!biliardi_id_asd_fkey (nome)),
        prodotti_omologati!interventi_id_prodotto_usato_fkey (marca, modello)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;

    res.json({
      ...data,
      manutentore_nome: data.manutentori ? `${data.manutentori.nome} ${data.manutentori.cognome}` : 'N/A',
      biliardo_nome: data.biliardi?.nome_tavolo || 'N/A',
      asd_nome: data.biliardi?.asd_centri?.nome || 'N/A',
      prodotto_marca: data.prodotti_omologati?.marca || 'N/A',
      prodotto_modello: data.prodotti_omologati?.modello || 'N/A'
    });
  } catch (error) {
    console.error('❌ Errore GET /interventi/:id:', error);
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
    console.error('❌ Errore GET /asd:', error);
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
    console.error('❌ Errore upload:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// REGISTRA VERIFICA (per Direttori)
// ============================================
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
// ============================================
// GET /api/biliardo/:uuid (PUBBLICO, per QR)
// ============================================
router.get('/biliardo/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    console.log(`🔵 GET /biliardo/${uuid} (pubblico)`);

    // 1. Biliardo
    const { data: biliardo, error: bError } = await supabaseAdmin
      .from('biliardi')
      .select(`
        id, nome_tavolo, tipo, dimensioni, omologato, esente,
        data_omologazione, omologato_note, omologato_origine,
        asd_centri!biliardi_id_asd_fkey (id, nome, codice)
      `)
      .eq('qr_code', uuid)
      .eq('attivo', true)
      .maybeSingle();

    if (bError || !biliardo) {
      return res.status(404).json({ error: 'Biliardo non trovato' });
    }

    // 2. Ultima modifica omologazione
    const { data: ultimaModifica } = await supabaseAdmin
      .from('storico_omologazione')
      .select(`
        omologato, motivo, origine, data_operazione,
        operatore:manutentori!storico_omologazione_id_operatore_fkey (
          id, nome, cognome, ruolo
        )
      `)
      .eq('id_biliardo', biliardo.id)
      .order('data_operazione', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 3. Ultimo intervento
    const { data: ultimoIntervento } = await supabaseAdmin
      .from('interventi')
      .select(`
        id, tipo_intervento, stato, data_intervento, numero_lotto_dichiarato,
        manutentori!interventi_id_manutentore_fkey (id, nome, cognome),
        prodotti_omologati!interventi_id_prodotto_usato_fkey (marca, modello)
      `)
      .eq('id_biliardo', biliardo.id)
      .order('data_intervento', { ascending: false })
      .limit(1)
      .maybeSingle();

    res.json({
      success: true,
      biliardo: {
        id: biliardo.id,
        nome_tavolo: biliardo.nome_tavolo,
        tipo: biliardo.tipo,
        dimensioni: biliardo.dimensioni,
        omologato: biliardo.omologato === true,
        esente: biliardo.esente === true,
        data_omologazione: biliardo.data_omologazione,
        omologato_note: biliardo.omologato_note,
        omologato_origine: biliardo.omologato_origine
      },
      asd: {
        id: biliardo.asd_centri?.id,
        nome: biliardo.asd_centri?.nome,
        codice: biliardo.asd_centri?.codice
      },
      ultima_modifica: ultimaModifica || null,
      ultimo_intervento: ultimoIntervento || null
    });

  } catch (error) {
    console.error('❌ Errore GET /biliardo/:uuid:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// POST /api/biliardo/:id/genera-qr (fallback, admin)
// ============================================
router.post('/biliardo/:id/genera-qr', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    // Recupera biliardo
    const { data: biliardo, error: bError } = await supabaseAdmin
      .from('biliardi')
      .select('id, nome_tavolo, qr_code')
      .eq('id', id)
      .maybeSingle();

    if (bError || !biliardo) {
      return res.status(404).json({ error: 'Biliardo non trovato' });
    }

    if (biliardo.qr_code) {
      return res.json({
        success: true,
        message: 'QR code già presente',
        qr_code: biliardo.qr_code
      });
    }

    // Genera UUID (PostgreSQL ha gen_random_uuid())
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('biliardi')
      .update({ qr_code: crypto.randomUUID() })
      .eq('id', id)
      .select('id, qr_code')
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      message: 'QR code generato',
      qr_code: updated.qr_code
    });
  } catch (error) {
    console.error('❌ Errore genera-qr:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// POST /api/biliardo/:id/genera-qr-pdf (admin + presidente)
// ============================================
router.post('/biliardo/:id/genera-qr-pdf', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔵 POST /biliardo/${id}/genera-qr-pdf`);

    const { data: biliardo, error: bError } = await supabaseAdmin
      .from('biliardi')
      .select(`
        id, nome_tavolo, tipo, dimensioni, omologato, esente, qr_code,
        asd_centri!biliardi_id_asd_fkey (nome, codice)
      `)
      .eq('id', id)
      .maybeSingle();

    if (bError || !biliardo) {
      return res.status(404).json({ error: 'Biliardo non trovato' });
    }

    if (!biliardo.qr_code) {
      return res.status(400).json({ error: 'QR code non generato' });
    }

    // Recupera ultimo intervento
    const { data: ultimoIntervento } = await supabaseAdmin
      .from('interventi')
      .select(`
        id, tipo_intervento, stato, data_intervento, numero_lotto_dichiarato,
        manutentori!interventi_id_manutentore_fkey (nome, cognome),
        prodotti_omologati!interventi_id_prodotto_usato_fkey (marca, modello)
      `)
      .eq('id_biliardo', id)
      .order('data_intervento', { ascending: false })
      .limit(1)
      .maybeSingle();

    const baseUrl = process.env.FRONTEND_URL || 'https://fibis-admin.vercel.app';
    const url = `${baseUrl}/biliardo/${biliardo.qr_code}`;

    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 400, margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' }
    });

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    // Header federale
    doc.fontSize(14).font('Helvetica-Bold')
       .text('FEDERAZIONE ITALIANA SPORT BILIARDO E BOWLING', { align: 'center' });
    doc.fontSize(9).font('Helvetica')
       .text('FSN - Federazione Sportiva Nazionale', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(8).font('Helvetica')
       .text('Sede legale: Via G.B. Piranesi, 46 - 20137 Milano', { align: 'center' });
    doc.text('Sede operativa Bowling: Via F. Antolisei, 6 - 00173 Roma', { align: 'center' });
    doc.text('Tel. +39 06 3311705 - 0633653218  |  Fax. +39 06 3311724', { align: 'center' });
    doc.text('email: segreteriabowling@fisbb.it  |  PEC: fisbb@pec.it', { align: 'center' });
    doc.moveDown(2);

    // Titolo dinamico in base allo stato omologazione
    doc.fontSize(14).font('Helvetica-Bold')
       .text(
         biliardo.omologato
           ? 'BILIARDO OMOLOGATO AD USO SPORTIVO'
           : 'BILIARDO NON OMOLOGATO',
         { align: 'center' }
       );
    doc.moveDown(1.5);

    // QR Code
    const qrSize = 250;
    const qrX = (doc.page.width - qrSize) / 2;
    doc.image(qrDataUrl, qrX, doc.y, { width: qrSize, height: qrSize });
    doc.y += qrSize + 20;

    // Dati
    doc.fontSize(11).font('Helvetica-Bold')
       .text(`ASD: ${biliardo.asd_centri?.nome || 'N/A'}`, { align: 'center' });
    doc.fontSize(11).font('Helvetica')
       .text(`Tavolo: ${biliardo.nome_tavolo}`, { align: 'center' });
    doc.text(`Tipo: ${biliardo.tipo} (${biliardo.dimensioni})`, { align: 'center' });
    doc.text(`Codice: ${biliardo.qr_code}`, { align: 'center' });
    doc.moveDown(1.5);

    // Stato omologazione
    if (biliardo.omologato) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#16a34a')
         .text('OMOLOGATO ai fini sportivi federali', { align: 'center' });
      doc.fillColor('#000000');
    } else {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#dc2626')
         .text('NON OMOLOGATO', { align: 'center' });
      doc.fillColor('#000000');
    }

    // Stato omologazione
    if (biliardo.omologato) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#16a34a')
         .text('OMOLOGATO ai fini sportivi federali', { align: 'center' });
      doc.fillColor('#000000');
    } else {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#dc2626')
         .text('NON OMOLOGATO', { align: 'center' });
      doc.fillColor('#000000');
    }

    // Stato esenzione ISI (mostrato SEMPRE)
    if (biliardo.esente) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#16a34a')
         .text('ESENTE dall\'Imposta sugli Intrattenimenti (ISI)', { align: 'center' });
      doc.fillColor('#000000');
    } else {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#ca8a04')
         .text('SOGGETTO a Imposta sugli Intrattenimenti (ISI)', { align: 'center' });
      doc.fillColor('#000000');
    }

    doc.moveDown(1.5);

    // Ultimo intervento di manutenzione
    if (ultimoIntervento) {
      doc.fontSize(11).font('Helvetica-Bold')
         .text('ULTIMO INTERVENTO DI MANUTENZIONE', { align: 'center' });
      doc.moveDown(0.5);

      const manutentoreNome = ultimoIntervento.manutentori
        ? `${ultimoIntervento.manutentori.nome} ${ultimoIntervento.manutentori.cognome}`
        : 'N/A';
      const prodotto = ultimoIntervento.prodotti_omologati
        ? `${ultimoIntervento.prodotti_omologati.marca || ''} ${ultimoIntervento.prodotti_omologati.modello || ''}`.trim()
        : 'N/A';

      const dataInt = ultimoIntervento.data_intervento
        ? new Date(ultimoIntervento.data_intervento).toLocaleString('it-IT')
        : 'N/A';

      doc.fontSize(9).font('Helvetica');
      doc.text(`Data: ${dataInt}`, { align: 'left' });
      doc.text(`Tipo: ${ultimoIntervento.tipo_intervento}`, { align: 'left' });
      doc.text(`Manutentore: ${manutentoreNome}`, { align: 'left' });
      doc.text(`Prodotto: ${prodotto || 'N/A'}`, { align: 'left' });
      doc.text(`Lotto: ${ultimoIntervento.numero_lotto_dichiarato || 'N/A'}`, { align: 'left' });
      doc.text(`Stato: ${ultimoIntervento.stato}`, { align: 'left' });
    } else {
      doc.fontSize(9).font('Helvetica-Oblique')
         .text('Nessun intervento registrato su questo biliardo.', { align: 'center' });
    }

    doc.moveDown(2);

    // Riferimenti normativi
    doc.fontSize(9).font('Helvetica-Bold')
       .text('Riferimenti normativi:');
    doc.fontSize(8).font('Helvetica')
       .text('• Art. 110, comma 7 del T.U.L.P.S. (R.D. 773/1931)')
       .text('• Protocollo d\'Intesa ADM-CONI del 10 maggio 2022')
       .text('• Circolare ADM Direzione Giochi n. 21/2022')
       .text('• Decreto Legislativo 28 febbraio 2021, n. 39');

    doc.moveDown(1);
    doc.fontSize(8)
       .text(`Data emissione: ${new Date().toLocaleDateString('it-IT')}`, { align: 'right' });

    doc.end();

    const pdfBuffer = await new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="biliardo-${biliardo.qr_code}.pdf"`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('❌ Errore genera-qr-pdf:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

