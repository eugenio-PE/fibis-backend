import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN || 'https://fa74bda9626f7e1f4a406b4759adf30f@o4512187369455617.ingest.de.sentry.io/4512187460616272',
  
  environment: process.env.NODE_ENV || 'development',
  
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: 0.1,
  profileSessionSampleRate: 0.1,
  profileLifecycle: 'trace',
  
  ignoreErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'socket hang up',
    'Request aborted',
  ],
});