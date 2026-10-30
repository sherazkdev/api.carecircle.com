import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetEnvCache } from '../../src/config/env.js';
import { Circle } from '../../src/modules/circle/circle.model.js';
import { signCircleCreateToken } from '../../src/modules/circle/ownershipProof.js';
import { removeInvalidFcmToken } from '../../src/modules/device/device.service.js';
import { Device } from '../../src/modules/device/device.model.js';
import { Member } from '../../src/modules/member/member.model.js';
import { removeMemberWithCleanup } from '../../src/modules/member/member.service.js';
import { applyTestEnv } from '../helpers/setupEnv.js';
import { installAuthMock, uninstallAuthMock } from '../helpers/authMock.js';
import { clearAllCollections, startTestMongo, stopTestMongo } from '../helpers/mongoTest.js';

async function seedCircle(opts?: { circleId?: string; ownerUid?: string }) {
  const circleId = opts?.circleId ?? 'circle-1';
  const ownerUid = opts?.ownerUid ?? 'owner-1';
  await Circle.create({
    circleId,
    ownerUid,
    timezone: 'Asia/Karachi',
  });
  await Member.create({
    circleId,
    uid: ownerUid,
    role: 'owner',
    displayName: 'Owner',
  });
  await Member.create({
    circleId,
    uid: 'member-1',
    role: 'member',
    displayName: 'Member',
  });
  return { circleId, ownerUid };
}

