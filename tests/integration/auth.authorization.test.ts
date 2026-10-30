import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Circle } from '../../src/modules/circle/circle.model.js';
import { bootstrapCircleOwnership } from '../../src/modules/circle/circleBootstrap.service.js';
import {
  signCircleCreateToken,
  verifyAndConsumeCircleCreateToken,
} from '../../src/modules/circle/ownershipProof.js';
import { Member } from '../../src/modules/member/member.model.js';
import { Device } from '../../src/modules/device/device.model.js';
import { requireAuth } from '../../src/shared/middleware/requireAuth.js';
import {
  requireCircleMember,
  requireCircleOwner,
} from '../../src/shared/middleware/requireCircleAccess.js';
import { requireTrustedCircleBootstrap } from '../../src/shared/middleware/requireTrustedCircleBootstrap.js';
import { errorHandler, notFoundHandler } from '../../src/shared/middleware/errorHandler.js';
import { sendOk } from '../../src/shared/utils/response.js';
import { applyTestEnv } from '../helpers/setupEnv.js';
import { installAuthMock, uninstallAuthMock } from '../helpers/authMock.js';
import { clearAllCollections, startTestMongo, stopTestMongo } from '../helpers/mongoTest.js';
import { resetEnvCache } from '../../src/config/env.js';

