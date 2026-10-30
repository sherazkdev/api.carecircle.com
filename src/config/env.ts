import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  FIREBASE_PROJECT_ID: z.string().min(1, 'FIREBASE_PROJECT_ID is required'),
  /**
   * Absolute or relative path to a service-account JSON file.
   * Prefer this in local/dev Docker mounts.
   */
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  /**
   * Raw JSON string of the service account (useful in CI/secrets managers).
   * Do not log this value.
   */
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  MISS_GRACE_MINUTES: z.coerce.number().int().min(0).default(0),
  PROCESS_MODE: z.enum(['api', 'worker', 'all']).default('all'),
  /**
   * fcm = Firebase Admin Messaging (production default).
   * noop = dry-run; forbidden for production workers.
   */
  DELIVERY_MODE: z.enum(['fcm', 'noop']).default('fcm'),
  /**
   * HMAC secret shared with the trusted Cloud Function issuer (P2).
   * Optional until issuer exists; bootstrap verification fails closed without it.
   */
  CIRCLE_CREATE_TOKEN_SECRET: z.string().min(32).optional(),
  /**
   * When false (default), HTTP circle ownership bootstrap stays inactive.
   * Enable only after a trusted issuer is deployed and integrated.
   */
  CIRCLE_BOOTSTRAP_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Max create-token lifetime accepted by the verifier (seconds). Default 10 minutes. */
  CIRCLE_CREATE_TOKEN_MAX_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  /**
   * Enables POST /v1/internal/circle-create-tokens for trusted servers only.
   * Never enable for public Flutter clients.
   */
  CIRCLE_TOKEN_ISSUER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Shared secret for the trusted issuer HTTP endpoint (Cloud Function / ops).
   * Required when CIRCLE_TOKEN_ISSUER_ENABLED=true. Never ship to Flutter.
   */
  CIRCLE_TOKEN_ISSUER_API_KEY: z.string().min(32).optional(),
  /** Max invite-token TTL seconds (default 7 days). */
  CIRCLE_INVITE_TOKEN_MAX_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

export function loadEnv(processEnv: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(processEnv);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const env = parsed.data;
  const hasPath = Boolean(env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim());
  const hasJson = Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());
  if (!hasPath && !hasJson) {
    throw new Error(
      'Invalid environment configuration: provide FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON',
    );
  }

  if (env.CIRCLE_TOKEN_ISSUER_ENABLED) {
    if (!env.CIRCLE_CREATE_TOKEN_SECRET) {
      throw new Error(
        'Invalid environment configuration: CIRCLE_TOKEN_ISSUER_ENABLED requires CIRCLE_CREATE_TOKEN_SECRET',
      );
    }
    if (!env.CIRCLE_TOKEN_ISSUER_API_KEY) {
      throw new Error(
        'Invalid environment configuration: CIRCLE_TOKEN_ISSUER_ENABLED requires CIRCLE_TOKEN_ISSUER_API_KEY',
      );
    }
  }

  if (
    env.NODE_ENV === 'production' &&
    env.DELIVERY_MODE === 'noop' &&
    (env.PROCESS_MODE === 'worker' || env.PROCESS_MODE === 'all')
  ) {
    throw new Error(
      'Invalid environment configuration: DELIVERY_MODE=noop is forbidden in production workers',
    );
  }

  return env;
}

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = loadEnv();
  }
  return cachedEnv;
}

/** Test helper: clear cached env between cases. */
export function resetEnvCache(): void {
  cachedEnv = undefined;
}
