import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cert, deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getEnv } from './env.js';
import { getLogger } from './logger.js';

export type FirebaseStatus = 'uninitialized' | 'up' | 'error';

let status: FirebaseStatus = 'uninitialized';
let lastError: string | undefined;

type ServiceAccountJson = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
  [key: string]: unknown;
};

function loadServiceAccount(): ServiceAccountJson {
  const env = getEnv();

  if (env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) {
    return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as ServiceAccountJson;
  }

  const path = env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!path?.trim()) {
    throw new Error('Firebase service account credentials are not configured');
  }

  const absolute = resolve(path);
  const raw = readFileSync(absolute, 'utf8');
  return JSON.parse(raw) as ServiceAccountJson;
}

export function getFirebaseStatus(): FirebaseStatus {
  return status;
}

export function getFirebaseLastError(): string | undefined {
  return lastError;
}

export function isFirebaseInitialized(): boolean {
  return status === 'up' && getApps().length > 0;
}

/**
 * Initializes Firebase Admin once. Does not perform network I/O beyond credential parse.
 * Never logs private keys or full service-account JSON.
 */
export function initFirebase(): App {
  const logger = getLogger();
  const env = getEnv();

  const existing = getApps()[0];
  if (existing) {
    status = 'up';
    lastError = undefined;
    return existing;
  }

  try {
    const serviceAccount = loadServiceAccount();
    const projectId = env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
    if (!projectId) {
      throw new Error('FIREBASE_PROJECT_ID is missing and service account has no project_id');
    }
    if (!serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error('Service account JSON must include client_email and private_key');
    }

    const app = initializeApp({
      credential: cert({
        projectId,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key,
      }),
      projectId,
    });

    status = 'up';
    lastError = undefined;
    logger.info({ projectId }, 'Firebase Admin initialized');
    return app;
  } catch (err) {
    status = 'error';
    lastError = err instanceof Error ? err.message : 'Unknown Firebase init error';
    logger.error({ err: { message: lastError } }, 'Firebase Admin initialization failed');
    throw err;
  }
}

/** Test helper */
export async function resetFirebaseForTests(): Promise<void> {
  await Promise.all(getApps().map(async (app) => deleteApp(app)));
  status = 'uninitialized';
  lastError = undefined;
}
