import { supabaseAdmin } from '../config/supabase.js';
import { inviaPushChiamata } from '../services/firebaseService.js';

// ============================================================
// TODO PRODUZIONE — INTEGRAZIONE GCS
// ============================================================
// In produzione, il backend si integrerà con GCS (segnapunti
// digitale) per ricevere in tempo reale:
// - Inizio partita (rilevato dal segnapunti)
// - Punteggi in tempo reale
// - Fine partita + vincitore
//
// Campi da aggiungere in futuro:
// - batterie_turno.gcs_match_id (TEXT) → collega partita FIBIS a GCS
// - chiamate_partite.gcs_match_id (TEXT) → idem
//
// Endpoint futuri (webhook da GCS):
// - POST /api/gcs/partita-iniziata
// - POST /api/gcs/punteggio
// - POST /api/gcs/partita-finita
// ============================================================

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
// GET /api/console/batterie/:idGara/:turno
// Restituisce le batterie del turno con giocatori, check-in, arbitro
// ============================================================
//
// TODO PRODUZIONE: Attualmente legge da `batterie_turno` popolata
// manualmente. In produzione, le batterie verranno lette dallo
// scraper (FIBIS Gare / GCS).
//
// ============================================================

export const getBatterieTurno = async (req, res) => {
  try {
    const { idGara, turno } = req.params;
    const { giorno } = req.query;  // ← NUOVO

        // Controllo giorno
    if (!giorno) {
      return res.status(400).json({
        success: false,
        error: 'Parametro giorno mancante',
        codice: 'MISSING_PARAMS'
      });
    }

    if (!idGara || !turno) {
      return res.status(400).json({
        success: false,
        error: 'Parametri mancanti',
        codice: 'MISSING_PARAMS'
      });
    }

    // 1. Recupera le batterie del turno
    const { data: batterie, error: batterieError } = await supabaseAdmin
      .from('batterie_turno')
      .select(`
        id,
        numero_batteria,
        fase,
        posizione,
        giorno,
        id_tesserato_1,
        id_tesserato_2,
        id_arbitro,
        stato,
        tesserato_1:tesserati!batterie_turno_id_tesserato_1_fkey (
          id, nome, cognome, matricola, categoria
        ),
        tesserato_2:tesserati!batterie_turno_id_tesserato_2_fkey (
          id, nome, cognome, matricola, categoria
        ),
        arbitro:manutentori!batterie_turno_id_arbitro_fkey (
          id, nome, cognome
        )
      `)
      .eq('id_gara', idGara)
      .eq('turno_value', turno)
      .eq('giorno', giorno)
      .order('numero_batteria', { ascending: true })
      .order('fase', { ascending: true })
      .order('posizione', { ascending: true });

    if (batterieError) {
      console.error('❌ Errore query batterie:', batterieError);
      throw batterieError;
    }

    if (!batterie || batterie.length === 0) {
      return res.json({
        success: true,
        id_gara: parseInt(idGara),
        turno_value: turno,
        totale_batterie: 0,
        batterie: []
      });
    }

    // 1b. Recupera l'ultima chiamata per ogni partita
    const idsPartite = batterie.map(b => b.id);
    const { data: chiamateRecenti } = await supabaseAdmin
      .from('chiamate_partite')
      .select('id, id_batteria_partita, numero_chiamata, data_chiamata, biliardo, esito, timer_minuti, vincitore_tavolino')
      .in('id_batteria_partita', idsPartite)
      .order('data_chiamata', { ascending: false });

    // Mappa: id_batteria_partita → chiamata più recente
    const chiamateMap = {};
    (chiamateRecenti || []).forEach(c => {
      if (!chiamateMap[c.id_batteria_partita]) {
        chiamateMap[c.id_batteria_partita] = c;
      }
    });

    // 2. Recupera tutti gli id_tesserato coinvolti
    const idTesserati = new Set();
    batterie.forEach(b => {
      if (b.id_tesserato_1) idTesserati.add(b.id_tesserato_1);
      if (b.id_tesserato_2) idTesserati.add(b.id_tesserato_2);
    });

    // 3. Recupera i check-in per gli id_tesserato (per GIORNO, non turno)
    // ============================================================
    // NOTA: il check-in è GIORNALIERO, quindi verifichiamo per `giorno`
    // (non per `turno_value`). Così un tesserato che ha fatto check-in
    // la mattina risulta presente anche nelle fasi serali.
    // ============================================================
    // Il giorno è già nella select principale (batterie[0].giorno)
    const giornoGara = batterie[0]?.giorno;

    let presenzeMap = {};
    if (giornoGara && idTesserati.size > 0) {
      const { data: presenze, error: presenzeError } = await supabaseAdmin
        .from('presenze_gare')
        .select('id_tesserato')
        .eq('id_gara', idGara)
        .eq('giorno', giornoGara)
        .in('id_tesserato', Array.from(idTesserati));

      if (presenzeError) {
        console.error('❌ Errore query presenze:', presenzeError);
        throw presenzeError;
      }

      (presenze || []).forEach(p => {
        presenzeMap[p.id_tesserato] = true;
      });
    }

    // 4. Raggruppa per numero_batteria
    const batterieMap = {};

    batterie.forEach(b => {
      const numBatt = b.numero_batteria;
      if (!batterieMap[numBatt]) {
        batterieMap[numBatt] = {
          numero_batteria: numBatt,
          partite: []
        };
      }

      // Prepara i giocatori con stato presente
      const giocatore1 = b.tesserato_1 ? {
        id: b.tesserato_1.id,
        nome: b.tesserato_1.nome,
        cognome: b.tesserato_1.cognome,
        matricola: b.tesserato_1.matricola,
        categoria: b.tesserato_1.categoria,
        presente: presenzeMap[b.tesserato_1.id] === true
      } : null;

      const giocatore2 = b.tesserato_2 ? {
        id: b.tesserato_2.id,
        nome: b.tesserato_2.nome,
        cognome: b.tesserato_2.cognome,
        matricola: b.tesserato_2.matricola,
        categoria: b.tesserato_2.categoria,
        presente: presenzeMap[b.tesserato_2.id] === true
      } : null;

      // Determina se la partita è "pronta"
      // (entrambi presenti e partita non ancora terminata)
     // const pronta = 
        //giocatore1?.presente === true && 
       // giocatore2?.presente === true &&
       // b.stato === 'attesa';

       // "Inizia" abilitato se la partita è stata chiamata

// (Luca decide se i giocatori sono al tavolo)
const pronta = b.stato === 'chiamata';
      const ultimaChiamata = chiamateMap[b.id];

      batterieMap[numBatt].partite.push({
        id: b.id,
        fase: b.fase,
        posizione: b.posizione,
        giocatore_1: giocatore1,
        giocatore_2: giocatore2,
        arbitro: b.arbitro ? {
          id: b.arbitro.id,
          nome: b.arbitro.nome,
          cognome: b.arbitro.cognome
        } : null,
        stato: b.stato,
        pronta: pronta,
        // NUOVO: info ultima chiamata
        ultima_chiamata: ultimaChiamata ? {
          id: ultimaChiamata.id,
          numero_chiamata: ultimaChiamata.numero_chiamata,
          data_chiamata: ultimaChiamata.data_chiamata,
          biliardo: ultimaChiamata.biliardo,
          esito: ultimaChiamata.esito,
          timer_minuti: ultimaChiamata.timer_minuti || 10,
          vincitore_tavolino: ultimaChiamata.vincitore_tavolino
        } : null
      });
    });

    // 5. Converti in array
    const batterieArray = Object.values(batterieMap).sort(
      (a, b) => a.numero_batteria - b.numero_batteria
    );

    res.json({
      success: true,
      id_gara: parseInt(idGara),
      turno_value: turno,
      giorno: giornoGara,
      totale_batterie: batterieArray.length,
      batterie: batterieArray
    });

  } catch (error) {
    console.error('❌ Errore getBatterieTurno:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante il recupero delle batterie',
      dettaglio: error.message
    });
  }
};
// ============================================================
// POST /api/console/chiamata
// Chiama una partita (crea chiamata + push)
// ============================================================
//
// NOTA: la chiamata è SEMPRE permessa, anche se uno dei due
// giocatori è assente. Luca deve poter chiamare la partita
// anche se manca un giocatore (che potrebbe arrivare in ritardo).
//
// ============================================================

