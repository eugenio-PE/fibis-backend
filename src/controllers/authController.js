import { supabase, supabaseAdmin } from '../config/supabase.js';
import ManutentoreModel from '../models/Manutentore.js';
import { generateSecret, getOTPUri, generateQRCodeUrl, verifyOTP } from '../utils/otp.js';
import * as OTPAuth from 'otpauth';

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    // Recupera i dati del manutentore
    const manutentore = await ManutentoreModel.findByEmail(email);

    res.json({
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        id: manutentore.id,
        nome: manutentore.nome,
        cognome: manutentore.cognome,
        email: manutentore.email,
        ruolo: manutentore.ruolo
      }
    });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
};

export const setupOTP = async (req, res) => {
  try {
    const secret = generateSecret();
    const otpUri = getOTPUri(secret, req.user.email);
    const qrCodeUrl = generateQRCodeUrl(otpUri);

    // Salva il secret nel database
    const manutentore = await ManutentoreModel.findByEmail(req.user.email);
    await ManutentoreModel.updateOTPSecret(manutentore.id, secret);

    res.json({
      secret,
      otp_uri: otpUri,
      qrcode_url: qrCodeUrl,
      message: 'Scansiona il QR Code con Google Authenticator'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const verifyOTPCode = async (req, res) => {
  try {
    const { code } = req.body;
    const manutentore = await ManutentoreModel.findByEmail(req.user.email);

    if (!manutentore.otp_secret) {
      return res.status(403).json({ error: 'OTP non configurato' });
    }

    const isValid = verifyOTP(manutentore.otp_secret, code);
    res.json({ valid: isValid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getMe = async (req, res) => {
  try {
    const manutentore = await ManutentoreModel.findByEmail(req.user.email);
    res.json(manutentore);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
// Verifica OTP
export const verificaOTP = async (req, res) => {
  try {
    const { email, otp_code } = req.body;
    
    // Recupera il secret del manutentore
    const { data: manutentore, error } = await supabase
      .from('manutentori')
      .select('otp_secret')
      .eq('email', email)
      .single();
      
    if (error || !manutentore || !manutentore.otp_secret) {
      return res.status(404).json({ error: 'OTP non configurato per questo utente' });
    }
    
    // Verifica l'OTP (usando la libreria otpauth)
    const totp = new OTPAuth.TOTP({
      secret: manutentore.otp_secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30
    });
    
    const isValid = totp.verify({ token: otp_code, window: 1 });
    
    if (isValid) {
      res.json({ valid: true });
    } else {
      res.status(401).json({ valid: false, error: 'OTP non valido' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};