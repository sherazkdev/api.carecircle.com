import { describe, expect, it, vi } from 'vitest';
import { mintCircleBootstrapTokenViaApi } from '../src/careCircleApiClient.js';
import {
  assertCallerOwnsCircle,
  createCircleWithOwner,
  OwnershipError,
} from '../src/firestoreCircles.js';
import {
  handleCreateCareCircle,
  handleRequestCircleBootstrapToken,
} from '../src/bootstrapHandlers.js';

describe('careCircleApiClient', () => {
  it('calls internal issuer with API key header', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: {
          token: 'tok-1',
          circleId: 'c1',
          ownerUid: 'u1',
          expiresInSeconds: 300,
        },
      }),
    })) as unknown as typeof fetch;

    const testIssuerKey = 'test-issuer-api-key-for-unit-tests-only-x';
    const result = await mintCircleBootstrapTokenViaApi(
      { circleId: 'c1', ownerUid: 'u1', timezone: 'Asia/Karachi' },
      { baseUrl: 'https://api.test', apiKey: testIssuerKey, fetchImpl },
    );

    expect(result.token).toBe('tok-1');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/v1/internal/circle-create-tokens',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Issuer-Api-Key': testIssuerKey,
        }),
      }),
    );
  });
});

describe('firestoreCircles ownership proofs', () => {
  it('rejects bootstrap when caller is not Firestore owner', async () => {
    const db = {
      collection: () => ({
        doc: () => ({
          get: async () => ({
            exists: true,
            data: () => ({ ownerUid: 'real-owner', timezone: 'Asia/Karachi' }),
          }),
        }),
      }),
    } as unknown as import('firebase-admin/firestore').Firestore;

    await expect(assertCallerOwnsCircle(db, 'c1', 'attacker')).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('creates circle atomically with owner member row', async () => {
    const writes: unknown[] = [];
    const db = {
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          get: async () => ({ exists: false }),
          set: (ref: unknown, data: unknown) => {
            writes.push({ ref, data });
          },
        };
        return fn(tx);
      },
      collection: () => ({
        doc: (id: string) => ({ id, collection: () => ({ doc: (uid: string) => ({ id: uid }) }) }),
      }),
    } as unknown as import('firebase-admin/firestore').Firestore;

    const result = await createCircleWithOwner({
      db,
      circleId: 'new-circle',
      ownerUid: 'owner-1',
      timezone: 'Asia/Karachi',
      displayName: 'Owner',
    });

    expect(result.created).toBe(true);
    expect(writes.length).toBe(2);
  });
});

describe('bootstrap handlers', () => {
  it('requestCircleBootstrapToken refuses wrong owner before issuer call', async () => {
    const fetchImpl = vi.fn();
    const db = {
      collection: () => ({
        doc: () => ({
          get: async () => ({
            exists: true,
            data: () => ({ ownerUid: 'owner-a', timezone: 'UTC' }),
          }),
        }),
      }),
    } as unknown as import('firebase-admin/firestore').Firestore;

    await expect(
      handleRequestCircleBootstrapToken(
        db,
        'owner-b',
        { circleId: 'c1' },
        { apiBaseUrl: 'https://api.test', issuerApiKey: 'k'.repeat(32) },
      ),
    ).rejects.toBeInstanceOf(OwnershipError);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('createCareCircle mints token only after Firestore create', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: { token: 'proof', circleId: 'c-new', ownerUid: 'u1', expiresInSeconds: 600 },
      }),
    })) as unknown as typeof fetch;

    const db = {
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          get: async () => ({ exists: false }),
          set: () => undefined,
        };
        return fn(tx);
      },
      collection: () => ({
        doc: (id: string) => ({ id, collection: () => ({ doc: () => ({}) }) }),
      }),
    } as unknown as import('firebase-admin/firestore').Firestore;

    const result = await handleCreateCareCircle(
      db,
      'u1',
      { timezone: 'Asia/Karachi', displayName: 'Me', circleId: 'c-new' },
      {
        apiBaseUrl: 'https://api.test',
        issuerApiKey: 'k'.repeat(32),
        fetchImpl,
      },
    );

    expect(result.ownershipProof).toBe('proof');
    expect(fetchImpl).toHaveBeenCalled();
  });
});
