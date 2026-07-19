import { supabase, supabaseAdmin } from '../config/supabase.js';

class ManutentoreModel {
  static async findByEmail(email) {
    const { data, error } = await supabase
      .from('manutentori')
      .select('*')
      .eq('email', email)
      .single();
    
    if (error) throw error;
    return data;
  }

  static async findById(id) {
    const { data, error } = await supabase
      .from('manutentori')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  }

  static async create(userId, manutentoreData) {
    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .insert({
        user_id: userId,
        ...manutentoreData
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  static async updateOTPSecret(id, secret) {
    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .update({ otp_secret: secret })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  static async update(id, updates) {
    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
}

export default ManutentoreModel;