import { supabase } from '../config/supabase.js';

class ASDModel {
  static async findByQRCode(qrCode) {
    const { data, error } = await supabase
      .from('asd_centri')
      .select(`
        *,
        biliardi (*)
      `)
      .eq('qr_code', qrCode)
      .eq('attivo', true)
      .single();
    
    if (error) throw error;
    return data;
  }

  static async getBiliardi(asdId) {
    const { data, error } = await supabase
      .from('biliardi')
      .select('*')
      .eq('id_asd', asdId)
      .eq('attivo', true);
    
    if (error) throw error;
    return data;
  }

  static async getAll() {
    const { data, error } = await supabase
      .from('asd_centri')
      .select('*')
      .eq('attivo', true);
    
    if (error) throw error;
    return data;
  }

  static async create(asdData) {
    const { data, error } = await supabase
      .from('asd_centri')
      .insert(asdData)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  static async update(id, updates) {
    const { data, error } = await supabase
      .from('asd_centri')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
}

export default ASDModel;