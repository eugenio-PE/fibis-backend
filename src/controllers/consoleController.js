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
      const pronta = 
        giocatore1?.presente === true && 
        giocatore2?.presente === true &&
        b.stato === 'attesa';

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
        pronta: pronta
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
    const { id_batteria_partita, biliardo } = req.body;

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
        id_arbitro: partita.id_arbitro,
        biliardo: biliardo || null,
        esito: 'in_attesa'
      })
      .select()
      .single();

    if (chiamataError) {
      console.error('❌ Errore insert chiamata:', chiamataError);
      throw chiamataError;
    }

    // 6. Aggiorna stato partita
    await supabaseAdmin
      .from('batterie_turno')
      .update({ stato: 'chiamata' })
      .eq('id', id_batteria_partita);

    // ============================================================
    // TODO PRODUZIONE: Inviare push FCM a:
    // - tesserato_1 (se ha device_token)
    // - tesserato_2 (se ha device_token)
    // - arbitro (se ha device_token)
    // Per ora: stub
    // ============================================================
    // await inviaPushChiamata(partita, chiamata);

    res.status(201).json({
      success: true,
      message: 'Partita chiamata',
      tutti_presenti: tuttiPresenti,
      chiamata: {
        id: chiamata.id,
        id_batteria_partita: chiamata.id_batteria_partita,
        numero_chiamata: chiamata.numero_chiamata,
        data_chiamata: chiamata.data_chiamata,
        biliardo: chiamata.biliardo,
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
// Aggiorna stato chiamata (2ª chiamata, inizio, fine, tavolino)
// ============================================================
//
// Azioni supportate:
// - "seconda_chiamata": crea una nuova riga chiamata (numero_chiamata++)
// - "inizia": partita inizia (richiede entrambi presenti)
// - "termina": partita termina
// - "vittoria_tavolino": assegna vittoria a tavolino
//
// ============================================================

export const aggiornaChiamata = async (req, res) => {
  try {
    const { id } = req.params;
    const { azione, vincitore_tavolino } = req.body;

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
        id, id_batteria_partita, id_gara, numero_chiamata, id_arbitro, biliardo, esito,
        batteria:batterie_turno!chiamate_partite_id_batteria_partita_fkey (
          id, id_tesserato_1, id_tesserato_2, id_arbitro, stato, giorno, turno_value
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
    // AZIONE: seconda_chiamata
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
          esito: 'in_attesa'
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // TODO PRODUZIONE: invia push anche per la 2ª/3ª chiamata

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

      // Aggiorna chiamata
      await supabaseAdmin
        .from('chiamate_partite')
        .update({ esito: 'in_corso', data_inizio: new Date().toISOString() })
        .eq('id', id);

      // Aggiorna partita
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
    // AZIONE: termina
    // ============================================================
    if (azione === 'termina') {
      await supabaseAdmin
        .from('chiamate_partite')
        .update({ esito: 'terminata', data_fine: new Date().toISOString() })
        .eq('id', id);

      await supabaseAdmin
        .from('batterie_turno')
        .update({ stato: 'terminata' })
        .eq('id', chiamata.id_batteria_partita);

      return res.json({
        success: true,
        message: 'Partita terminata',
        esito: 'terminata'
      });
    }

    // ============================================================
    // AZIONE: vittoria_tavolino
    // ============================================================
    if (azione === 'vittoria_tavolino') {
      if (!vincitore_tavolino) {
        return res.status(400).json({
          success: false,
          error: 'vincitore_tavolino mancante',
          codice: 'MISSING_DATA'
        });
      }

      // Verifica che il vincitore sia uno dei due giocatori
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

      // TODO PRODUZIONE: aggiornare il tabellone (semifinali, finale)
      // con il vincitore a tavolino

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