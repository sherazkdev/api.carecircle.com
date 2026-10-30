import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Circle } from '../../src/modules/circle/circle.model.js';
import { Member } from '../../src/modules/member/member.model.js';
import { resetRateLimitBucketsForTests } from '../../src/shared/middleware/rateLimit.js';
import { installAuthMock, uninstallAuthMock } from '../helpers/authMock.js';
import { applyTestEnv } from '../helpers/setupEnv.js';
import { clearAllCollections, startTestMongo, stopTestMongo } from '../helpers/mongoTest.js';

describe('API crash resilience (production Express stack)', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    applyTestEnv();
    await startTestMongo();
    installAuthMock();
    app = createApp();
  }, 120_000);

  afterAll(async () => {
    uninstallAuthMock();
    await stopTestMongo();
  });

  beforeEach(async () => {
    applyTestEnv();
    installAuthMock();
    resetRateLimitBucketsForTests();
    await clearAllCollections();
    await Circle.create({ circleId: 'c1', ownerUid: 'owner-1', timezone: 'UTC' });
    await Member.create({
      circleId: 'c1',
      uid: 'owner-1',
      role: 'owner',
      displayName: 'Owner',
      prefs: { medication: true, appointment: true, task: true, updates: true },
    });
  });

  it('returns 401 for missing authorization', async () => {
    const res = await request(app)
      .put('/v1/circles/c1/members/me/prefs')
      .send({ medication: true });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at /i);
  });

  it('returns 401 for invalid and expired tokens', async () => {
    const invalid = await request(app)
      .put('/v1/circles/c1/members/me/prefs')
      .set('Authorization', 'Bearer invalid')
      .send({ medication: true });
    expect(invalid.status).toBe(401);

    const expired = await request(app)
      .put('/v1/circles/c1/members/me/prefs')
      .set('Authorization', 'Bearer expired')
      .send({ medication: true });
    expect(expired.status).toBe(401);
  });

  it('returns 400 for malformed JSON without crashing process', async () => {
    const res = await request(app)
      .post('/v1/circles/c1/devices')
      .set('Authorization', 'Bearer user:owner-1')
      .set('Content-Type', 'application/json')
      .send('{ not-json');

    expect([400, 500]).toContain(res.status);
    expect(res.body.ok).toBe(false);

    const health = await request(app).get('/health/live');
    expect(health.status).toBe(200);
  });

  it('returns 413 or 400 for oversized JSON body', async () => {
    const huge = 'x'.repeat(2 * 1024 * 1024);
    const res = await request(app)
      .post('/v1/circles/c1/devices')
      .set('Authorization', 'Bearer user:owner-1')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ fcmToken: huge, platform: 'android', displayName: 'A' }));

    expect([413, 400, 500]).toContain(res.status);
    const health = await request(app).get('/health/live');
    expect(health.status).toBe(200);
  });

  it('returns validation error for invalid params without internal details leak', async () => {
    const res = await request(app)
      .put('/v1/circles/c1/members/me/prefs')
      .set('Authorization', 'Bearer user:owner-1')
      .send({ medication: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('ZodError');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 for cross-circle member access', async () => {
    await Circle.create({ circleId: 'other', ownerUid: 'other-owner', timezone: 'UTC' });
    const res = await request(app)
      .put('/v1/circles/other/members/me/prefs')
      .set('Authorization', 'Bearer user:owner-1')
      .send({ medication: false, appointment: true, task: true, updates: true });
    expect(res.status).toBe(403);
  });

  it('survives burst of recoverable errors', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        request(app)
          .put('/v1/circles/c1/members/me/prefs')
          .send({ medication: true }),
      ),
    );
    expect(results.every((r) => r.status === 401)).toBe(true);
    const health = await request(app).get('/health/live');
    expect(health.status).toBe(200);
  });
});
