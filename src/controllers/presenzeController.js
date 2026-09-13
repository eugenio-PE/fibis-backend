import { supabaseAdmin } from '../config/supabase.js';

// ============================================================
// UTILITY
// ============================================================

/**
 * Restituisce la data odierna in fuso italiano (YYYY-MM-DD)
 */
const getOggiItalia = () => {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
};

// ============================================================
// POST /api/presenze/check-in
// ============================================================

export const checkIn = async (req, res) => {
  try {
    const { id_tesserato, id_gara } = req.body;

    // 1. Validazione input
    if (!id_tesserato || !id_gara) {
      return res.status(400).json({
        success: false,
        error: 'Dati mancanti',
        codice: 'MISSING_DATA',
        dettaglio: 'id_tesserato e id_gara sono obbligatori'
      });
    }

    // 2. Trova l'iscrizione del tesserato per quella gara
    const { data: iscrizione, error: iscrizioneError } = await supabaseAdmin
      .from('iscrizioni_gare')
      .select('id, turno_value, giorno_iscrizione, eliminato, stato')
      .eq('id_gara', id_gara)
      .eq('id_tesserato', id_tesserato)
      .maybeSingle();

    if (iscrizioneError) {
      console.error('❌ Errore query iscrizione:', iscrizioneError);
      throw iscrizioneError;
    }

    if (!iscrizione) {
      return res.status(404).json({
        success: false,
        error: 'Tesserato non iscritto a questa gara',
        codice: 'NOT_ENROLLED'
      });
    }

    // 3. Verifica giorno di gara
    const oggi = getOggiItalia();
    const giornoGara = iscrizione.giorno_iscrizione;

    if (!giornoGara) {
      return res.status(422).json({
        success: false,
        error: 'Iscrizione senza giorno di gara',
        codice: 'NO_GAME_DAY'
      });
    }

    if (oggi < giornoGara) {
      return res.status(422).json({
        success: false,
        error: 'Non è il giorno di gara del tesserato',
        codice: 'NOT_GAME_DAY',
        dettaglio: `Oggi: ${oggi}, Giorno di gara: ${giornoGara}`
      });
    }

    if (oggi > giornoGara) {
      return res.status(422).json({
        success: false,
        error: 'Il giorno di gara del tesserato è già passato',
        codice: 'GAME_DAY_PASSED',
        dettaglio: `Oggi: ${oggi}, Giorno di gara: ${giornoGara}`
      });
    }

    // 4. Verifica "eliminato" (partita persa)
    if (iscrizione.eliminato === true) {
      return res.status(422).json({
        success: false,
        error: 'Il tesserato ha già avuto partita persa',
        codice: 'ELIMINATED'
      });
    }

    // 5. Verifica check-in già effettuato
    const { data: presenzaEsistente, error: presenzaError } = await supabaseAdmin
      .from('presenze_gare')
      .select('id, data_scansione')
      .eq('id_gara', id_gara)
      .eq('id_tesserato', id_tesserato)
      .eq('giorno', giornoGara)
      .eq('turno_value', iscrizione.turno_value)
      .maybeSingle();

    if (presenzaError) {
      console.error('❌ Errore query presenza:', presenzaError);
      throw presenzaError;
    }

    if (presenzaEsistente) {
      return res.status(409).json({
        success: false,
        error: 'Check-in già effettuato',
        codice: 'ALREADY_CHECKED_IN',
        dettaglio: `Check-in del ${presenzaEsistente.data_scansione}`
      });
    }

    // 6. Recupera l'operatore (manutentore) dal user_id
    let id_operatore = null;
    if (req.userId) {
      const { data: manutentore } = await supabaseAdmin
        .from('manutentori')
        .select('id')
        .eq('user_id', req.userId)
        .maybeSingle();

      if (manutentore) {
        id_operatore = manutentore.id;
      }
    }

    // 7. Inserisci presenza
    const { data: presenza, error: insertError } = await supabaseAdmin
      .from('presenze_gare')
      .insert({
        id_gara,
        id_tesserato,
        giorno: giornoGara,
        turno_value: iscrizione.turno_value,
        metodo: 'qr_direttore',
        id_operatore
      })
      .select()
      .single();

    if (insertError) {
      // Gestione duplicato (vincolo UNIQUE)
      if (insertError.code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'Check-in già effettuato',
          codice: 'ALREADY_CHECKED_IN'
        });
      }
      console.error('❌ Errore insert presenza:', insertError);
      throw insertError;
    }

    // 8. Recupera dati tesserato per la risposta
    const { data: tesserato } = await supabaseAdmin
      .from('tesserati')
      .select('id, nome, cognome, matricola, categoria')
      .eq('id', id_tesserato)
      .single();

    // 9. Risposta successo
    res.status(201).json({
      success: true,
      message: 'Check-in registrato',
      presenza: {
        id: presenza.id,
        id_gara: presenza.id_gara,
        id_tesserato: presenza.id_tesserato,
        nome: tesserato?.nome || null,
        cognome: tesserato?.cognome || null,
        matricola: tesserato?.matricola || null,
        categoria: tesserato?.categoria || null,
        giorno: presenza.giorno,
        turno_value: presenza.turno_value,
        data_scansione: presenza.data_scansione
      }
    });

  } catch (error) {
    console.error('❌ Errore check-in:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante il check-in',
      codice: 'SERVER_ERROR',
      dettaglio: error.message
    });
  }
};

