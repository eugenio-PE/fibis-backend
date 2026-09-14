import { supabaseAdmin } from '../config/supabase.js';

// ============================================================
// GET /api/console/gare
// Restituisce la lista delle gare, filtrabili per tipologia
// ============================================================

export const getGare = async (req, res) => {
  try {
    const { tipologia } = req.query;

    let query = supabaseAdmin
      .from('gare')
      .select('id, nome, tipologia, data_gara, stato, regione, categoria')
      .order('data_gara', { ascending: false });

    if (tipologia) {
      query = query.eq('tipologia', tipologia);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Errore query gare:', error);
      throw error;
    }

    res.json({
      success: true,
      totale: data?.length || 0,
      gare: data || []
    });

  } catch (error) {
    console.error('❌ Errore getGare:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante il recupero delle gare',
      dettaglio: error.message
    });
  }
};

// ============================================================
// GET /api/console/giorni/:idGara
// Restituisce i giorni di qualificazione di una gara
// ============================================================

export const getGiorni = async (req, res) => {
  try {
    const { idGara } = req.params;

    if (!idGara) {
      return res.status(400).json({
        success: false,
        error: 'id_gara mancante',
        codice: 'MISSING_PARAMS'
      });
    }

    // 1. Tenta da struttura_gara (dato ufficiale)
    const { data: struttura, error: strutturaError } = await supabaseAdmin
      .from('struttura_gara')
      .select('giorni, data_inizio_torneo, data_fine_torneo, totale_giorni')
      .eq('id_gara', idGara)
      .maybeSingle();

    if (strutturaError) {
      console.error('❌ Errore query struttura_gara:', strutturaError);
      throw strutturaError;
    }

    let giorni = [];
    let fonte = null;

    if (struttura && struttura.giorni && Array.isArray(struttura.giorni)) {
      giorni = struttura.giorni
        .filter(g => g.tipo === 'qualificazione')
        .map(g => ({
          data: g.data,
          tipo: g.tipo,
          turni: g.turni,
          descrizione: g.descrizione
        }));
      fonte = 'struttura_gara';
    }

    // 2. Fallback: se vuoto, leggi da iscrizioni_gare
    if (giorni.length === 0) {
      const { data: iscrizioni, error: iscrizioniError } = await supabaseAdmin
        .from('iscrizioni_gare')
        .select('giorno_iscrizione')
        .eq('id_gara', idGara)
        .not('giorno_iscrizione', 'is', null);

      if (iscrizioniError) {
        console.error('❌ Errore query iscrizioni_gare:', iscrizioniError);
        throw iscrizioniError;
      }

      const giorniSet = new Set();
      (iscrizioni || []).forEach(i => {
        if (i.giorno_iscrizione) giorniSet.add(i.giorno_iscrizione);
      });

      giorni = Array.from(giorniSet).sort().map(data => ({
        data,
        tipo: 'qualificazione',
        turni: null,
        descrizione: null
      }));
      fonte = 'iscrizioni_gare';
    }

    res.json({
      success: true,
      id_gara: parseInt(idGara),
      fonte,
      data_inizio_torneo: struttura?.data_inizio_torneo || null,
      data_fine_torneo: struttura?.data_fine_torneo || null,
      totale_giorni: giorni.length,
      giorni
    });

  } catch (error) {
    console.error('❌ Errore getGiorni:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante il recupero dei giorni',
      dettaglio: error.message
    });
  }
};

// ============================================================
// GET /api/console/turni/:idGara/:giorno
// Restituisce i turni disponibili per una gara in un dato giorno
// ============================================================

