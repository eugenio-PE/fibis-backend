import * as Sentry from '@sentry/node';

console.log('🔍 Inizializzando Sentry...');
console.log('🔍 DSN:', JSON.stringify(process.env.SENTRY_DSN));

Sentry.init({
  dsn: 'https://fa74bda9626f7e1f4a406b4759adf30f@o4512187369455617.ingest.de.sentry.io/4512187460616272',
  environment: 'production',
  tracesSampleRate: 1.0,
  debug: true,
});

console.log('✅ Sentry inizializzato');

// Test immediato all'avvio
Sentry.captureMessage('Test avvio Sentry - funziona!');
console.log('📤 Messaggio di test inviato a Sentry');