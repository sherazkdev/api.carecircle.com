import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';
import { Circle } from '../../src/modules/circle/circle.model.js';
import { CircleInvite } from '../../src/modules/circle/circleInvite.model.js';
import {
  signCircleCreateToken,
  verifyAndConsumeCircleCreateToken,
} from '../../src/modules/circle/ownershipProof.js';
import {
  signCircleInviteToken,
  verifyAndConsumeCircleInviteToken,
} from '../../src/modules/circle/inviteProof.js';
import { Member } from '../../src/modules/member/member.model.js';
import { DEFAULT_MEMBER_PREFS } from '../../src/shared/types/domain.js';
import { SchedulerWorker } from '../../src/scheduler/worker.js';
import { Job } from '../../src/scheduler/job.model.js';
import { FakeClock, resetClock, setClock } from '../../src/scheduler/clock.js';
import { applyTestEnv } from '../helpers/setupEnv.js';
import { installAuthMock, uninstallAuthMock } from '../helpers/authMock.js';
import { clearAllCollections, startTestMongo, stopTestMongo } from '../helpers/mongoTest.js';
import { ensureFirebaseFixture } from '../helpers/firebaseFixture.js';

const SECRET = 'phase10-circle-create-token-secret-min-32!!';
const ISSUER_KEY = 'phase10-issuer-api-key-min-32-characters!!';

async function seedOwnerCircle(circleId: string, ownerUid: string) {
  await Circle.create({ circleId, ownerUid, timezone: 'Asia/Karachi' });
  await Member.create({
    circleId,
    uid: ownerUid,
    role: 'owner',
    displayName: 'Owner',
    prefs: { ...DEFAULT_MEMBER_PREFS },
  });
}