// ============================================================
// GET /api/presenze/turno/:idGara/:turno
// ============================================================

export const getPresenzeTurno = async (req, res) => {
  try {
    const { idGara, turno } = req.params;

    if (!idGara || !turno) {
      return res.status(400).json({
        success: false,
        error: 'Parametri mancanti',
        codice: 'MISSING_PARAMS'
      });
    }

    const { data, error } = await supabaseAdmin
      .from('presenze_gare')
      .select(`
        id,
        id_gara,
        id_tesserato,
        giorno,
        turno_value,
        data_scansione,
        metodo,
        id_operatore,
        tesserati:id_tesserato (
          id, nome, cognome, matricola, categoria
        )
      `)
      .eq('id_gara', idGara)
      .eq('turno_value', turno)
      .order('data_scansione', { ascending: true });

    if (error) {
      console.error('❌ Errore query presenze turno:', error);
      throw error;
    }

    res.json({
      success: true,
      id_gara: idGara,
      turno_value: turno,
      totale: data?.length || 0,
      presenze: data || []
    });

  } catch (error) {
    console.error('❌ Errore getPresenzeTurno:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante il recupero delle presenze',
      dettaglio: error.message
    });
  }
};

// ============================================================
// GET /api/presenze/stats/:idGara
// ============================================================

export const getStatsGara = async (req, res) => {
  try {
    const { idGara } = req.params;

    if (!idGara) {
      return res.status(400).json({
        success: false,
        error: 'id_gara mancante',
        codice: 'MISSING_PARAMS'
      });
    }

    // 1. Recupera tutte le presenze della gara
    const { data: presenze, error } = await supabaseAdmin
      .from('presenze_gare')
      .select('giorno, turno_value, id_tesserato')
      .eq('id_gara', idGara);

    if (error) {
      console.error('❌ Errore query stats:', error);
      throw error;
    }

    const totale = presenze?.length || 0;

    // 2. Raggruppa per giorno
    const perGiornoMap = {};
    presenze?.forEach(p => {
      const g = p.giorno;
      perGiornoMap[g] = (perGiornoMap[g] || 0) + 1;
    });
    const per_giorno = Object.entries(perGiornoMap).map(([giorno, check_in]) => ({
      giorno,
      check_in
    })).sort((a, b) => a.giorno.localeCompare(b.giorno));

    // 3. Raggruppa per turno
    const perTurnoMap = {};
    presenze?.forEach(p => {
      const key = `${p.giorno}__${p.turno_value}`;
      if (!perTurnoMap[key]) {
        perTurnoMap[key] = { giorno: p.giorno, turno_value: p.turno_value, check_in: 0 };
      }
      perTurnoMap[key].check_in += 1;
    });
    const per_turno = Object.values(perTurnoMap).sort((a, b) => {
      if (a.giorno !== b.giorno) return a.giorno.localeCompare(b.giorno);
      return a.turno_value.localeCompare(b.turno_value);
    });

    res.json({
      success: true,
      id_gara: idGara,
      totale_check_in: totale,
      per_giorno,
      per_turno
    });

  } catch (error) {
    console.error('❌ Errore getStatsGara:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante il recupero delle statistiche',
      dettaglio: error.message
    });
  }
};