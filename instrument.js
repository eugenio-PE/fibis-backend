/**
 * Sentry Instrumentation
 * 
 * IMPORTANTE: Questo file DEVE essere importato come PRIMA riga di server.js
 * per garantire che Sentry catturi tutti gli errori, anche quelli durante
 * l'inizializzazione degli altri moduli.
 */

// Carica dotenv PRIMA di leggere le env
import dotenv from 'dotenv';
dotenv.config();

import * as Sentry from '@sentry/node';

// Log di debug
console.log('[SENTRY] Inizializzazione...');
console.log('[SENTRY] Environment:', process.env.NODE_ENV || 'development');
console.log('[SENTRY] DSN presente:', !!process.env.SENTRY_DSN);

Sentry.init({
  dsn: process.env.SENTRY_DSN || 'https://fa74bda9626f7e1f4a406b4759adf30f@o4512187369455617.ingest.de.sentry.io/4512187460616272',
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: 0.1,
  debug: process.env.NODE_ENV !== 'production',
  ignoreErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'socket hang up',
    'Request aborted',
    'Network request failed',
  ],
});

console.log('[SENTRY] ✅ Inizializzato correttamente');

Sentry.captureMessage('Sentry avviato su Railway', {
  level: 'info',
  tags: { source: 'startup' },
});

export default Sentry;