export const chiamaPartita = async (req, res) => {
  try {
    const { id_batteria_partita, biliardo, timer_minuti, id_arbitro } = req.body;

    if (!id_batteria_partita) {
      return res.status(400).json({
        success: false,
        error: 'id_batteria_partita mancante',
        codice: 'MISSING_DATA'
      });
    }

    // 1. Recupera la partita
    const { data: partita, error: partitaError } = await supabaseAdmin
      .from('batterie_turno')
      .select(`
        id, id_gara, giorno, turno_value, numero_batteria, fase, posizione,
        id_tesserato_1, id_tesserato_2, id_arbitro, stato,
        tesserato_1:tesserati!batterie_turno_id_tesserato_1_fkey (
          id, nome, cognome, matricola
        ),
        tesserato_2:tesserati!batterie_turno_id_tesserato_2_fkey (
          id, nome, cognome, matricola
        ),
        arbitro:manutentori!batterie_turno_id_arbitro_fkey (
          id, nome, cognome
        )
      `)
      .eq('id', id_batteria_partita)
      .maybeSingle();

    if (partitaError) {
      console.error('❌ Errore query partita:', partitaError);
      throw partitaError;
    }

    if (!partita) {
      return res.status(404).json({
        success: false,
        error: 'Partita non trovata',
        codice: 'NOT_FOUND'
      });
    }

    // 2. Verifica stato
    if (partita.stato !== 'attesa') {
      return res.status(422).json({
        success: false,
        error: `Partita già in stato "${partita.stato}"`,
        codice: 'INVALID_STATE'
      });
    }
        // 2b. Verifica se l'arbitro è già impegnato in un'altra partita
    // (avviso, non blocco)
    const arbitroScelto = id_arbitro || partita.id_arbitro;
    let arbitroImpegnato = false;
    let partiteArbitro = [];

    if (arbitroScelto) {
      const { data: partiteAttive } = await supabaseAdmin
        .from('batterie_turno')
        .select('id, fase, posizione, stato')
        .eq('id_gara', partita.id_gara)
        .eq('giorno', partita.giorno)
        .eq('id_arbitro', arbitroScelto)
        .in('stato', ['chiamata', 'in_corso'])
        .neq('id', id_batteria_partita);  // escludi la partita corrente

      if (partiteAttive && partiteAttive.length > 0) {
        arbitroImpegnato = true;
        partiteArbitro = partiteAttive;
      }
    }

    // 3. Verifica check-in (info, NON bloccante)
    const { data: presenze } = await supabaseAdmin
      .from('presenze_gare')
      .select('id_tesserato')
      .eq('id_gara', partita.id_gara)
      .eq('giorno', partita.giorno)
      .in('id_tesserato', [partita.id_tesserato_1, partita.id_tesserato_2].filter(Boolean));

    const presenti = (presenze || []).map(p => p.id_tesserato);
    const tuttiPresenti = 
      partita.id_tesserato_1 && presenti.includes(partita.id_tesserato_1) &&
      partita.id_tesserato_2 && presenti.includes(partita.id_tesserato_2);

    // 4. Recupera id_operatore
    let id_operatore = null;
    if (req.userId) {
      const { data: manutentore } = await supabaseAdmin
        .from('manutentori')
        .select('id')
        .eq('user_id', req.userId)
        .maybeSingle();
      if (manutentore) id_operatore = manutentore.id;
    }

    // 5. Crea chiamata
    const { data: chiamata, error: chiamataError } = await supabaseAdmin
      .from('chiamate_partite')
      .insert({
        id_batteria_partita,
        id_gara: partita.id_gara,
        numero_chiamata: 1,
        id_operatore,
        id_arbitro: id_arbitro || partita.id_arbitro,
        biliardo: biliardo || null,
        timer_minuti: timer_minuti || 10,
        esito: 'in_attesa'
      })
      .select()
      .single();

    if (chiamataError) {
      console.error('❌ Errore insert chiamata:', chiamataError);
      throw chiamataError;
    }

    // 6. Aggiorna stato partita (e arbitro se cambiato)
    const updatePartita = { stato: 'chiamata' };
    if (id_arbitro && id_arbitro !== partita.id_arbitro) {
      updatePartita.id_arbitro = id_arbitro;
    }
    await supabaseAdmin
      .from('batterie_turno')
      .update(updatePartita)
      .eq('id', id_batteria_partita);

  // ============================================================
    // PUSH FCM — Invia notifica ai 2 giocatori + arbitro
    // ============================================================
    try {
      await inviaPushChiamata(
        partita.id_tesserato_1,
        partita.id_tesserato_2,
        id_arbitro || partita.id_arbitro,
        {
          id_batteria_partita,
          numero_chiamata: 1,
          fase: partita.fase,
          posizione: partita.posizione,
          biliardo: biliardo || null,
          timer_minuti: timer_minuti || 10
        }
      );
    } catch (pushError) {
      // Non bloccare la risposta principale se la push fallisce
      console.error('⚠️ Errore push (non bloccante):', pushError.message);
    }
    res.status(201).json({
      success: true,
      message: 'Partita chiamata',
      tutti_presenti: tuttiPresenti,
      arbitro_impegnato: arbitroImpegnato,
      partite_arbitro: partiteArbitro,
      chiamata: {
        id: chiamata.id,
        id_batteria_partita: chiamata.id_batteria_partita,
        numero_chiamata: chiamata.numero_chiamata,
        data_chiamata: chiamata.data_chiamata,
        biliardo: chiamata.biliardo,
        timer_minuti: chiamata.timer_minuti,
        arbitro: partita.arbitro,
        esito: chiamata.esito
      },
      partita: {
        id: partita.id,
        numero_batteria: partita.numero_batteria,
        fase: partita.fase,
        posizione: partita.posizione,
        giocatore_1: partita.tesserato_1,
        giocatore_2: partita.tesserato_2,
        stato: 'chiamata'
      }
    });

  } catch (error) {
    console.error('❌ Errore chiamaPartita:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante la chiamata',
      dettaglio: error.message
    });
  }
};

