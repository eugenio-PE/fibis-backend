import * as OTPAuth from 'otpauth';

export function generateSecret() {
  // Genera una chiave segreta in formato Base32
  const totp = new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
  return totp.secret.base32;
}

export function getOTPUri(secret, email, issuer = 'FIBiS') {
  const totp = new OTPAuth.TOTP({
    issuer: issuer,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: secret
  });
  return totp.toString();
}

export function verifyOTP(secret, token) {
  const totp = new OTPAuth.TOTP({
    secret: secret,
    algorithm: 'SHA1',
    digits: 6,
    period: 30
  });
  
  // Verifica con finestra di tolleranza di 1 step (30 secondi)
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}

export function generateQRCodeUrl(otpUri) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(otpUri)}`;
}