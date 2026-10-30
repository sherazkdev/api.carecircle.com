import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetRateLimitBucketsForTests } from '../../src/shared/middleware/rateLimit.js';
import { applyTestEnv } from '../helpers/setupEnv.js';

describe('rate limiting', () => {
  afterEach(() => {
    resetRateLimitBucketsForTests();
  });

  it('returns 503 when issuer endpoint exceeds limit', async () => {
    applyTestEnv({
      CIRCLE_CREATE_TOKEN_SECRET: 'rate-limit-test-secret-min-32-chars!!',
      CIRCLE_TOKEN_ISSUER_ENABLED: 'true',
      CIRCLE_TOKEN_ISSUER_API_KEY: 'issuer-key-min-32-characters-long!!',
    });
    const app = createApp();
    const body = { circleId: 'c1', ownerUid: 'u1' };
    const headers = { 'x-issuer-api-key': 'issuer-key-min-32-characters-long!!' };

    for (let i = 0; i < 30; i++) {
      const res = await request(app).post('/v1/internal/circle-create-tokens').set(headers).send(body);
      expect(res.status).not.toBe(503);
    }

    const blocked = await request(app).post('/v1/internal/circle-create-tokens').set(headers).send(body);
    expect(blocked.status).toBe(503);
    expect(blocked.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
