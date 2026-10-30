import { resetEnvCache } from '../../src/config/env.js';
import { ensureFirebaseFixture } from './firebaseFixture.js';

export function applyTestEnv(overrides: Record<string, string> = {}): void {
  const saPath = ensureFirebaseFixture();
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3000';
  process.env.LOG_LEVEL = 'silent';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/care_circle_test';
  process.env.FIREBASE_PROJECT_ID = 'care-circle-test';
  process.env.MISS_GRACE_MINUTES = '0';
  process.env.PROCESS_MODE = 'all';
  process.env.DELIVERY_MODE = overrides.DELIVERY_MODE ?? 'noop';
  process.env.CIRCLE_BOOTSTRAP_ENABLED = 'false';
  process.env.CIRCLE_TOKEN_ISSUER_ENABLED = 'false';
  process.env.CIRCLE_CREATE_TOKEN_MAX_TTL_SECONDS = '600';
  process.env.CIRCLE_INVITE_TOKEN_MAX_TTL_SECONDS = '604800';
  process.env.CIRCLE_CREATE_TOKEN_SECRET =
    overrides.CIRCLE_CREATE_TOKEN_SECRET ??
    'test-circle-create-token-secret-min-32-chars!!';
  delete process.env.CIRCLE_TOKEN_ISSUER_API_KEY;

  if (overrides.FIREBASE_SERVICE_ACCOUNT_JSON) {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = overrides.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  } else {
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH =
      overrides.FIREBASE_SERVICE_ACCOUNT_PATH ?? saPath;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'FIREBASE_SERVICE_ACCOUNT_PATH' || key === 'FIREBASE_SERVICE_ACCOUNT_JSON') {
      continue;
    }
    process.env[key] = value;
  }

  resetEnvCache();
}
