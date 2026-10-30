import pino from 'pino';
import { getEnv } from './env.js';

export function createLogger() {
  const env = getEnv();
  return pino({
    level: env.LOG_LEVEL,
    base: {
      service: 'care-circle-reminders-api',
      env: env.NODE_ENV,
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-issuer-api-key"]',
        'fcmToken',
        'ownershipProof',
        'inviteToken',
        'token',
        'FIREBASE_SERVICE_ACCOUNT_JSON',
        'private_key',
        'client_email',
        'CIRCLE_CREATE_TOKEN_SECRET',
        'CIRCLE_TOKEN_ISSUER_API_KEY',
      ],
      remove: true,
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;

let rootLogger: Logger | undefined;

export function getLogger(): Logger {
  if (!rootLogger) {
    rootLogger = createLogger();
  }
  return rootLogger;
}
