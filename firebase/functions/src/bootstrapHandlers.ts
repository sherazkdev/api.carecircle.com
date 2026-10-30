import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { mintCircleBootstrapTokenViaApi } from './careCircleApiClient.js';
import { assertCallerOwnsCircle, createCircleWithOwner, OwnershipError } from './firestoreCircles.js';

export type FunctionsConfig = {
  apiBaseUrl: string;
  issuerApiKey: string;
  fetchImpl?: typeof fetch;
};

export type CreateCareCircleInput = {
  timezone: string;
  displayName: string;
  circleId?: string;
};

export type RequestBootstrapInput = {
  circleId: string;
  timezone?: string;
};

export async function handleCreateCareCircle(
  db: Firestore,
  callerUid: string,
  input: CreateCareCircleInput,
  config: FunctionsConfig,
): Promise<{
  circleId: string;
  created: boolean;
  ownershipProof: string;
  expiresInSeconds: number;
}> {
  if (!input.timezone?.trim()) {
    throw new OwnershipError('failed-precondition', 'timezone is required');
  }
  if (!input.displayName?.trim()) {
    throw new OwnershipError('failed-precondition', 'displayName is required');
  }

  const circleId = input.circleId?.trim() || randomUUID();
  const { created } = await createCircleWithOwner({
    db,
    circleId,
    ownerUid: callerUid,
    timezone: input.timezone.trim(),
    displayName: input.displayName.trim(),
  });

  const minted = await mintCircleBootstrapTokenViaApi(
    {
      circleId,
      ownerUid: callerUid,
      timezone: input.timezone.trim(),
    },
    { baseUrl: config.apiBaseUrl, apiKey: config.issuerApiKey, fetchImpl: config.fetchImpl },
  );

  return {
    circleId,
    created,
    ownershipProof: minted.token,
    expiresInSeconds: minted.expiresInSeconds,
  };
}

export async function handleRequestCircleBootstrapToken(
  db: Firestore,
  callerUid: string,
  input: RequestBootstrapInput,
  config: FunctionsConfig,
): Promise<{
  circleId: string;
  ownershipProof: string;
  expiresInSeconds: number;
}> {
  if (!input.circleId?.trim()) {
    throw new OwnershipError('failed-precondition', 'circleId is required');
  }

  const circle = await assertCallerOwnsCircle(db, input.circleId.trim(), callerUid);
  const timezone = input.timezone?.trim() || circle.timezone;

  const minted = await mintCircleBootstrapTokenViaApi(
    {
      circleId: input.circleId.trim(),
      ownerUid: callerUid,
      timezone,
    },
    { baseUrl: config.apiBaseUrl, apiKey: config.issuerApiKey, fetchImpl: config.fetchImpl },
  );

  return {
    circleId: input.circleId.trim(),
    ownershipProof: minted.token,
    expiresInSeconds: minted.expiresInSeconds,
  };
}

export function mapOwnershipErrorToHttps(err: unknown): { code: string; message: string } {
  if (err instanceof OwnershipError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    return { code: 'internal', message: err.message };
  }
  return { code: 'internal', message: 'Unknown error' };
}
