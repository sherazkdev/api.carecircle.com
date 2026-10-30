export type CircleCreateProofPayload = {
  /** Unique token id for replay protection */
  jti: string;
  circleId: string;
  ownerUid: string;
  /** Issued-at unix seconds */
  iat: number;
  /** Expiry unix seconds */
  exp: number;
  /** Optional IANA timezone hint for circle creation */
  timezone?: string;
};

export type VerifiedCircleCreateProof = CircleCreateProofPayload & {
  rawToken: string;
};
