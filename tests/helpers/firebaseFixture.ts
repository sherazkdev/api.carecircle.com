import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_SA_PATH = resolve(here, '../fixtures/firebase-service-account.json');

/**
 * Creates a local-only RSA service-account JSON sufficient for Admin SDK initializeApp.
 * Not a real Google credential — must never be used in production.
 */
export function ensureFirebaseFixture(projectId = 'care-circle-test'): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  const serviceAccount = {
    type: 'service_account',
    project_id: projectId,
    private_key_id: 'test-key',
    private_key: privateKey,
    client_email: `firebase-adminsdk-test@${projectId}.iam.gserviceaccount.com`,
    client_id: '1234567890',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
  };

  mkdirSync(dirname(FIXTURE_SA_PATH), { recursive: true });
  writeFileSync(FIXTURE_SA_PATH, JSON.stringify(serviceAccount, null, 2), 'utf8');
  return FIXTURE_SA_PATH;
}
