import { getEnv } from '../../config/env.js';
import { forbidden, serviceUnavailable, unauthorized } from '../../shared/errors/AppError.js';
import { signCircleCreateToken } from './ownershipProof.js';

/**
 * Trusted server-to-server issuance of P2 circle-create tokens.
 *
 * Trust model:
 * - Caller must present CIRCLE_TOKEN_ISSUER_API_KEY (Cloud Function / ops only).
 * - Flutter must NEVER receive this API key or call this endpoint.
 * - The issuer does not prove circleId provenance by itself: the Cloud Function
 *   that authenticates the Firebase user and decides circleId is the trust root.
 *   Without that CF (or equivalent), production circle onboarding remains BLOCKED.
 */
export function assertTrustedIssuer(apiKeyHeader: string | undefined): void {
  const env = getEnv();
  if (!env.CIRCLE_TOKEN_ISSUER_ENABLED) {
    throw serviceUnavailable('Circle create-token issuer HTTP endpoint is disabled', {
      blocker: 'C2_P2_ISSUER_HTTP_DISABLED',
    });
  }
  if (!env.CIRCLE_TOKEN_ISSUER_API_KEY || !env.CIRCLE_CREATE_TOKEN_SECRET) {
    throw serviceUnavailable('Circle create-token issuer is not fully configured');
  }
  if (!apiKeyHeader || apiKeyHeader !== env.CIRCLE_TOKEN_ISSUER_API_KEY) {
    throw unauthorized('Invalid issuer API key');
  }
}

export function issueCircleCreateToken(input: {
  circleId: string;
  ownerUid: string;
  timezone?: string;
  ttlSeconds?: number;
}): { token: string; circleId: string; ownerUid: string; expiresInSeconds: number } {
  const env = getEnv();
  if (!env.CIRCLE_TOKEN_ISSUER_ENABLED) {
    throw forbidden('Issuer disabled');
  }
  const maxTtl = env.CIRCLE_CREATE_TOKEN_MAX_TTL_SECONDS;
  const ttl = Math.min(input.ttlSeconds ?? maxTtl, maxTtl);
  const token = signCircleCreateToken({
    circleId: input.circleId,
    ownerUid: input.ownerUid,
    ttlSeconds: ttl,
    ...(input.timezone ? { timezone: input.timezone } : {}),
  });
  return {
    token,
    circleId: input.circleId,
    ownerUid: input.ownerUid,
    expiresInSeconds: ttl,
  };
}
