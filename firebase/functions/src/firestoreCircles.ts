import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export type CircleFirestoreDoc = {
  ownerUid: string;
  timezone: string;
  displayName?: string;
  createdAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

export type MemberFirestoreDoc = {
  role: 'owner' | 'member';
  displayName: string;
  joinedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

const CIRCLES = 'circles';
const MEMBERS = 'members';

export function circlesCollection(db: Firestore) {
  return db.collection(CIRCLES);
}

export class OwnershipError extends Error {
  readonly code: 'not-found' | 'permission-denied' | 'failed-precondition' | 'already-exists';

  constructor(code: OwnershipError['code'], message: string) {
    super(message);
    this.name = 'OwnershipError';
    this.code = code;
  }
}

function ownershipError(code: OwnershipError['code'], message: string): OwnershipError {
  return new OwnershipError(code, message);
}

export async function assertCallerOwnsCircle(
  db: Firestore,
  circleId: string,
  callerUid: string,
): Promise<CircleFirestoreDoc> {
  const snap = await circlesCollection(db).doc(circleId).get();
  if (!snap.exists) {
    throw ownershipError('not-found', 'Circle does not exist in Firestore');
  }
  const data = snap.data() as CircleFirestoreDoc;
  if (data.ownerUid !== callerUid) {
    throw ownershipError('permission-denied', 'Only the Firestore circle owner may request bootstrap');
  }
  if (!data.timezone || typeof data.timezone !== 'string') {
    throw ownershipError('failed-precondition', 'Circle is missing a valid timezone');
  }
  return data;
}

export async function createCircleWithOwner(input: {
  db: Firestore;
  circleId: string;
  ownerUid: string;
  timezone: string;
  displayName: string;
}): Promise<{ circleId: string; created: boolean }> {
  const circleRef = circlesCollection(input.db).doc(input.circleId);
  const memberRef = circleRef.collection(MEMBERS).doc(input.ownerUid);

  return input.db.runTransaction(async (tx) => {
    const existing = await tx.get(circleRef);
    if (existing.exists) {
      const doc = existing.data() as CircleFirestoreDoc;
      if (doc.ownerUid !== input.ownerUid) {
        throw ownershipError('already-exists', 'Circle id is already owned by another user');
      }
      return { circleId: input.circleId, created: false };
    }

    tx.set(circleRef, {
      ownerUid: input.ownerUid,
      timezone: input.timezone,
      displayName: input.displayName,
      createdAt: FieldValue.serverTimestamp(),
    } satisfies CircleFirestoreDoc);

    tx.set(memberRef, {
      role: 'owner',
      displayName: input.displayName,
      joinedAt: FieldValue.serverTimestamp(),
    } satisfies MemberFirestoreDoc);

    return { circleId: input.circleId, created: true };
  });
}
