import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  handleCreateCareCircle,
  handleRequestCircleBootstrapToken,
  mapOwnershipErrorToHttps,
  type CreateCareCircleInput,
  type RequestBootstrapInput,
} from './bootstrapHandlers.js';
import { OwnershipError } from './firestoreCircles.js';

initializeApp();

const careCircleApiBaseUrl = defineString('CARE_CIRCLE_API_BASE_URL', {
  description: 'Base URL of the Care Circle reminders API (e.g. https://api.example.com)',
});
const issuerApiKey = defineSecret('CIRCLE_TOKEN_ISSUER_API_KEY');

function requireAuthUid(authUid: string | undefined): string {
  if (!authUid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }
  return authUid;
}

function toHttpsError(err: unknown): HttpsError {
  if (err instanceof OwnershipError) {
    return new HttpsError(err.code, err.message);
  }
  const mapped = mapOwnershipErrorToHttps(err);
  if (mapped.code === 'permission-denied' || mapped.code === 'not-found' || mapped.code === 'failed-precondition') {
    return new HttpsError(mapped.code as 'permission-denied', mapped.message);
  }
  return new HttpsError('internal', mapped.message);
}

/**
 * Creates a Firestore circle owned by the caller, then mints a P2 bootstrap token via the API issuer.
 * Flutter receives only ownershipProof — never the issuer API key or HMAC secret.
 */
export const createCareCircle = onCall(
  { secrets: [issuerApiKey], region: 'asia-south1' },
  async (request: CallableRequest<CreateCareCircleInput>) => {
    const uid = requireAuthUid(request.auth?.uid);
    const data = (request.data ?? {}) as CreateCareCircleInput;
    try {
      const result = await handleCreateCareCircle(getFirestore(), uid, data, {
        apiBaseUrl: careCircleApiBaseUrl.value(),
        issuerApiKey: issuerApiKey.value(),
      });
      return result;
    } catch (err) {
      throw toHttpsError(err);
    }
  },
);

/**
 * For apps that already created circles/{circleId} in Firestore client-side:
 * verifies ownerUid == auth.uid, then mints bootstrap token through the trusted issuer.
 */
export const requestCircleBootstrapToken = onCall(
  { secrets: [issuerApiKey], region: 'asia-south1' },
  async (request: CallableRequest<RequestBootstrapInput>) => {
    const uid = requireAuthUid(request.auth?.uid);
    const data = (request.data ?? {}) as RequestBootstrapInput;
    try {
      return await handleRequestCircleBootstrapToken(getFirestore(), uid, data, {
        apiBaseUrl: careCircleApiBaseUrl.value(),
        issuerApiKey: issuerApiKey.value(),
      });
    } catch (err) {
      throw toHttpsError(err);
    }
  },
);