// ============================================================
// PUT /api/console/chiamata/:id
// Aggiorna stato chiamata (2ª chiamata, inizia, termina, tavolino)
// ============================================================
//
// Azioni supportate:
// - "seconda_chiamata": crea una nuova riga chiamata (numero_chiamata: 2)
// - "terza_chiamata": crea una nuova riga chiamata (numero_chiamata: 3)
// - "inizia": partita inizia (richiede entrambi presenti)
// - "termina": partita termina (con vincitore opzionale)
// - "vittoria_tavolino": assegna vittoria a tavolino
//
// TODO PRODUZIONE: le azioni "termina" e "vittoria_tavolino" saranno
// automatiche quando arriverà il risultato da GCS/FIBIS. Per ora
// sono manuali (Luca le esegue dalla Console).
//
// ============================================================

export const aggiornaChiamata = async (req, res) => {
  try {
    const { id } = req.params;
    const { azione, vincitore_tavolino, vincitore_id } = req.body;

    if (!azione) {
      return res.status(400).json({
        success: false,
        error: 'azione mancante',
        codice: 'MISSING_DATA'
      });
    }

    // 1. Recupera la chiamata
    const { data: chiamata, error: chiamataError } = await supabaseAdmin
      .from('chiamate_partite')
      .select(`
        id, id_batteria_partita, id_gara, numero_chiamata, id_arbitro, biliardo, esito, timer_minuti,
        batteria:batterie_turno!chiamate_partite_id_batteria_partita_fkey (
          id, id_tesserato_1, id_tesserato_2, id_arbitro, stato, giorno, turno_value, numero_batteria, posizione, fase
        )
      `)
      .eq('id', id)
      .maybeSingle();

    if (chiamataError) {
      console.error('❌ Errore query chiamata:', chiamataError);
      throw chiamataError;
    }

    if (!chiamata) {
      return res.status(404).json({
        success: false,
        error: 'Chiamata non trovata',
        codice: 'NOT_FOUND'
      });
    }

    const partita = chiamata.batteria;
    let id_operatore = null;
    if (req.userId) {
      const { data: manutentore } = await supabaseAdmin
        .from('manutentori')
        .select('id')
        .eq('user_id', req.userId)
        .maybeSingle();
      if (manutentore) id_operatore = manutentore.id;
    }

    // ============================================================
    // AZIONE: seconda_chiamata / terza_chiamata
    // ============================================================
    if (azione === 'seconda_chiamata' || azione === 'terza_chiamata') {
      const numeroChiamata = azione === 'seconda_chiamata' ? 2 : 3;

      const { data: nuovaChiamata, error: insertError } = await supabaseAdmin
        .from('chiamate_partite')
        .insert({
          id_batteria_partita: chiamata.id_batteria_partita,
          id_gara: chiamata.id_gara,
          numero_chiamata: numeroChiamata,
          id_operatore,
          id_arbitro: chiamata.id_arbitro,
          biliardo: chiamata.biliardo,
          timer_minuti: chiamata.timer_minuti || 10,   // ← COPIA timer
          esito: 'in_attesa'
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // ============================================================
      // PUSH FCM — Invia notifica anche per 2ª/3ª chiamata
      // ============================================================
      try {
        await inviaPushChiamata(
          partita.id_tesserato_1,
          partita.id_tesserato_2,
          chiamata.id_arbitro,
          {
            id_batteria_partita: chiamata.id_batteria_partita,
            numero_chiamata: numeroChiamata,
            fase: partita.fase,
            posizione: partita.posizione,
            biliardo: chiamata.biliardo,
            timer_minuti: chiamata.timer_minuti || 10
          }
        );
      } catch (pushError) {
        console.error('⚠️ Errore push 2ª/3ª chiamata (non bloccante):', pushError.message);
      }

      return res.json({
        success: true,
        message: `${numeroChiamata}ª chiamata effettuata`,
        chiamata: nuovaChiamata
      });
 } 
    // ============================================================
    // AZIONE: inizia
    // ============================================================
    if (azione === 'inizia') {
            // ============================================================
      // TODO PRODUZIONE: in produzione, l'inizio partita sarà
      // rilevato automaticamente da GCS (segnapunti digitale).
      // Il backend riceverà una notifica "partita iniziata" e
      // aggiornerà lo stato a 'in_corso'. Per ora: Luca clicca
      // "Inizia" dalla Console.
      // ============================================================
      // Verifica che entrambi i giocatori siano presenti
      const { data: presenze } = await supabaseAdmin
        .from('presenze_gare')
        .select('id_tesserato')
        .eq('id_gara', chiamata.id_gara)
        .eq('giorno', partita.giorno)
        .in('id_tesserato', [partita.id_tesserato_1, partita.id_tesserato_2].filter(Boolean));

      const presenti = (presenze || []).map(p => p.id_tesserato);
      const tuttiPresenti = 
        partita.id_tesserato_1 && presenti.includes(partita.id_tesserato_1) &&
        partita.id_tesserato_2 && presenti.includes(partita.id_tesserato_2);

      if (!tuttiPresenti) {
        return res.status(422).json({
          success: false,
          error: 'Entrambi i giocatori devono aver fatto check-in per iniziare',
          codice: 'NOT_ALL_PRESENT'
        });
      }

      await supabaseAdmin
        .from('chiamate_partite')
        .update({ esito: 'in_corso', data_inizio: new Date().toISOString() })
        .eq('id', id);

      await supabaseAdmin
        .from('batterie_turno')
        .update({ stato: 'in_corso' })
        .eq('id', chiamata.id_batteria_partita);

      return res.json({
        success: true,
        message: 'Partita iniziata',
        esito: 'in_corso'
      });
    }

    // ============================================================
    // AZIONE: termina (con vincitore opzionale)
    // ============================================================
    // TODO PRODUZIONE: questa azione sarà automatica quando arriverà
    // il risultato da GCS/FIBIS. Il backend riceverà una notifica
    // con il vincitore e aggiornerà automaticamente.
    //
    // Per ora: Luca clicca "Termina Partita" e seleziona il vincitore.
    // ============================================================
    if (azione === 'termina') {
            // ============================================================
      // TODO PRODUZIONE: in produzione, la fine partita e il vincitore
      // saranno rilevati automaticamente da GCS. Il backend riceverà
      // il risultato finale (punteggio + vincitore) e aggiornerà
      // automaticamente. Per ora: Luca clicca "Termina" e seleziona
      // il vincitore.
      // ============================================================
      // Verifica vincitore_id (opzionale)
      let vincitore = vincitore_id || null;

      if (vincitore) {
        if (vincitore !== partita.id_tesserato_1 && vincitore !== partita.id_tesserato_2) {
          return res.status(400).json({
            success: false,
            error: 'vincitore_id non è un giocatore di questa partita',
            codice: 'INVALID_WINNER'
          });
        }
      }

      await supabaseAdmin
        .from('chiamate_partite')
        .update({
          esito: 'terminata',
          data_fine: new Date().toISOString(),
          vincitore_tavolino: vincitore
        })
        .eq('id', id);

      await supabaseAdmin
        .from('batterie_turno')
        .update({ stato: 'terminata' })
        .eq('id', chiamata.id_batteria_partita);

      // ============================================================
      // POPOLAMENTO AUTOMATICO FASE SUCCESSIVA
      // ============================================================
      // Quando una partita termina con un vincitore, il vincitore
      // viene inserito nella fase successiva:
      // - Q1 → S1 posto 1
      // - Q2 → S1 posto 2
      // - Q3 → S2 posto 1
      // - Q4 → S2 posto 2
      // - S1 → Finale posto 1
      // - S2 → Finale posto 2
      //
      // TODO PRODUZIONE: questo popolamento sarà automatico anche
      // da GCS/FIBIS quando arriverà il risultato ufficiale.
      // Per ora: lo facciamo qui quando Luca clicca "Termina".
      // ============================================================
      if (vincitore) {
        await popolaFaseSuccessiva(
          chiamata.id_gara,
          partita.giorno,
          partita.turno_value,
          partita.numero_batteria,
          partita.fase,
          partita.posizione,
          vincitore
        );
      }

      return res.json({
        success: true,
        message: 'Partita terminata',
        esito: 'terminata',
        vincitore
      });
    }

    // ============================================================
    // AZIONE: vittoria_tavolino
    // ============================================================
    // TODO PRODUZIONE: anche questa azione sarà automatica se il
    // giocatore non si presenta. Per ora: Luca la esegue manualmente.
    // ============================================================
    if (azione === 'vittoria_tavolino') {
      if (!vincitore_tavolino) {
        return res.status(400).json({
          success: false,
          error: 'vincitore_tavolino mancante',
          codice: 'MISSING_DATA'
        });
      }

      if (vincitore_tavolino !== partita.id_tesserato_1 && 
          vincitore_tavolino !== partita.id_tesserato_2) {
        return res.status(400).json({
          success: false,
          error: 'vincitore_tavolino non è un giocatore di questa partita',
          codice: 'INVALID_WINNER'
        });
      }

      await supabaseAdmin
        .from('chiamate_partite')
        .update({
          esito: 'vittoria_tavolino',
          data_fine: new Date().toISOString(),
          vincitore_tavolino
        })
        .eq('id', id);

      await supabaseAdmin
        .from('batterie_turno')
        .update({ stato: 'vittoria_tavolino' })
        .eq('id', chiamata.id_batteria_partita);

      // ============================================================
      // POPOLAMENTO AUTOMATICO FASE SUCCESSIVA
      // ============================================================
      // TODO PRODUZIONE: questo popolamento sarà automatico anche
      // da GCS/FIBIS quando arriverà il risultato ufficiale.
      // ============================================================
      await popolaFaseSuccessiva(
        chiamata.id_gara,
        partita.giorno,
        partita.turno_value,
        partita.numero_batteria,
        partita.fase,
        partita.posizione,
        vincitore_tavolino
      );

      return res.json({
        success: true,
        message: 'Vittoria a tavolino assegnata',
        esito: 'vittoria_tavolino',
        vincitore_tavolino
      });
    }

    // Azione non riconosciuta
    return res.status(400).json({
      success: false,
      error: `Azione "${azione}" non riconosciuta`,
      codice: 'INVALID_ACTION'
    });

  } catch (error) {
    console.error('❌ Errore aggiornaChiamata:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante l\'aggiornamento',
      dettaglio: error.message
    });
  }
};
// ============================================================
// GET /api/console/arbitri-disponibili
// Lista di tutti i manutentori con ruolo 'arbitro'
// ============================================================

// ============================================================
// GET /api/console/arbitri-disponibili
// Lista arbitri disponibili (arbitri + direttori)
// ============================================================

export const getArbitriDisponibili = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .select('id, nome, cognome, email, telefono, ruolo, is_active')
      .in('ruolo', ['arbitro', 'direttore'])
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
// ============================================================
// FUNZIONE HELPER: popolaFaseSuccessiva
// Quando un quarto/semifinale termina, il vincitore va nella
// fase successiva (semifinale/finale).
// ============================================================
//
// Regole di popolamento:
// - Q1 (quarti, pos 1) → S1 (semifinale, pos 1) posto 1
// - Q2 (quarti, pos 2) → S1 (semifinale, pos 1) posto 2
// - Q3 (quarti, pos 3) → S2 (semifinale, pos 2) posto 1
// - Q4 (quarti, pos 4) → S2 (semifinale, pos 2) posto 2
// - S1 (semifinale, pos 1) → F1 (finale, pos 1) posto 1
// - S2 (semifinale, pos 2) → F1 (finale, pos 1) posto 2
//
// TODO PRODUZIONE: questa funzione sarà chiamata automaticamente
// quando lo scraper GCS/FIBIS rileva la fine di una partita.
// ============================================================

const popolaFaseSuccessiva = async (
  idGara,
  giorno,
  turnoValue,
  numeroBatteria,
  faseAttuale,
  posizioneAttuale,
  vincitoreId
) => {
  try {
    // Determina fase successiva
    let faseSuccessiva, posizioneFaseSuccessiva, campoDaPopolare;

    if (faseAttuale === 'quarti') {
      faseSuccessiva = 'semifinale';
      // Q1, Q2 → S1 (pos 1); Q3, Q4 → S2 (pos 2)
      posizioneFaseSuccessiva = posizioneAttuale <= 2 ? 1 : 2;
      // Q1, Q3 → posto 1 (id_tesserato_1); Q2, Q4 → posto 2 (id_tesserato_2)
      campoDaPopolare = (posizioneAttuale % 2 === 1) ? 'id_tesserato_1' : 'id_tesserato_2';
    } else if (faseAttuale === 'semifinale') {
      faseSuccessiva = 'finale';
      posizioneFaseSuccessiva = 1;
      // S1 → posto 1; S2 → posto 2
      campoDaPopolare = (posizioneAttuale === 1) ? 'id_tesserato_1' : 'id_tesserato_2';
    } else {
      // finale → nessuna fase successiva
      return;
    }

    // Aggiorna la fase successiva
    const { error: updateError } = await supabaseAdmin
      .from('batterie_turno')
      .update({ [campoDaPopolare]: vincitoreId })
      .eq('id_gara', idGara)
      .eq('giorno', giorno)
      .eq('turno_value', turnoValue)
      .eq('numero_batteria', numeroBatteria)
      .eq('fase', faseSuccessiva)
      .eq('posizione', posizioneFaseSuccessiva);

    if (updateError) {
      console.error('❌ Errore popolamento fase successiva:', updateError);
      throw updateError;
    }

    console.log(`✅ Vincitore ${vincitoreId} inserito in ${faseSuccessiva} pos ${posizioneFaseSuccessiva} (${campoDaPopolare})`);

  } catch (error) {
    console.error('❌ Errore popolaFaseSuccessiva:', error);
    // Non bloccare la risposta principale
  }
};
// ============================================================
// GET /api/console/arbitri-per-gara/:idGara
// Restituisce tutti gli arbitri assegnati alla gara con stato
// ============================================================
//
// Per ogni arbitro:
// - impegnato: true se ha partite 'in_corso'
// - partite_assegnate: lista partite 'chiamata' o 'in_corso'
//
// Luca vede TUTTI gli arbitri, con evidenziazione.
// ============================================================

export const getArbitriPerGara = async (req, res) => {
  try {
    const { idGara } = req.params;
    const { giorno } = req.query;  // ← NUOVO

    if (!idGara) {
      return res.status(400).json({
        success: false,
        error: 'id_gara mancante',
        codice: 'MISSING_PARAMS'
      });
    }

    // 1. Recupera arbitri assegnati alla gara
    const { data: arbitriGara, error: arbitriError } = await supabaseAdmin
      .from('arbitri_gara')
      .select(`
        id_manutentore,
        ruolo,
        in_pausa,
        pausa_inizio,
        pausa_fine,
        manutentori:id_manutentore (
          id, nome, cognome, email
        )
      `)
      .eq('id_gara', idGara)
      .eq('attivo', true);

    if (arbitriError) {
      console.error('❌ Errore query arbitri gara:', arbitriError);
      throw arbitriError;
    }

    // 2. Recupera partite chiamate/in_corso della gara
    let query = supabaseAdmin
      .from('batterie_turno')
      .select('id, numero_batteria, fase, posizione, id_arbitro, stato')
      .eq('id_gara', idGara)
      .in('stato', ['chiamata', 'in_corso'])
      .not('id_arbitro', 'is', null);

    // Filtra per giorno (se passato)
    if (giorno) {
      query = query.eq('giorno', giorno);
    }

    const { data: partite, error: partiteError } = await query;

    if (partiteError) {
      console.error('❌ Errore query partite:', partiteError);
      throw partiteError;
    }

    // 3. Mappa: id_arbitro → lista partite
    const partitePerArbitro = {};
    (partite || []).forEach(p => {
      if (!partitePerArbitro[p.id_arbitro]) {
        partitePerArbitro[p.id_arbitro] = [];
      }
      partitePerArbitro[p.id_arbitro].push({
        id: p.id,
        numero_batteria: p.numero_batteria,
        fase: p.fase,
        posizione: p.posizione,
        stato: p.stato
      });
    });

    // 4. Combina
    const now = new Date();

    const arbitri = (arbitriGara || []).map(a => {
      const partiteAssegnate = partitePerArbitro[a.id_manutentore] || [];
      const inCorso = partiteAssegnate.filter(p => p.stato === 'in_corso');
      const chiamate = partiteAssegnate.filter(p => p.stato === 'chiamata');

      // Verifica se la pausa è scaduta
      let inPausa = a.in_pausa === true;
      let pausaFine = a.pausa_fine;
      
      if (inPausa && pausaFine) {
        const pausaFineDate = new Date(pausaFine);
        if (pausaFineDate <= now) {
          // Pausa scaduta → l'arbitro è di nuovo disponibile
          inPausa = false;
        }
      }

      return {
        id: a.id_manutentore,
        nome: a.manutentori?.nome || '',
        cognome: a.manutentori?.cognome || '',
        email: a.manutentori?.email || '',
        ruolo: a.ruolo,
        impegnato: inCorso.length > 0,
        in_pausa: inPausa,
        pausa_inizio: a.pausa_inizio,
        pausa_fine: a.pausa_fine,
        partite_assegnate: partiteAssegnate,
        ha_partite_chiamate: chiamate.length > 0
      };
    });

    res.json({
      success: true,
      id_gara: parseInt(idGara),
      totale: arbitri.length,
      arbitri
    });

  } catch (error) {
    console.error('❌ Errore getArbitriPerGara:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante il recupero degli arbitri',
      dettaglio: error.message
    });
  }
};
// ============================================================
// POST /api/console/arbitro/:idManutentore/pausa
// Avvia una pausa per un arbitro
// Body: { id_gara, durata_minuti }
// ============================================================
export const avviaPausa = async (req, res) => {
  try {
    const { idManutentore } = req.params;
    const { id_gara, durata_minuti } = req.body;

    if (!id_gara || !durata_minuti) {
      return res.status(400).json({
        success: false,
        error: 'id_gara e durata_minuti obbligatori',
        codice: 'MISSING_DATA'
      });
    }

    // Verifica che la durata sia tra 15 e 180 minuti
    if (durata_minuti < 15 || durata_minuti > 180) {
      return res.status(400).json({
        success: false,
        error: 'La durata deve essere tra 15 e 180 minuti',
        codice: 'INVALID_DURATION'
      });
    }

    // Calcola pausa_inizio e pausa_fine
    const pausaInizio = new Date();
    const pausaFine = new Date(pausaInizio.getTime() + durata_minuti * 60 * 1000);

    const { data, error } = await supabaseAdmin
      .from('arbitri_gara')
      .update({
        in_pausa: true,
        pausa_inizio: pausaInizio.toISOString(),
        pausa_fine: pausaFine.toISOString()
      })
      .eq('id_gara', id_gara)
      .eq('id_manutentore', idManutentore)
      .eq('attivo', true)
      .select()
      .single();

    if (error) {
      console.error('❌ Errore avvio pausa:', error);
      throw error;
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        error: 'Arbitro non trovato o non attivo',
        codice: 'NOT_FOUND'
      });
    }

    res.json({
      success: true,
      message: 'Pausa avviata',
      pausa: {
        id_manutentore: parseInt(idManutentore),
        in_pausa: data.in_pausa,
        pausa_inizio: data.pausa_inizio,
        pausa_fine: data.pausa_fine,
        durata_minuti
      }
    });

  } catch (error) {
    console.error('❌ Errore avviaPausa:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante l\'avvio della pausa',
      dettaglio: error.message
    });
  }
};

