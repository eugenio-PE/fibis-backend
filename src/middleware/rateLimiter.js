/**
 * Rate Limiting Middleware - FIBiS Backend
 * 
 * Protegge il backend da:
 * - Brute force login
 * - DDoS / flood
 * - Abusi API
 * - Scraping massivo
 * 
 * Include:
 * - Whitelist IP (admin, localhost)
 * - Integrazione Sentry per tracciare abusi
 * - Skip automatico in development
 */

import rateLimit from 'express-rate-limit';
import * as Sentry from '@sentry/node';

// ============================================================
// CONFIGURAZIONE GENERALE
// ============================================================

const standardHeaders = true;
const legacyHeaders = false;

/**
 * Skip in development (non blocca i test locali)
 */
const skipInDev = () => {
  return process.env.NODE_ENV !== 'production';
};

/**
 * Whitelist IP - non applicano rate limit
 * Aggiungi qui gli IP admin/aziendali quando li conosci
 */
const WHITELIST_IPS = [
  '127.0.0.1',
  '::1',
  // '1.2.3.4',  // Aggiungi IP admin quando serve
];

/**
 * Check whitelist
 */
const isWhitelisted = (req) => {
  const ip = req.ip || req.connection?.remoteAddress;
  return WHITELIST_IPS.includes(ip);
};

/**
 * Handler riutilizzabile: logga su console + Sentry
 */
const makeHandler = (tipoLimite, messaggio) => {
  return (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress;
    const url = req.originalUrl;
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Log su console
    console.warn(`⚠️ [RATE LIMIT - ${tipoLimite}] IP=${ip} URL=${url}`);

    // Log su Sentry (warning, non error - non sveglia nessuno)
    Sentry.captureMessage(`Rate limit exceeded: ${tipoLimite}`, {
      level: 'warning',
      tags: {
        type: 'rate_limit',
        limite: tipoLimite,
        endpoint: url,
      },
      extra: {
        ip,
        user_agent: userAgent,
        timestamp: new Date().toISOString(),
      },
    });

    res.status(429).json({
      error: messaggio,
      code: `RATE_LIMIT_${tipoLimite.toUpperCase()}`,
      retry_after: '15 minuti',
    });
  };
};

// ============================================================
// 1. GLOBAL LIMIT — tutte le richieste /api/*
// ============================================================
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minuti
  max: 500,                   // 500 richieste per IP
  standardHeaders,
  legacyHeaders,
  skip: (req) => {
    // Skip in development
    if (skipInDev()) return true;
    // Skip whitelist
    if (isWhitelisted(req)) return true;
    // Skip health check (UptimeRobot)
    if (req.path === '/api/health' || req.path === '/health') return true;
    return false;
  },
  handler: makeHandler('global', 'Troppe richieste. Riprova tra 15 minuti.'),
});

// ============================================================
// 2. LOGIN LIMIT — protezione brute force
// ============================================================
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minuti
  max: 10,                    // 10 tentativi per IP
  standardHeaders,
  legacyHeaders,
  skipSuccessfulRequests: true,  // Non conta i login riusciti
  skip: (req) => skipInDev() || isWhitelisted(req),
  handler: makeHandler('login', 'Troppi tentativi di login. Riprova tra 15 minuti.'),
});

// ============================================================
// 3. UPLOAD LIMIT — protezione upload massivi
// ============================================================
export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,                    // 50 upload per IP in 15 min
  standardHeaders,
  legacyHeaders,
  skip: (req) => skipInDev() || isWhitelisted(req),
  handler: makeHandler('upload', 'Troppi upload. Riprova più tardi.'),
});

// ============================================================
// 4. HEAVY LIMIT — endpoint pesanti (PDF, QR, generazioni)
// ============================================================
export const heavyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,                   // 100 operazioni pesanti per IP
  standardHeaders,
  legacyHeaders,
  skip: (req) => skipInDev() || isWhitelisted(req),
  handler: makeHandler('heavy', 'Troppe operazioni pesanti. Riprova più tardi.'),
});

// ============================================================
// 5. REGISTRAZIONE LIMIT — anti-spam registrazioni
// ============================================================
export const registrazioneLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 ora
  max: 3,                     // 3 registrazioni per IP/ora
  standardHeaders,
  legacyHeaders,
  skip: (req) => skipInDev() || isWhitelisted(req),
  handler: makeHandler('registrazione', 'Troppi tentativi di registrazione. Riprova più tardi.'),
});

// ============================================================
// 6. API PUBBLICHE — endpoint pubblici (QR page)
// ============================================================
export const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,                   // 200 richieste per IP (più permissivo, endpoint pubblico)
  standardHeaders,
  legacyHeaders,
  skip: (req) => skipInDev() || isWhitelisted(req),
  handler: makeHandler('public', 'Troppe richieste. Riprova più tardi.'),
});