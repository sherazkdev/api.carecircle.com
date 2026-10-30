import type { DecodedIdToken } from 'firebase-admin/auth';
import {
  resetVerifyIdTokenImplementation,
  setVerifyIdTokenImplementation,
} from '../../src/modules/auth/firebaseAuth.service.js';

export function installAuthMock(): void {
  setVerifyIdTokenImplementation(async (idToken: string) => {
    if (!idToken || idToken === 'invalid') {
      const err = new Error('invalid credential') as Error & { code: string };
      err.code = 'auth/argument-error';
      throw err;
    }
    if (idToken === 'expired') {
      const err = new Error('Firebase ID token has expired.') as Error & { code: string };
      err.code = 'auth/id-token-expired';
      throw err;
    }
    // Format: `user:<uid>`
    if (idToken.startsWith('user:')) {
      const uid = idToken.slice('user:'.length);
      return { uid, aud: 'care-circle-test', sub: uid, auth_time: 1, exp: 9999999999, iat: 1, firebase: { identities: {}, sign_in_provider: 'custom' } } as DecodedIdToken;
    }
    const err = new Error('invalid credential') as Error & { code: string };
    err.code = 'auth/invalid-id-token';
    throw err;
  });
}

export function uninstallAuthMock(): void {
  resetVerifyIdTokenImplementation();
}
