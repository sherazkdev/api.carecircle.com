import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { unauthorized } from '../../shared/errors/AppError.js';

export type VerifyIdTokenFn = (idToken: string) => Promise<DecodedIdToken>;

let verifyIdTokenImpl: VerifyIdTokenFn = async (idToken: string) => {
  return getAuth().verifyIdToken(idToken, true);
};

/** Test/DI hook — production uses Firebase Admin. */
export function setVerifyIdTokenImplementation(fn: VerifyIdTokenFn): void {
  verifyIdTokenImpl = fn;
}

export function resetVerifyIdTokenImplementation(): void {
  verifyIdTokenImpl = async (idToken: string) => getAuth().verifyIdToken(idToken, true);
}

export async function verifyFirebaseIdToken(idToken: string): Promise<DecodedIdToken> {
  try {
    return await verifyIdTokenImpl(idToken);
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';
    const message =
      err instanceof Error ? err.message : 'Firebase ID token verification failed';

    if (
      code.includes('id-token-expired') ||
      message.toLowerCase().includes('expired')
    ) {
      throw unauthorized('Firebase ID token expired');
    }
    if (
      code.includes('argument-error') ||
      code.includes('id-token-revoked') ||
      code.includes('invalid-id-token') ||
      message.toLowerCase().includes('invalid')
    ) {
      throw unauthorized('Invalid Firebase ID token');
    }
    throw unauthorized('Invalid Firebase ID token');
  }
}

export function extractBearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader) {
    throw unauthorized('Missing Authorization bearer token');
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match?.[1]) {
    throw unauthorized('Missing Authorization bearer token');
  }
  return match[1].trim();
}
