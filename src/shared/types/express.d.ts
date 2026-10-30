import type { DecodedIdToken } from 'firebase-admin/auth';
import type { VerifiedCircleCreateProof } from '../../modules/circle/ownershipProof.types.js';
import type { MemberRole } from './domain.js';

export type AuthContext = {
  uid: string;
  token: DecodedIdToken;
};

export type CircleMembershipContext = {
  circleId: string;
  uid: string;
  role: MemberRole;
  displayName: string;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      circleMembership?: CircleMembershipContext;
      circleBootstrap?: VerifiedCircleCreateProof;
    }
  }
}

export {};
