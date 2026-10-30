import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signCircleCreateToken } from '../../src/modules/circle/ownershipProof.js';
import { signCircleInviteToken } from '../../src/modules/circle/inviteProof.js';
import { Circle } from '../../src/modules/circle/circle.model.js';
import { Member } from '../../src/modules/member/member.model.js';
import { DEFAULT_MEMBER_PREFS } from '../../src/shared/types/domain.js';
import { applyTestEnv } from '../helpers/setupEnv.js';
import { installAuthMock, uninstallAuthMock } from '../helpers/authMock.js';
import { clearAllCollections, startTestMongo, stopTestMongo } from '../helpers/mongoTest.js';

const SECRET = 'release-blocker-secret-min-32-characters!!';

async function seedCircle(circleId: string, ownerUid: string, memberUid?: string) {
  await Circle.create({ circleId, ownerUid, timezone: 'Asia/Karachi' });
  await Member.create({
    circleId,
    uid: ownerUid,
    role: 'owner',
    displayName: 'Owner',
    prefs: { ...DEFAULT_MEMBER_PREFS },
  });
  if (memberUid) {
    await Member.create({
      circleId,
      uid: memberUid,
      role: 'member',
      displayName: 'Member',
      prefs: { ...DEFAULT_MEMBER_PREFS },
    });
  }
}

describe('Release blocker — unauthorized access matrix', () => {
  beforeAll(async () => {
    applyTestEnv({ CIRCLE_CREATE_TOKEN_SECRET: SECRET, CIRCLE_BOOTSTRAP_ENABLED: 'true' });
    installAuthMock();
    await startTestMongo();
  }, 120_000);

  afterAll(async () => {
    uninstallAuthMock();
    await stopTestMongo();
  });

  beforeEach(async () => {
    applyTestEnv({ CIRCLE_CREATE_TOKEN_SECRET: SECRET, CIRCLE_BOOTSTRAP_ENABLED: 'true' });
    installAuthMock();
    await clearAllCollections();
  });

  afterEach(() => {
    installAuthMock();
  });

  it('cannot claim ownership with client role field on device register', async () => {
    await seedCircle('c1', 'real-owner');
    const app = createApp();
    const res = await request(app)
      .post('/v1/circles/c1/devices')
      .set('Authorization', 'Bearer user:attacker')
      .send({
        fcmToken: 'tok',
        platform: 'android',
        displayName: 'Attacker',
        role: 'owner',
      });
    expect(res.status).toBe(403);
    expect(res.body.error.details?.reason).toBe('JOIN_PROOF_REQUIRED');
  });

  it('cannot bootstrap another user circle with stolen create token', async () => {
    const app = createApp();
    const token = signCircleCreateToken({
      circleId: 'victim-circle',
      ownerUid: 'victim',
    });
    const res = await request(app)
      .post('/v1/circles/victim-circle/devices')
      .set('Authorization', 'Bearer user:attacker')
      .send({
        fcmToken: 'tok',
        platform: 'android',
        displayName: 'Attacker',
        timezone: 'Asia/Karachi',
        ownershipProof: token,
      });
    expect(res.status).toBe(403);
  });

  it('cannot join without valid invite', async () => {
    await seedCircle('c1', 'owner-1');
    const app = createApp();
    const res = await request(app)
      .post('/v1/circles/c1/join')
      .set('Authorization', 'Bearer user:stranger')
      .send({ inviteToken: 'not-a-valid-signed-token-xx', displayName: 'X' });
    expect([403, 409]).toContain(res.status);
  });

  it('cannot reuse consumed invite token', async () => {
    await seedCircle('c1', 'owner-1');
    const inviteToken = await signCircleInviteToken({
      circleId: 'c1',
      inviterUid: 'owner-1',
      jti: 'once-only',
    });
    const app = createApp();
    const first = await request(app)
      .post('/v1/circles/c1/join')
      .set('Authorization', 'Bearer user:m1')
      .send({ inviteToken, displayName: 'M1' });
    expect(first.status).toBe(200);
    const second = await request(app)
      .post('/v1/circles/c1/join')
      .set('Authorization', 'Bearer user:m2')
      .send({ inviteToken, displayName: 'M2' });
    expect(second.status).toBe(409);
  });

  it('cannot read or modify another circle reminders', async () => {
    await seedCircle('circle-a', 'owner-a');
    await seedCircle('circle-b', 'owner-b');
    const app = createApp();
    const getForbidden = await request(app)
      .put('/v1/circles/circle-b/reminders/medication/med-1')
      .set('Authorization', 'Bearer user:owner-a')
      .send({ title: 'Hack', scheduleMode: 'daily', times: ['08:00'], startDate: '2026-01-01' });
    expect(getForbidden.status).toBe(403);
  });

  it('cannot mint create tokens without issuer API key', async () => {
    applyTestEnv({
      CIRCLE_CREATE_TOKEN_SECRET: SECRET,
      CIRCLE_TOKEN_ISSUER_ENABLED: 'true',
      CIRCLE_TOKEN_ISSUER_API_KEY: 'issuer-key-min-32-characters-long!!',
    });
    const app = createApp();
    const res = await request(app)
      .post('/v1/internal/circle-create-tokens')
      .send({ circleId: 'c1', ownerUid: 'u1' });
    expect(res.status).toBe(401);
  });
});
