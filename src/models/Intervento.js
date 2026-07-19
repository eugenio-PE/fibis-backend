import { supabase, supabaseAdmin } from '../config/supabase.js';

class InterventoModel {
  static async create(interventoData) {
    const { data, error } = await supabase
      .from('interventi')
      .insert([interventoData])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  static async createBatch(interventiData) {
    const { data, error } = await supabase
      .from('interventi')
      .insert(interventiData)
      .select();
    
    if (error) throw error;
    return data;
  }

  static async getById(id) {
    const { data, error } = await supabase
      .from('interventi')
      .select(`
        *,
        biliardi (*),
        manutentori (nome, cognome, email),
        prodotti_omologati (marca, modello, categoria)
      `)
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  }

  static async getByASD(asdId, limit = 10) {
    const { data, error } = await supabase
      .from('interventi')
      .select(`
        *,
        biliardi!inner (id, nome_tavolo, id_asd),
        manutentori (nome, cognome),
        prodotti_omologati (marca, modello)
      `)
      .eq('biliardi.id_asd', asdId)
      .order('data_intervento', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    return data;
  }

  static async updateStato(id, stato, validatoDa = null) {
    const updates = { stato };
    if (validatoDa) {
      updates.validato_da = validatoDa;
      updates.data_validazione = new Date().toISOString();
    }
    
    const { data, error } = await supabaseAdmin
      .from('interventi')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  static async getDaControllare(mese = null) {
    let query = supabase
      .from('interventi')
      .select(`
        *,
        biliardi (id, nome_tavolo, asd_centri (id, nome, qr_code)),
        manutentori (id, nome, cognome, email)
      `)
      .in('stato', ['registrato', 'validato']);
    
    if (mese) {
      const startDate = new Date(mese.getFullYear(), mese.getMonth(), 1);
      const endDate = new Date(mese.getFullYear(), mese.getMonth() + 1, 0);
      query = query
        .gte('data_intervento', startDate.toISOString())
        .lte('data_intervento', endDate.toISOString());
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
}

export default InterventoModel;