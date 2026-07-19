import InterventoModel from '../models/Intervento.js';
import { supabaseAdmin } from '../config/supabase.js';

export const generaControlli = async (req, res) => {
  try {
    const { mese, percentuale = 10 } = req.body;
    const meseDate = mese ? new Date(mese) : new Date();
    
    const interventi = await InterventoModel.getDaControllare(meseDate);
    
    if (interventi.length === 0) {
      return res.json({ message: 'Nessun intervento da controllare' });
    }

    const numControlli = Math.max(1, Math.floor(interventi.length * percentuale / 100));
    const selezionati = interventi
      .sort(() => Math.random() - 0.5)
      .slice(0, numControlli);

    const controlliData = selezionati.map(intervento => ({
      id_intervento: intervento.id,
      data_sorteggio: new Date().toISOString().split('T')[0],
      esito: 'in_attesa'
    }));

    const { data: controlli, error } = await supabaseAdmin
      .from('controlli_sorpresa')
      .insert(controlliData)
      .select();

    if (error) throw error;

    res.json({
      message: `Generati ${controlli.length} controlli su ${interventi.length} interventi`,
      controlli
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const aggiornaEsito = async (req, res) => {
  try {
    const { id } = req.params;
    const { esito, note, foto_verifica, ispettore_nome } = req.body;

    const { data, error } = await supabaseAdmin
      .from('controlli_sorpresa')
      .update({
        esito,
        note,
        foto_verifica,
        ispettore_nome,
        data_verifica: new Date().toISOString().split('T')[0]
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    if (esito === 'non_conforme') {
      await supabaseAdmin
        .from('interventi')
        .update({ stato: 'contestato' })
        .eq('id', data.id_intervento);
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ===== NUOVA FUNZIONE: IMPORTAZIONE MANUTENTORI DA CSV =====
export const importaManutentori = async (req, res) => {
  try {
    const { manutentori } = req.body;
    
    if (!manutentori || !Array.isArray(manutentori) || manutentori.length === 0) {
      return res.status(400).json({ error: 'Nessun dato valido da importare' });
    }

    let importati = 0;
    let errori = 0;

    for (const m of manutentori) {
      try {
        // Verifica che i campi obbligatori ci siano
        if (!m.nome || !m.cognome || !m.email || !m.data_scadenza_albo) {
          errori++;
          continue;
        }

        // Crea l'utente su Supabase Auth
        const { data: authData, error: authError } = await supabaseAdmin.auth.signUp({
          email: m.email,
          password: m.password || 'PasswordTemporanea123!',
        });

        if (authError) {
          errori++;
          continue;
        }

        // Inserisci il manutentore nella tabella
        const { error: insertError } = await supabaseAdmin
          .from('manutentori')
          .insert({
            user_id: authData.user.id,
            nome: m.nome,
            cognome: m.cognome,
            email: m.email,
            telefono: m.telefono || '',
            azienda: m.azienda || '',
            data_scadenza_albo: m.data_scadenza_albo,
            ruolo: m.ruolo || 'manutentore',
            is_active: true,
          });

        if (insertError) {
          errori++;
          continue;
        }

        importati++;
      } catch (err) {
        errori++;
      }
    }

    res.json({
      importati,
      errori,
      totale: manutentori.length,
      message: `Importati ${importati} manutentori, ${errori} errori`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};