export const getTurni = async (req, res) => {
  try {
    const { idGara, giorno } = req.params;

    if (!idGara || !giorno) {
      return res.status(400).json({
        success: false,
        error: 'Parametri mancanti',
        codice: 'MISSING_PARAMS'
      });
    }

    const { data, error } = await supabaseAdmin
      .from('iscrizioni_gare')
      .select('turno_value')
      .eq('id_gara', idGara)
      .eq('giorno_iscrizione', giorno);

    if (error) {
      console.error('❌ Errore query turni:', error);
      throw error;
    }

    // Distinct turni
    const turniSet = new Set();
    (data || []).forEach(row => {
      if (row.turno_value) turniSet.add(row.turno_value);
    });

    const turni = Array.from(turniSet).sort();

    res.json({
      success: true,
      id_gara: parseInt(idGara),
      giorno,
      totale: turni.length,
      turni
    });

  } catch (error) {
    console.error('❌ Errore getTurni:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante il recupero dei turni',
      dettaglio: error.message
    });
  }
};

// ============================================================
// GET /api/console/turno/:idGara/:turno
// Restituisce gli iscritti a un turno con stato check-in
// ============================================================

export const getDettaglioTurno = async (req, res) => {
  try {
    const { idGara, turno } = req.params;

    if (!idGara || !turno) {
      return res.status(400).json({
        success: false,
        error: 'Parametri mancanti',
        codice: 'MISSING_PARAMS'
      });
    }

    // 1. Recupera iscritti al turno
    const { data: iscritti, error: iscrittiError } = await supabaseAdmin
      .from('iscrizioni_gare')
      .select(`
        id,
        id_tesserato,
        giorno_iscrizione,
        turno_value,
        eliminato,
        stato,
        tesserati:id_tesserato (
          id, nome, cognome, matricola, categoria, asd_id
        )
      `)
      .eq('id_gara', idGara)
      .eq('turno_value', turno)
      .order('id_tesserato', { ascending: true });

    if (iscrittiError) {
      console.error('❌ Errore query iscritti:', iscrittiError);
      throw iscrittiError;
    }

    // 2. Recupera check-in effettuati per lo stesso turno
    const { data: presenze, error: presenzeError } = await supabaseAdmin
      .from('presenze_gare')
      .select('id_tesserato, data_scansione, metodo')
      .eq('id_gara', idGara)
      .eq('turno_value', turno);

    if (presenzeError) {
      console.error('❌ Errore query presenze:', presenzeError);
      throw presenzeError;
    }

    // 3. Mappa presenze per lookup veloce
    const presenzeMap = {};
    (presenze || []).forEach(p => {
      presenzeMap[p.id_tesserato] = {
        presente: true,
        data_scansione: p.data_scansione,
        metodo: p.metodo
      };
    });

    // 4. Combina iscritti + presenze
    const lista = (iscritti || []).map(iscritto => {
      const presenza = presenzeMap[iscritto.id_tesserato];
      return {
        id_iscrizione: iscritto.id,
        id_tesserato: iscritto.id_tesserato,
        nome: iscritto.tesserati?.nome || null,
        cognome: iscritto.tesserati?.cognome || null,
        matricola: iscritto.tesserati?.matricola || null,
        categoria: iscritto.tesserati?.categoria || null,
        asd_id: iscritto.tesserati?.asd_id || null,
        eliminato: iscritto.eliminato,
        stato_iscrizione: iscritto.stato,
        presente: presenza ? true : false,
        data_scansione: presenza?.data_scansione || null,
        metodo: presenza?.metodo || null
      };
    });

    // 5. Contatori
    const totale_iscritti = lista.length;
    const totale_presenti = lista.filter(i => i.presente).length;

    res.json({
      success: true,
      id_gara: parseInt(idGara),
      turno_value: turno,
      totale_iscritti,
      totale_presenti,
      iscritti: lista
    });

  } catch (error) {
    console.error('❌ Errore getDettaglioTurno:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante il recupero del turno',
      dettaglio: error.message
    });
  }
};
// ============================================================
// GET /api/console/arbitri-disponibili
// Lista di tutti i manutentori con ruolo 'arbitro'
// ============================================================

export const getArbitriDisponibili = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .select('id, nome, cognome, email, telefono, is_active')
      .eq('ruolo', 'arbitro')
      .eq('is_active', true)
      .order('cognome', { ascending: true });

    if (error) {
      console.error('❌ Errore query arbitri disponibili:', error);
      throw error;
    }

    res.json({
      success: true,
      totale: data?.length || 0,
      arbitri: data || []
    });

  } catch (error) {
    console.error('❌ Errore getArbitriDisponibili:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante il recupero degli arbitri',
      dettaglio: error.message
    });
  }
};

