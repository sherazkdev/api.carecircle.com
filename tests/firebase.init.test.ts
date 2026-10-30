import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initFirebase,
  isFirebaseInitialized,
  resetFirebaseForTests,
} from '../src/config/firebase.js';
import { applyTestEnv } from './helpers/setupEnv.js';
import { ensureFirebaseFixture } from './helpers/firebaseFixture.js';

describe('Firebase Admin initialization', () => {
  afterEach(async () => {
    await resetFirebaseForTests();
  });

  it('initializes from FIREBASE_SERVICE_ACCOUNT_PATH', () => {
    applyTestEnv();
    initFirebase();
    expect(isFirebaseInitialized()).toBe(true);
  });

  it('initializes from FIREBASE_SERVICE_ACCOUNT_JSON', () => {
    const path = ensureFirebaseFixture();
    const json = readFileSync(path, 'utf8');
    applyTestEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: json });
    initFirebase();
    expect(isFirebaseInitialized()).toBe(true);
  });
});