describe('Phase 4 devices and member prefs', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    applyTestEnv();
    installAuthMock();
    await startTestMongo();
    app = createApp();
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

  describe('POST /v1/circles/:circleId/devices', () => {
    it('requires auth', async () => {
      const res = await request(app).post('/v1/circles/circle-1/devices').send({
        fcmToken: 'tok',
        platform: 'android',
        displayName: 'X',
      });
      expect(res.status).toBe(401);
    });

    it('registers device for existing member and supports repeated upsert', async () => {
      await seedCircle();

      const first = await request(app)
        .post('/v1/circles/circle-1/devices')
        .set('Authorization', 'Bearer user:member-1')
        .send({
          fcmToken: 'token-a',
          platform: 'android',
          displayName: 'Sara',
          role: 'owner', // spoof ignored
        });
      expect(first.status).toBe(200);
      expect(first.body.data.role).toBe('member');
      expect(first.body.data.fcmTokenRegistered).toBe(true);

      const second = await request(app)
        .post('/v1/circles/circle-1/devices')
        .set('Authorization', 'Bearer user:member-1')
        .send({
          fcmToken: 'token-a',
          platform: 'ios',
          displayName: 'Sara M',
        });
      expect(second.status).toBe(200);
      expect(await Device.countDocuments({ circleId: 'circle-1', fcmToken: 'token-a' })).toBe(1);
      const device = await Device.findOne({ circleId: 'circle-1', fcmToken: 'token-a' }).lean();
      expect(device?.platform).toBe('ios');
      const member = await Member.findOne({ circleId: 'circle-1', uid: 'member-1' }).lean();
      expect(member?.displayName).toBe('Sara M');
    });

    it('allows multiple devices per user', async () => {
      await seedCircle();
      await request(app)
        .post('/v1/circles/circle-1/devices')
        .set('Authorization', 'Bearer user:member-1')
        .send({ fcmToken: 't1', platform: 'android', displayName: 'Sara' });
      await request(app)
        .post('/v1/circles/circle-1/devices')
        .set('Authorization', 'Bearer user:member-1')
        .send({ fcmToken: 't2', platform: 'ios', displayName: 'Sara' });
      expect(await Device.countDocuments({ circleId: 'circle-1', uid: 'member-1' })).toBe(2);
    });

    it('reassigns FCM token across accounts (R4)', async () => {
      await seedCircle();
      await request(app)
        .post('/v1/circles/circle-1/devices')
        .set('Authorization', 'Bearer user:member-1')
        .send({ fcmToken: 'shared-token', platform: 'android', displayName: 'Sara' });

      await Member.create({
        circleId: 'circle-1',
        uid: 'member-2',
        role: 'member',
        displayName: 'Other',
      });

      const res = await request(app)
        .post('/v1/circles/circle-1/devices')
        .set('Authorization', 'Bearer user:member-2')
        .send({ fcmToken: 'shared-token', platform: 'android', displayName: 'Other' });
      expect(res.status).toBe(200);
      expect(await Device.countDocuments({ fcmToken: 'shared-token', uid: 'member-1' })).toBe(0);
      expect(await Device.countDocuments({ fcmToken: 'shared-token', uid: 'member-2' })).toBe(1);
    });

    it('allows same token on multiple circles for the same uid', async () => {
      await seedCircle({ circleId: 'c1' });
      await seedCircle({ circleId: 'c2' });
      for (const circleId of ['c1', 'c2']) {
        const res = await request(app)
          .post(`/v1/circles/${circleId}/devices`)
          .set('Authorization', 'Bearer user:member-1')
          .send({ fcmToken: 'multi-circle-tok', platform: 'android', displayName: 'Sara' });
        expect(res.status).toBe(200);
      }
      expect(await Device.countDocuments({ fcmToken: 'multi-circle-tok' })).toBe(2);
    });

    it('rejects non-member join without invite proof (ignores client role)', async () => {
      await seedCircle();
      const res = await request(app)
        .post('/v1/circles/circle-1/devices')
        .set('Authorization', 'Bearer user:stranger')
        .send({
          fcmToken: 'tok',
          platform: 'android',
          displayName: 'Intruder',
          role: 'owner',
        });
      expect(res.status).toBe(403);
      expect(res.body.error.details.reason).toBe('JOIN_PROOF_REQUIRED');
    });

    it('returns 503 when creating a new circle while bootstrap is disabled', async () => {
      const res = await request(app)
        .post('/v1/circles/brand-new/devices')
        .set('Authorization', 'Bearer user:owner-1')
        .send({
          fcmToken: 'tok',
          platform: 'android',
          displayName: 'Owner',
          timezone: 'UTC',
          role: 'owner',
        });
      expect(res.status).toBe(503);
      expect(res.body.error.details.blocker).toBe('C2_P2_ISSUER_MISSING');
    });

    it('bootstraps new circle with P2 proof when enabled', async () => {
      applyTestEnv({ CIRCLE_BOOTSTRAP_ENABLED: 'true' });
      const proof = signCircleCreateToken({
        circleId: 'brand-new',
        ownerUid: 'owner-1',
        timezone: 'UTC',
      });
      const res = await request(app)
        .post('/v1/circles/brand-new/devices')
        .set('Authorization', 'Bearer user:owner-1')
        .send({
          fcmToken: 'owner-tok',
          platform: 'android',
          displayName: 'Owner One',
          timezone: 'Asia/Karachi',
          ownershipProof: proof,
          role: 'member', // ignored; proof establishes owner
        });
      expect(res.status).toBe(200);
      expect(res.body.data.createdCircle).toBe(true);
      expect(res.body.data.role).toBe('owner');
      const circle = await Circle.findOne({ circleId: 'brand-new' }).lean();
      expect(circle?.ownerUid).toBe('owner-1');
      expect(circle?.timezone).toBe('Asia/Karachi');
    });

    it('lets owner update timezone on re-register', async () => {
      await seedCircle();
      const res = await request(app)
        .post('/v1/circles/circle-1/devices')
        .set('Authorization', 'Bearer user:owner-1')
        .send({
          fcmToken: 'owner-device',
          platform: 'android',
          displayName: 'Owner',
          timezone: 'UTC',
        });
      expect(res.status).toBe(200);
      expect(res.body.data.timezone).toBe('UTC');
    });
  });

  describe('PUT /v1/circles/:circleId/members/me/prefs', () => {
    it('updates prefs for a member', async () => {
      await seedCircle();
      const res = await request(app)
        .put('/v1/circles/circle-1/members/me/prefs')
        .set('Authorization', 'Bearer user:member-1')
        .send({
          medication: false,
          appointment: true,
          task: false,
          updates: true,
        });
      expect(res.status).toBe(200);
      expect(res.body.data.prefs).toEqual({
        medication: false,
        appointment: true,
        task: false,
        updates: true,
      });
    });

    it('rejects non-members', async () => {
      await seedCircle();
      const res = await request(app)
        .put('/v1/circles/circle-1/members/me/prefs')
        .set('Authorization', 'Bearer user:stranger')
        .send({
          medication: true,
          appointment: true,
          task: true,
          updates: true,
        });
      expect(res.status).toBe(403);
    });
  });

  describe('cleanup helpers', () => {
    it('removes invalid FCM tokens (R5 helper) and member devices on remove', async () => {
      await seedCircle();
      await Device.create({
        circleId: 'circle-1',
        uid: 'member-1',
        fcmToken: 'bad-token',
        platform: 'android',
      });
      await Device.create({
        circleId: 'circle-2',
        uid: 'member-1',
        fcmToken: 'bad-token',
        platform: 'android',
      });
      expect(await removeInvalidFcmToken('bad-token')).toBe(2);
      expect(await Device.countDocuments({ fcmToken: 'bad-token' })).toBe(0);

      await Device.create({
        circleId: 'circle-1',
        uid: 'member-1',
        fcmToken: 'keep',
        platform: 'android',
      });
      const counts = await removeMemberWithCleanup({
        circleId: 'circle-1',
        uid: 'member-1',
        actorUid: 'owner-1',
        actorIsOwner: true,
      });
      expect(counts.members).toBe(1);
      expect(counts.devices).toBe(1);
      expect(await Member.findOne({ circleId: 'circle-1', uid: 'member-1' })).toBeNull();
    });
  });
});
