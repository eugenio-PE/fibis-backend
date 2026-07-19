import { verifyOTP } from '../utils/otp.js';
import { supabase } from '../config/supabase.js';

export async function requireOTP(req, res, next) {
  try {
    const { otp_code } = req.body;
    if (!otp_code) {
      return res.status(400).json({ error: 'Codice OTP richiesto' });
    }

    // Recupera il secret del manutentore
    const { data: manutentore, error } = await supabase
      .from('manutentori')
      .select('otp_secret')
      .eq('user_id', req.userId)
      .single();

    if (error || !manutentore || !manutentore.otp_secret) {
      return res.status(403).json({ error: 'OTP non configurato' });
    }

    const isValid = verifyOTP(manutentore.otp_secret, otp_code);
    if (!isValid) {
      return res.status(401).json({ error: 'Codice OTP non valido' });
    }

    next();
  } catch (error) {
    return res.status(500).json({ error: 'Errore verifica OTP' });
  }
}