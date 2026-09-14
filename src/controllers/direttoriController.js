import { supabaseAdmin } from '../config/supabase.js';

// ============================================================
// GET /api/direttori/mie-gare
// Restituisce le gare dove l'utente è arbitro o direttore
// ============================================================

export const getMieGare = async (req, res) => {
  try {
    // 1. Trova il manutentore dall'user_id
    const { data: manutentore, error: manutentoreError } = await supabaseAdmin
      .from('manutentori')
      .select('id, nome, cognome, ruolo')
      .eq('user_id', req.userId)
      .maybeSingle();

    if (manutentoreError) {
      console.error('❌ Errore query manutentore:', manutentoreError);
      throw manutentoreError;
    }

    if (!manutentore) {
      return res.status(404).json({
        success: false,
        error: 'Manutentore non trovato',
        codice: 'NOT_FOUND'
      });
    }

    // 2. Gare dove è arbitro (da arbitri_gara)
    const { data: gareArbitro, error: arbitroError } = await supabaseAdmin
      .from('arbitri_gara')
      .select(`
        id_gara,
        data_assegnazione,
        gare:id_gara (
          id, nome, tipologia, data_gara, regione, categoria, stato
        )
      `)
      .eq('id_manutentore', manutentore.id)
      .eq('attivo', true);

    if (arbitroError) {
      console.error('❌ Errore query gare arbitro:', arbitroError);
      throw arbitroError;
    }

    // 3. Gare dove è direttore (da gare.id_direttore)
    const { data: gareDirettore, error: direttoreError } = await supabaseAdmin
      .from('gare')
      .select('id, nome, tipologia, data_gara, regione, categoria, stato')
      .eq('id_direttore', manutentore.id);

    if (direttoreError) {
      console.error('❌ Errore query gare direttore:', direttoreError);
      throw direttoreError;
    }

    // 4. Combina i contesti
    const contesti = [];

    (gareArbitro || []).forEach(a => {
      if (a.gare) {
        contesti.push({
          tipo: 'arbitro',
          id_gara: a.gare.id,
          nome_gara: a.gare.nome,
          tipologia: a.gare.tipologia,
          data_gara: a.gare.data_gara,
          regione: a.gare.regione,
          categoria: a.gare.categoria,
          stato: a.gare.stato,
          data_assegnazione: a.data_assegnazione
        });
      }
    });

    (gareDirettore || []).forEach(g => {
      contesti.push({
        tipo: 'direttore',
        id_gara: g.id,
        nome_gara: g.nome,
        tipologia: g.tipologia,
        data_gara: g.data_gara,
        regione: g.regione,
        categoria: g.categoria,
        stato: g.stato,
        data_assegnazione: null
      });
    });

    // Ordina per data_gara discendente
    contesti.sort((a, b) => {
      if (!a.data_gara) return 1;
      if (!b.data_gara) return -1;
      return b.data_gara.localeCompare(a.data_gara);
    });

    res.json({
      success: true,
      manutentore: {
        id: manutentore.id,
        nome: manutentore.nome,
        cognome: manutentore.cognome,
        ruolo: manutentore.ruolo
      },
      totale: contesti.length,
      contesti
    });

  } catch (error) {
    console.error('❌ Errore getMieGare:', error);
    res.status(500).json({
      success: false,
      error: 'Errore durante il recupero delle gare',
      dettaglio: error.message
    });
  }
};