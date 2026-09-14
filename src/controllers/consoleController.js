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

    const { data, error } = await supabaseAdmin
      .from('struttura_gara')
      .select('giorni, data_inizio_torneo, data_fine_torneo, totale_giorni')
      .eq('id_gara', idGara)
      .maybeSingle();

    if (error) {
      console.error('❌ Errore query giorni:', error);
      throw error;
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        error: 'Struttura gara non trovata',
        codice: 'NOT_FOUND'
      });
    }

    // Filtra solo i giorni di qualificazione
    const giorni = (data.giorni || [])
      .filter(g => g.tipo === 'qualificazione')
      .map(g => ({
        data: g.data,
        tipo: g.tipo,
        turni: g.turni,
        descrizione: g.descrizione
      }));

    res.json({
      success: true,
      id_gara: parseInt(idGara),
      data_inizio_torneo: data.data_inizio_torneo,
      data_fine_torneo: data.data_fine_torneo,
      totale_giorni: data.totale_giorni,
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