// ============================================================
// GET /api/console/arbitri-gara/:idGara
// Lista arbitri assegnati a una gara
// ============================================================

export const getArbitriGara = async (req, res) => {
  try {
    const { idGara } = req.params;

    if (!idGara) {
      return res.status(400).json({
        success: false,
        error: 'id_gara mancante',
        codice: 'MISSING_PARAMS'
      });
    }

    const { data, error } = await supabaseAdmin
      .from('arbitri_gara')
      .select(`
        id,
        id_gara,
        id_manutentore,
        ruolo,
        data_assegnazione,
        attivo,
        manutentori:id_manutentore (
          id, nome, cognome, email, telefono
        )
      `)
      .eq('id_gara', idGara)
      .eq('attivo', true)
      .order('data_assegnazione', { ascending: false });

    if (error) {
      console.error('❌ Errore query arbitri gara:', error);
      throw error;
    }

    res.json({
      success: true,
      id_gara: parseInt(idGara),
      totale: data?.length || 0,
      arbitri: data || []
    });

  } catch (error) {
    console.error('❌ Errore getArbitriGara:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante il recupero degli arbitri',
      dettaglio: error.message
    });
  }
};

// ============================================================
// POST /api/console/arbitri-gara/:idGara
// Assegna arbitri a una gara
// Body: { id_manutentori: [1, 2, 3, ...] }
// ============================================================

export const assegnaArbitriGara = async (req, res) => {
  try {
    const { idGara } = req.params;
    const { id_manutentori } = req.body;

    if (!idGara) {
      return res.status(400).json({
        success: false,
        error: 'id_gara mancante',
        codice: 'MISSING_PARAMS'
      });
    }

    if (!Array.isArray(id_manutentori) || id_manutentori.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'id_manutentori mancante o vuoto',
        codice: 'MISSING_DATA'
      });
    }

    // Prepara i record da inserire
    const records = id_manutentori.map(idMan => ({
      id_gara: parseInt(idGara),
      id_manutentore: parseInt(idMan),
      ruolo: 'arbitro',
      attivo: true
    }));

    // Upsert: se già esiste, aggiorna (non duplica)
    const { data, error } = await supabaseAdmin
      .from('arbitri_gara')
      .upsert(records, {
        onConflict: 'id_gara,id_manutentore',
        ignoreDuplicates: false
      })
      .select();

    if (error) {
      console.error('❌ Errore upsert arbitri gara:', error);
      throw error;
    }

    res.status(201).json({
      success: true,
      message: `${data?.length || 0} arbitri assegnati`,
      assegnati: data || []
    });

  } catch (error) {
    console.error('❌ Errore assegnaArbitriGara:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante l\'assegnazione degli arbitri',
      dettaglio: error.message
    });
  }
};

// ============================================================
// DELETE /api/console/arbitri-gara/:idGara/:idManutentore
// Rimuovi un arbitro da una gara
// ============================================================

export const rimuoviArbitroGara = async (req, res) => {
  try {
    const { idGara, idManutentore } = req.params;

    if (!idGara || !idManutentore) {
      return res.status(400).json({
        success: false,
        error: 'Parametri mancanti',
        codice: 'MISSING_PARAMS'
      });
    }

    // Soft delete: imposta attivo = false
    const { data, error } = await supabaseAdmin
      .from('arbitri_gara')
      .update({ attivo: false })
      .eq('id_gara', idGara)
      .eq('id_manutentore', idManutentore)
      .select();

    if (error) {
      console.error('❌ Errore rimozione arbitro:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Assegnazione non trovata',
        codice: 'NOT_FOUND'
      });
    }

    res.json({
      success: true,
      message: 'Arbitro rimosso dalla gara'
    });

  } catch (error) {
    console.error('❌ Errore rimuoviArbitroGara:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante la rimozione dell\'arbitro',
      dettaglio: error.message
    });
  }
};