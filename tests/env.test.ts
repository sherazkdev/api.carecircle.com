import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '../src/config/env.js';
import { ensureFirebaseFixture } from './helpers/firebaseFixture.js';

describe('loadEnv', () => {
  afterEach(() => {
    resetEnvCache();
  });

  it('accepts a valid configuration with service account path', () => {
    const saPath = ensureFirebaseFixture();
    const env = loadEnv({
      NODE_ENV: 'test',
      PORT: '3001',
      LOG_LEVEL: 'silent',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/care_circle_test',
      FIREBASE_PROJECT_ID: 'care-circle-test',
      FIREBASE_SERVICE_ACCOUNT_PATH: saPath,
      MISS_GRACE_MINUTES: '0',
      PROCESS_MODE: 'api',
    });

    expect(env.PORT).toBe(3001);
    expect(env.MONGODB_URI).toContain('mongodb://');
    expect(env.MISS_GRACE_MINUTES).toBe(0);
  });

  it('rejects missing Mongo URI', () => {
    const saPath = ensureFirebaseFixture();
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        FIREBASE_PROJECT_ID: 'care-circle-test',
        FIREBASE_SERVICE_ACCOUNT_PATH: saPath,
      }),
    ).toThrow(/MONGODB_URI/);
  });

  it('rejects missing Firebase credentials', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/care_circle_test',
        FIREBASE_PROJECT_ID: 'care-circle-test',
      }),
    ).toThrow(/FIREBASE_SERVICE_ACCOUNT/);
  });

  it('rejects production worker with DELIVERY_MODE=noop', () => {
    const saPath = ensureFirebaseFixture();
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/care_circle_test',
        FIREBASE_PROJECT_ID: 'care-circle-test',
        FIREBASE_SERVICE_ACCOUNT_PATH: saPath,
        DELIVERY_MODE: 'noop',
        PROCESS_MODE: 'worker',
      }),
    ).toThrow(/noop/);
  });

  it('rejects CIRCLE_TOKEN_ISSUER_ENABLED without secrets', () => {
    const saPath = ensureFirebaseFixture();
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/care_circle_test',
        FIREBASE_PROJECT_ID: 'care-circle-test',
        FIREBASE_SERVICE_ACCOUNT_PATH: saPath,
        CIRCLE_TOKEN_ISSUER_ENABLED: 'true',
      }),
    ).toThrow(/CIRCLE_CREATE_TOKEN_SECRET|CIRCLE_TOKEN_ISSUER_API_KEY/);
  });
});
