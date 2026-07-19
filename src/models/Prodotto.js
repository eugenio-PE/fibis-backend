import { supabase } from '../config/supabase.js';

class ProdottoModel {
  static async getAll(categoria = null) {
    let query = supabase
      .from('prodotti_omologati')
      .select('*')
      .eq('attivo', true);
    
    if (categoria) {
      query = query.eq('categoria', categoria);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  static async getById(id) {
    const { data, error } = await supabase
      .from('prodotti_omologati')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  }

  static async verificalotto(idProdotto, numeroLotto) {
    const { data, error } = await supabase
      .from('lotti_produzione')
      .select('*')
      .eq('id_prodotto', idProdotto)
      .eq('numero_lotto', numeroLotto)
      .eq('attivo', true)
      .single();
    
    if (error && error.code === 'PGRST116') {
      return { valido: false, motivo: 'Lotto non presente nell\'elenco ufficiale' };
    }
    if (error) throw error;
    return { valido: true, lotto: data };
  }

  static async create(prodottoData) {
    const { data, error } = await supabase
      .from('prodotti_omologati')
      .insert(prodottoData)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  static async update(id, updates) {
    const { data, error } = await supabase
      .from('prodotti_omologati')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
}

export default ProdottoModel;