describe('Phase 10 security, invites, issuer, deploy gates', () => {
  beforeAll(async () => {
    applyTestEnv({
      CIRCLE_CREATE_TOKEN_SECRET: SECRET,
      CIRCLE_BOOTSTRAP_ENABLED: 'true',
      CIRCLE_TOKEN_ISSUER_ENABLED: 'true',
      CIRCLE_TOKEN_ISSUER_API_KEY: ISSUER_KEY,
    });
    installAuthMock();
    await startTestMongo();
  }, 120_000);

  afterAll(async () => {
    uninstallAuthMock();
    await stopTestMongo();
  });

  beforeEach(async () => {
    applyTestEnv({
      CIRCLE_CREATE_TOKEN_SECRET: SECRET,
      CIRCLE_BOOTSTRAP_ENABLED: 'true',
      CIRCLE_TOKEN_ISSUER_ENABLED: 'true',
      CIRCLE_TOKEN_ISSUER_API_KEY: ISSUER_KEY,
    });
    installAuthMock();
    await clearAllCollections();
  });

  afterEach(() => {
    resetEnvCache();
    resetClock();
  });

  describe('signed create-token issuance + verification', () => {
    it('issues via trusted HTTP issuer and verifies signature', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/v1/internal/circle-create-tokens')
        .set('x-issuer-api-key', ISSUER_KEY)
        .send({ circleId: 'c-issue-1', ownerUid: 'uid-owner', ttlSeconds: 120 });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.token).toBeTruthy();

      const proof = await verifyAndConsumeCircleCreateToken({
        token: res.body.data.token,
        expectedUid: 'uid-owner',
        expectedCircleId: 'c-issue-1',
      });
      expect(proof.circleId).toBe('c-issue-1');
      expect(proof.ownerUid).toBe('uid-owner');
    });

    it('rejects unauthorized issuer', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/v1/internal/circle-create-tokens')
        .set('x-issuer-api-key', 'wrong-key-xxxxxxxxxxxxxxxxxxxxxxxx')
        .send({ circleId: 'c1', ownerUid: 'u1' });
      expect(res.status).toBe(401);
    });

    it('rejects expired create token', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = signCircleCreateToken({
        circleId: 'c-exp',
        ownerUid: 'u1',
        ttlSeconds: 1,
        nowSeconds: now - 120,
      });
      await expect(
        verifyAndConsumeCircleCreateToken({
          token,
          expectedUid: 'u1',
          expectedCircleId: 'c-exp',
          nowSeconds: now,
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects replayed create token', async () => {
      const token = signCircleCreateToken({
        circleId: 'c-replay',
        ownerUid: 'u1',
        jti: 'jti-replay-1',
      });
      await verifyAndConsumeCircleCreateToken({
        token,
        expectedUid: 'u1',
        expectedCircleId: 'c-replay',
      });
      await expect(
        verifyAndConsumeCircleCreateToken({
          token,
          expectedUid: 'u1',
          expectedCircleId: 'c-replay',
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('rejects cross-circle and wrong-uid tokens', async () => {
      const token = signCircleCreateToken({
        circleId: 'c-a',
        ownerUid: 'u-a',
      });
      await expect(
        verifyAndConsumeCircleCreateToken({
          token,
          expectedUid: 'u-a',
          expectedCircleId: 'c-b',
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        verifyAndConsumeCircleCreateToken({
          token,
          expectedUid: 'u-b',
          expectedCircleId: 'c-a',
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('prevents owner-claim race on bootstrap register', async () => {
      const app = createApp();
      const tokenA = signCircleCreateToken({
        circleId: 'c-race',
        ownerUid: 'owner-a',
        jti: 'race-a',
      });
      const tokenB = signCircleCreateToken({
        circleId: 'c-race',
        ownerUid: 'owner-b',
        jti: 'race-b',
      });

      const [r1, r2] = await Promise.all([
        request(app)
          .post('/v1/circles/c-race/devices')
          .set('Authorization', 'Bearer user:owner-a')
          .send({
            fcmToken: 'tok-a',
            platform: 'android',
            displayName: 'A',
            timezone: 'Asia/Karachi',
            ownershipProof: tokenA,
          }),
        request(app)
          .post('/v1/circles/c-race/devices')
          .set('Authorization', 'Bearer user:owner-b')
          .send({
            fcmToken: 'tok-b',
            platform: 'android',
            displayName: 'B',
            timezone: 'Asia/Karachi',
            ownershipProof: tokenB,
          }),
      ]);

      const statuses = [r1.status, r2.status];
      expect(statuses).toContain(200);
      expect(statuses.some((s) => s === 409 || s === 403 || s === 200)).toBe(true);
      const circle = await Circle.findOne({ circleId: 'c-race' }).lean();
      expect(circle).toBeTruthy();
      expect(['owner-a', 'owner-b']).toContain(circle!.ownerUid);
      const owners = await Member.find({ circleId: 'c-race', role: 'owner' }).lean();
      expect(owners).toHaveLength(1);
      expect(owners[0]!.uid).toBe(circle!.ownerUid);
    });
  });

  describe('secure invitations', () => {
    it('owner creates invite; member accepts; prefs defaulted', async () => {
      await seedOwnerCircle('c-inv', 'owner-1');
      const app = createApp();

      const create = await request(app)
        .post('/v1/circles/c-inv/invites')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ ttlSeconds: 3600 });
      expect(create.status).toBe(200);
      const inviteToken = create.body.data.inviteToken as string;

      const join = await request(app)
        .post('/v1/circles/c-inv/join')
        .set('Authorization', 'Bearer user:member-1')
        .send({ inviteToken, displayName: 'Member One' });
      expect(join.status).toBe(200);
      expect(join.body.data.role).toBe('member');
      expect(join.body.data.created).toBe(true);

      const member = await Member.findOne({ circleId: 'c-inv', uid: 'member-1' }).lean();
      expect(member?.prefs).toEqual(DEFAULT_MEMBER_PREFS);
      expect(member?.role).toBe('member');
    });

    it('idempotent accept for existing member preserves prefs', async () => {
      await seedOwnerCircle('c-idem', 'owner-1');
      await Member.create({
        circleId: 'c-idem',
        uid: 'member-1',
        role: 'member',
        displayName: 'Already',
        prefs: { ...DEFAULT_MEMBER_PREFS, updates: false },
      });
      const app = createApp();
      const join = await request(app)
        .post('/v1/circles/c-idem/join')
        .set('Authorization', 'Bearer user:member-1')
        .send({ inviteToken: 'unused-but-long-enough-token-xx', displayName: 'Ignored' });
      expect(join.status).toBe(200);
      expect(join.body.data.created).toBe(false);
      const member = await Member.findOne({ circleId: 'c-idem', uid: 'member-1' }).lean();
      expect(member?.prefs.updates).toBe(false);
    });

    it('rejects invite replay and unauthorized invite create', async () => {
      await seedOwnerCircle('c-rep', 'owner-1');
      await Member.create({
        circleId: 'c-rep',
        uid: 'member-x',
        role: 'member',
        displayName: 'X',
        prefs: { ...DEFAULT_MEMBER_PREFS },
      });
      const app = createApp();

      const denied = await request(app)
        .post('/v1/circles/c-rep/invites')
        .set('Authorization', 'Bearer user:member-x')
        .send({});
      expect(denied.status).toBe(403);

      const create = await request(app)
        .post('/v1/circles/c-rep/invites')
        .set('Authorization', 'Bearer user:owner-1')
        .send({});
      const inviteToken = create.body.data.inviteToken as string;

      const first = await request(app)
        .post('/v1/circles/c-rep/join')
        .set('Authorization', 'Bearer user:member-2')
        .send({ inviteToken, displayName: 'M2' });
      expect(first.status).toBe(200);

      const second = await request(app)
        .post('/v1/circles/c-rep/join')
        .set('Authorization', 'Bearer user:member-3')
        .send({ inviteToken, displayName: 'M3' });
      expect(second.status).toBe(409);
    });

    it('handles concurrent invitation acceptance (single winner)', async () => {
      await seedOwnerCircle('c-conc', 'owner-1');
      const inviteToken = await signCircleInviteToken({
        circleId: 'c-conc',
        inviterUid: 'owner-1',
        jti: 'conc-jti-1',
      });
      const app = createApp();

      const results = await Promise.all([
        request(app)
          .post('/v1/circles/c-conc/join')
          .set('Authorization', 'Bearer user:m-a')
          .send({ inviteToken, displayName: 'A' }),
        request(app)
          .post('/v1/circles/c-conc/join')
          .set('Authorization', 'Bearer user:m-b')
          .send({ inviteToken, displayName: 'B' }),
      ]);

      const ok = results.filter((r) => r.status === 200);
      const conflicted = results.filter((r) => r.status === 409);
      expect(ok).toHaveLength(1);
      expect(conflicted).toHaveLength(1);
      const members = await Member.find({ circleId: 'c-conc', role: 'member' }).lean();
      expect(members).toHaveLength(1);
    });

    it('invalidates invitations after circle deletion', async () => {
      await seedOwnerCircle('c-del', 'owner-1');
      const app = createApp();
      const create = await request(app)
        .post('/v1/circles/c-del/invites')
        .set('Authorization', 'Bearer user:owner-1')
        .send({});
      const inviteToken = create.body.data.inviteToken as string;
      expect(await CircleInvite.countDocuments({ circleId: 'c-del' })).toBe(1);

      const del = await request(app)
        .delete('/v1/circles/c-del')
        .set('Authorization', 'Bearer user:owner-1');
      expect(del.status).toBe(200);
      expect(await CircleInvite.countDocuments({ circleId: 'c-del' })).toBe(0);

      await seedOwnerCircle('c-del', 'owner-1');
      const join = await request(app)
        .post('/v1/circles/c-del/join')
        .set('Authorization', 'Bearer user:member-new')
        .send({ inviteToken, displayName: 'Should Fail' });
      expect(join.status).toBe(409);
    });

    it('rejects expired invite token', async () => {
      await seedOwnerCircle('c-iexp', 'owner-1');
      const now = Math.floor(Date.now() / 1000);
      const token = await signCircleInviteToken({
        circleId: 'c-iexp',
        inviterUid: 'owner-1',
        ttlSeconds: 1,
        nowSeconds: now - 120,
      });
      await expect(
        verifyAndConsumeCircleInviteToken({
          token,
          expectedCircleId: 'c-iexp',
          nowSeconds: now,
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  describe('deployment safety', () => {
    it('rejects production noop for workers at env load', () => {
      const saPath = ensureFirebaseFixture();
      expect(() =>
        loadEnv({
          NODE_ENV: 'production',
          PORT: '3000',
          MONGODB_URI: 'mongodb://127.0.0.1:27017/x',
          FIREBASE_PROJECT_ID: 'p',
          FIREBASE_SERVICE_ACCOUNT_PATH: saPath,
          DELIVERY_MODE: 'noop',
          PROCESS_MODE: 'worker',
        }),
      ).toThrow(/noop/);
    });

    it('rejects issuer enabled without API key / secret', () => {
      const saPath = ensureFirebaseFixture();
      expect(() =>
        loadEnv({
          NODE_ENV: 'test',
          MONGODB_URI: 'mongodb://127.0.0.1:27017/x',
          FIREBASE_PROJECT_ID: 'p',
          FIREBASE_SERVICE_ACCOUNT_PATH: saPath,
          CIRCLE_TOKEN_ISSUER_ENABLED: 'true',
          CIRCLE_CREATE_TOKEN_SECRET: SECRET,
        }),
      ).toThrow(/CIRCLE_TOKEN_ISSUER_API_KEY/);
    });

    it('exposes live vs ready health endpoints', async () => {
      const app = createApp();
      const live = await request(app).get('/health/live');
      expect(live.status).toBe(200);
      expect(live.body.data.status).toBe('live');

      const ready = await request(app).get('/health/ready');
      expect([200, 503]).toContain(ready.status);
      if (ready.status === 200) {
        expect(ready.body.data.status).toBe('ready');
      } else {
        expect(ready.body.error.details.status).toBe('not_ready');
      }
    });

    it('worker stop prevents new work; pending jobs remain claimable', async () => {
      setClock(new FakeClock('2026-10-30T08:00:00.000Z'));
      await Job.create({
        circleId: 'c-w',
        module: 'medication',
        itemId: 'med-1',
        occurrenceKey: '2026-10-30-8-0',
        type: 'med_due',
        fireAt: new Date('2026-10-30T07:59:00.000Z'),
        audience: 'owner',
        state: 'pending',
        sent: false,
        dedupeKey: 'c-w:med-1:2026-10-30-8-0:med_due',
        attempts: 0,
      });

      const worker = new SchedulerWorker({ workerId: 'w-phase10', pollIntervalMs: 60_000 });
      await worker.stop();
      const processed = await worker.tick();
      expect(processed).toBe(0);

      const stillPending = await Job.findOne({
        dedupeKey: 'c-w:med-1:2026-10-30-8-0:med_due',
      }).lean();
      expect(stillPending?.state).toBe('pending');
    });
  });
});
