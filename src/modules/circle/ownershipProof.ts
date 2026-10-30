import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../../config/env.js';
import { AppError, badRequest, conflict, forbidden, serviceUnavailable } from '../../shared/errors/AppError.js';
import { isValidIanaTimezone } from '../../shared/utils/timezone.js';
import { CircleCreateTokenNonce } from './circleCreateTokenNonce.model.js';
import type { CircleCreateProofPayload, VerifiedCircleCreateProof } from './ownershipProof.types.js';

export type { CircleCreateProofPayload, VerifiedCircleCreateProof } from './ownershipProof.types.js';

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function parseBase64urlJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function requireCreateTokenSecret(): string {
  const secret = getEnv().CIRCLE_CREATE_TOKEN_SECRET;
  if (!secret) {
    throw serviceUnavailable(
      'Circle create-token verification is unavailable: CIRCLE_CREATE_TOKEN_SECRET is not configured',
    );
  }
  return secret;
}

/**
 * Trusted-issuer helper (Cloud Function / server only).
 * Flutter clients must NEVER call this — they receive tokens from the issuer.
 */
export function signCircleCreateToken(
  input: Omit<CircleCreateProofPayload, 'jti' | 'iat' | 'exp'> & {
    jti?: string;
    ttlSeconds?: number;
    nowSeconds?: number;
  },
  secret = requireCreateTokenSecret(),
): string {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxTtl = getEnv().CIRCLE_CREATE_TOKEN_MAX_TTL_SECONDS;
  const ttl = Math.min(input.ttlSeconds ?? maxTtl, maxTtl);
  if (ttl <= 0) {
    throw badRequest('ttlSeconds must be positive');
  }
  if (input.timezone !== undefined && !isValidIanaTimezone(input.timezone)) {
    throw badRequest('timezone must be a valid IANA zone');
  }

  const payload: CircleCreateProofPayload = {
    jti: input.jti ?? randomUUID(),
    circleId: input.circleId,
    ownerUid: input.ownerUid,
    iat: now,
    exp: now + ttl,
  };
  if (input.timezone !== undefined) {
    payload.timezone = input.timezone;
  }

  const payloadB64 = base64urlJson(payload);
  const sig = signPayload(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

function parseAndVerifySignature(token: string, secret: string): CircleCreateProofPayload {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw forbidden('Invalid circle create token format');
  }
  const [payloadB64, signature] = parts;
  const expected = signPayload(payloadB64, secret);
  if (!safeEqual(signature, expected)) {
    throw forbidden('Invalid circle create token signature');
  }

  let parsed: unknown;
  try {
    parsed = parseBase64urlJson(payloadB64);
  } catch {
    throw forbidden('Invalid circle create token payload');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as CircleCreateProofPayload).jti !== 'string' ||
    typeof (parsed as CircleCreateProofPayload).circleId !== 'string' ||
    typeof (parsed as CircleCreateProofPayload).ownerUid !== 'string' ||
    typeof (parsed as CircleCreateProofPayload).iat !== 'number' ||
    typeof (parsed as CircleCreateProofPayload).exp !== 'number'
  ) {
    throw forbidden('Invalid circle create token claims');
  }

  const payload = parsed as CircleCreateProofPayload;
  if (payload.timezone !== undefined && !isValidIanaTimezone(payload.timezone)) {
    throw forbidden('Invalid timezone in circle create token');
  }
  return payload;
}

/**
 * Verifies a P2 create token and consumes its jti (replay protection).
 * Does not create a Circle document — bootstrap activation is gated separately.
 */
export async function verifyAndConsumeCircleCreateToken(input: {
  token: string;
  expectedUid: string;
  expectedCircleId: string;
  nowSeconds?: number;
}): Promise<VerifiedCircleCreateProof> {
  const secret = requireCreateTokenSecret();
  const payload = parseAndVerifySignature(input.token, secret);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxTtl = getEnv().CIRCLE_CREATE_TOKEN_MAX_TTL_SECONDS;

  if (payload.exp < now) {
    throw forbidden('Circle create token expired');
  }
  if (payload.iat > now + 60) {
    throw forbidden('Circle create token issued in the future');
  }
  if (payload.exp - payload.iat > maxTtl) {
    throw forbidden('Circle create token TTL exceeds allowed maximum');
  }
  if (payload.ownerUid !== input.expectedUid) {
    throw forbidden('Circle create token ownerUid does not match authenticated user');
  }
  if (payload.circleId !== input.expectedCircleId) {
    throw forbidden('Circle create token circleId does not match path');
  }

  try {
    await CircleCreateTokenNonce.create({
      jti: payload.jti,
      circleId: payload.circleId,
      ownerUid: payload.ownerUid,
      expiresAt: new Date(payload.exp * 1000),
    });
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: number }).code === 11000
    ) {
      throw conflict('Circle create token has already been used');
    }
    throw err;
  }

  return { ...payload, rawToken: input.token };
}

export function assertBootstrapHttpEnabled(): void {
  if (!getEnv().CIRCLE_BOOTSTRAP_ENABLED) {
    throw new AppError(
      503,
      'SERVICE_UNAVAILABLE',
      'Circle ownership bootstrap is not activated: trusted create-token issuer is not integrated yet',
      {
        details: {
          blocker: 'C2_P2_ISSUER_MISSING',
          proof: 'P2',
        },
      },
    );
  }
  if (!getEnv().CIRCLE_CREATE_TOKEN_SECRET) {
    throw serviceUnavailable(
      'Circle ownership bootstrap cannot run without CIRCLE_CREATE_TOKEN_SECRET',
    );
  }
}
