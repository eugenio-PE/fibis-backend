import ASDModel from '../models/ASD.js';
import ProdottoModel from '../models/Prodotto.js';
import InterventoModel from '../models/Intervento.js';
import { supabase } from '../config/supabase.js';

export const scanQR = async (req, res) => {
  try {
    const { qrCode } = req.params;
    const asd = await ASDModel.findByQRCode(qrCode);
    const biliardi = await ASDModel.getBiliardi(asd.id);

    res.json({
      ...asd,
      biliardi
    });
  } catch (error) {
    res.status(404).json({ error: 'ASD non trovata' });
  }
};

export const getProdotti = async (req, res) => {
  try {
    const { categoria } = req.query;
    const prodotti = await ProdottoModel.getAll(categoria);
    res.json(prodotti);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const verificaLotto = async (req, res) => {
  try {
    const { id_prodotto, numero_lotto } = req.body;
    const result = await ProdottoModel.verificalotto(id_prodotto, numero_lotto);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const registraIntervento = async (req, res) => {
  try {
    const { 
      id_asd,
      id_biliardi,
      tipo_intervento,
      id_prodotto,
      numero_lotto,
      foto_confezione,
      foto_marchio,
      foto_biliardo,
      note,
      latitudine,
      longitudine 
    } = req.body;

    // Verifica che i biliardi appartengano all'ASD
    const { data: biliardi, error: biliardiError } = await supabase
      .from('biliardi')
      .select('id')
      .in('id', id_biliardi)
      .eq('id_asd', id_asd)
      .eq('attivo', true);

    if (biliardiError || biliardi.length !== id_biliardi.length) {
      return res.status(400).json({ error: 'Uno o più biliardi non validi' });
    }

    // Recupera l'ID del manutentore
    const { data: manutentore, error: manutentoreError } = await supabase
      .from('manutentori')
      .select('id')
      .eq('user_id', req.userId)
      .single();

    if (manutentoreError) throw manutentoreError;

    // Costruisci la geolocalizzazione
    let geolocalizzazione = null;
    if (latitudine && longitudine) {
      geolocalizzazione = `POINT(${longitudine} ${latitudine})`;
    }

    // Prepara i dati per ogni intervento
    const interventiData = id_biliardi.map(id => ({
      id_biliardo: id,
      id_manutentore: manutentore.id,
      tipo_intervento,
      id_prodotto_usato: id_prodotto || null,
      numero_lotto_dichiarato: numero_lotto || '',
      foto_confezione: foto_confezione || '',
      foto_marchio: foto_marchio || '',
      foto_biliardo: foto_biliardo || '',
      note: note || '',
      geolocalizzazione,
      ip_richiedente: req.ip
    }));

    // Registra tutti gli interventi
    const interventi = await InterventoModel.createBatch(interventiData);

    res.status(201).json({
      success: true,
      message: `Registrati ${interventi.length} interventi`,
      interventi
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getStorico = async (req, res) => {
  try {
    const { asdId } = req.params;
    const interventi = await InterventoModel.getByASD(asdId);
    res.json(interventi);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};