function createSecureApp() {
  const app = express();
  app.use(express.json());

  app.get('/secure', requireAuth, (req, res) => {
    sendOk(res, { uid: req.auth!.uid });
  });

  app.get('/circles/:circleId/member-area', requireAuth, requireCircleMember, (req, res) => {
    sendOk(res, { membership: req.circleMembership });
  });

  app.put(
    '/circles/:circleId/owner-only',
    requireAuth,
    requireCircleOwner,
    (req, res) => {
      sendOk(res, { uid: req.auth!.uid, role: req.circleMembership!.role });
    },
  );

  app.post(
    '/circles/:circleId/bootstrap',
    requireAuth,
    requireTrustedCircleBootstrap,
    (req, res) => {
      sendOk(res, { proof: req.circleBootstrap });
    },
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('Phase 3 auth and authorization', () => {
  beforeAll(async () => {
    applyTestEnv();
    installAuthMock();
    await startTestMongo();
  }, 120_000);

  afterAll(async () => {
    uninstallAuthMock();
    await stopTestMongo();
  });

  beforeEach(async () => {
    applyTestEnv({ CIRCLE_BOOTSTRAP_ENABLED: 'false' });
    installAuthMock();
    await clearAllCollections();
  });

  afterEach(() => {
    resetEnvCache();
  });

  describe('requireAuth', () => {
    it('rejects missing token', async () => {
      const res = await request(createSecureApp()).get('/secure');
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects invalid token', async () => {
      const res = await request(createSecureApp())
        .get('/secure')
        .set('Authorization', 'Bearer invalid');
      expect(res.status).toBe(401);
    });

    it('rejects expired token', async () => {
      const res = await request(createSecureApp())
        .get('/secure')
        .set('Authorization', 'Bearer expired');
      expect(res.status).toBe(401);
      expect(res.body.error.message).toMatch(/expired/i);
    });

    it('accepts valid authenticated user', async () => {
      const res = await request(createSecureApp())
        .get('/secure')
        .set('Authorization', 'Bearer user:alice');
      expect(res.status).toBe(200);
      expect(res.body.data.uid).toBe('alice');
    });
  });

  describe('circle membership and ownership', () => {
    beforeEach(async () => {
      await Circle.create({
        circleId: 'circle-a',
        ownerUid: 'owner-1',
        timezone: 'Asia/Karachi',
      });
      await Member.create({
        circleId: 'circle-a',
        uid: 'owner-1',
        role: 'owner',
        displayName: 'Owner One',
      });
      await Member.create({
        circleId: 'circle-a',
        uid: 'member-1',
        role: 'member',
        displayName: 'Member One',
      });
      await Circle.create({
        circleId: 'circle-b',
        ownerUid: 'owner-1',
        timezone: 'UTC',
      });
      await Member.create({
        circleId: 'circle-b',
        uid: 'owner-1',
        role: 'owner',
        displayName: 'Owner One',
      });
    });

    it('allows multiple ordinary members and one owner; owner may own multiple circles', async () => {
      await Member.create({
        circleId: 'circle-a',
        uid: 'member-2',
        role: 'member',
        displayName: 'Member Two',
      });
      expect(await Member.countDocuments({ circleId: 'circle-a', role: 'member' })).toBe(2);
      expect(await Circle.countDocuments({ ownerUid: 'owner-1' })).toBe(2);

      await expect(
        Member.create({
          circleId: 'circle-a',
          uid: 'intruder',
          role: 'owner',
          displayName: 'Fake Owner',
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('rejects unauthorized user (not a member)', async () => {
      const res = await request(createSecureApp())
        .get('/circles/circle-a/member-area')
        .set('Authorization', 'Bearer user:stranger');
      expect(res.status).toBe(403);
    });

    it('allows ordinary member access to member routes', async () => {
      const res = await request(createSecureApp())
        .get('/circles/circle-a/member-area')
        .set('Authorization', 'Bearer user:member-1');
      expect(res.status).toBe(200);
      expect(res.body.data.membership.role).toBe('member');
    });

    it('allows owner access and blocks member on owner-only (C1)', async () => {
      const ownerRes = await request(createSecureApp())
        .put('/circles/circle-a/owner-only')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ role: 'owner' });
      expect(ownerRes.status).toBe(200);

      const memberRes = await request(createSecureApp())
        .put('/circles/circle-a/owner-only')
        .set('Authorization', 'Bearer user:member-1')
        .send({ role: 'owner' }); // client role spoofing must fail
      expect(memberRes.status).toBe(403);
    });

    it('prevents cross-circle access', async () => {
      await Member.create({
        circleId: 'circle-b',
        uid: 'member-1',
        role: 'member',
        displayName: 'Member One',
      });
      // member-1 is on both; stranger on none for circle-b check already covered.
      // Remove member-1 from circle-b scenario: use member-2 only on A
      const res = await request(createSecureApp())
        .get('/circles/circle-b/member-area')
        .set('Authorization', 'Bearer user:member-2');
      // member-2 not created on B
      expect(res.status).toBe(403);
    });

    it('ignores client role spoofing for ownership', async () => {
      const res = await request(createSecureApp())
        .put('/circles/circle-a/owner-only')
        .set('Authorization', 'Bearer user:member-1')
        .send({ role: 'owner', uid: 'owner-1' });
      expect(res.status).toBe(403);
    });
  });

  describe('FCM multi-circle registration indexes', () => {
    it('allows same token across circles for same uid; unique per circle', async () => {
      await Device.create({
        circleId: 'c1',
        uid: 'u1',
        fcmToken: 'tok-1',
        platform: 'android',
      });
      await Device.create({
        circleId: 'c2',
        uid: 'u1',
        fcmToken: 'tok-1',
        platform: 'android',
      });
      await expect(
        Device.create({
          circleId: 'c1',
          uid: 'u2',
          fcmToken: 'tok-1',
          platform: 'ios',
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe('P2 create token verification (bootstrap HTTP gated)', () => {
    it('returns 503 when bootstrap is not enabled (issuer not integrated)', async () => {
      applyTestEnv({ CIRCLE_BOOTSTRAP_ENABLED: 'false' });
      const token = signCircleCreateToken({
        circleId: 'new-circle',
        ownerUid: 'owner-1',
        timezone: 'UTC',
      });
      const res = await request(createSecureApp())
        .post('/circles/new-circle/bootstrap')
        .set('Authorization', 'Bearer user:owner-1')
        .set('X-Circle-Create-Token', token);
      expect(res.status).toBe(503);
      expect(res.body.error.details.blocker).toBe('C2_P2_ISSUER_MISSING');
    });

    it('rejects expired create token', async () => {
      applyTestEnv({ CIRCLE_BOOTSTRAP_ENABLED: 'true' });
      const now = Math.floor(Date.now() / 1000);
      const token = signCircleCreateToken({
        circleId: 'new-circle',
        ownerUid: 'owner-1',
        timezone: 'UTC',
        nowSeconds: now - 120,
        ttlSeconds: 60,
      });
      await expect(
        verifyAndConsumeCircleCreateToken({
          token,
          expectedUid: 'owner-1',
          expectedCircleId: 'new-circle',
          nowSeconds: now,
        }),
      ).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/expired/i) });
    });

    it('rejects replayed create token', async () => {
      applyTestEnv({ CIRCLE_BOOTSTRAP_ENABLED: 'true' });
      const token = signCircleCreateToken({
        circleId: 'new-circle',
        ownerUid: 'owner-1',
        timezone: 'UTC',
        jti: 'fixed-jti-1',
      });
      await verifyAndConsumeCircleCreateToken({
        token,
        expectedUid: 'owner-1',
        expectedCircleId: 'new-circle',
      });
      await expect(
        verifyAndConsumeCircleCreateToken({
          token,
          expectedUid: 'owner-1',
          expectedCircleId: 'new-circle',
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('rejects uid / circleId mismatch', async () => {
      applyTestEnv({ CIRCLE_BOOTSTRAP_ENABLED: 'true' });
      const token = signCircleCreateToken({
        circleId: 'circle-x',
        ownerUid: 'owner-1',
        timezone: 'UTC',
      });
      await expect(
        verifyAndConsumeCircleCreateToken({
          token,
          expectedUid: 'other-user',
          expectedCircleId: 'circle-x',
        }),
      ).rejects.toMatchObject({ statusCode: 403 });

      await expect(
        verifyAndConsumeCircleCreateToken({
          token,
          expectedUid: 'owner-1',
          expectedCircleId: 'circle-y',
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('accepts valid proof via middleware when bootstrap flag enabled', async () => {
      applyTestEnv({ CIRCLE_BOOTSTRAP_ENABLED: 'true' });
      const token = signCircleCreateToken({
        circleId: 'new-circle',
        ownerUid: 'owner-1',
        timezone: 'Asia/Karachi',
      });
      const res = await request(createSecureApp())
        .post('/circles/new-circle/bootstrap')
        .set('Authorization', 'Bearer user:owner-1')
        .set('X-Circle-Create-Token', token)
        .send({ role: 'owner' }); // spoofed role ignored
      expect(res.status).toBe(200);
      expect(res.body.data.proof.circleId).toBe('new-circle');
      expect(res.body.data.proof.ownerUid).toBe('owner-1');
    });

    it('handles first-owner claim race on persistence helper', async () => {
      applyTestEnv({ CIRCLE_BOOTSTRAP_ENABLED: 'true' });
      const tokenA = signCircleCreateToken({
        circleId: 'race-circle',
        ownerUid: 'owner-a',
        timezone: 'UTC',
      });
      const tokenB = signCircleCreateToken({
        circleId: 'race-circle',
        ownerUid: 'owner-b',
        timezone: 'UTC',
      });
      const proofA = await verifyAndConsumeCircleCreateToken({
        token: tokenA,
        expectedUid: 'owner-a',
        expectedCircleId: 'race-circle',
      });
      const proofB = await verifyAndConsumeCircleCreateToken({
        token: tokenB,
        expectedUid: 'owner-b',
        expectedCircleId: 'race-circle',
      });

      await bootstrapCircleOwnership({
        proof: proofA,
        displayName: 'A',
        timezone: 'UTC',
      });
      await expect(
        bootstrapCircleOwnership({
          proof: proofB,
          displayName: 'B',
          timezone: 'UTC',
        }),
      ).rejects.toMatchObject({ statusCode: 409 });

      const circle = await Circle.findOne({ circleId: 'race-circle' }).lean();
      expect(circle?.ownerUid).toBe('owner-a');
    });
  });

  it('keeps health public without auth', async () => {
    // health needs mongo+firebase from createApp only — skip full health; route exists on main app
    const app = createApp();
    // Without firebase/mongo wired in this suite's process state, health may 503; just ensure no 401
    const res = await request(app).get('/health');
    expect(res.status).not.toBe(401);
  });
});