// ============================================================
// PUT /api/console/arbitro/:idManutentore/pausa/fine
// Termina una pausa manualmente
// Body: { id_gara }
// ============================================================
export const terminaPausa = async (req, res) => {
  try {
    const { idManutentore } = req.params;
    const { id_gara } = req.body;

    if (!id_gara) {
      return res.status(400).json({
        success: false,
        error: 'id_gara obbligatorio',
        codice: 'MISSING_DATA'
      });
    }

    const { data, error } = await supabaseAdmin
      .from('arbitri_gara')
      .update({
        in_pausa: false,
        pausa_inizio: null,
        pausa_fine: null
      })
      .eq('id_gara', id_gara)
      .eq('id_manutentore', idManutentore)
      .eq('attivo', true)
      .select()
      .single();

    if (error) {
      console.error('❌ Errore termine pausa:', error);
      throw error;
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        error: 'Arbitro non trovato o non attivo',
        codice: 'NOT_FOUND'
      });
    }

    res.json({
      success: true,
      message: 'Pausa terminata',
      arbitro: {
        id_manutentore: parseInt(idManutentore),
        in_pausa: false
      }
    });

  } catch (error) {
    console.error('❌ Errore terminaPausa:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante la fine della pausa',
      dettaglio: error.message
    });
  }
};