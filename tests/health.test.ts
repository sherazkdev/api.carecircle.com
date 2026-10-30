import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initFirebase, resetFirebaseForTests } from '../src/config/firebase.js';
import { connectMongo, disconnectMongo } from '../src/config/mongo.js';
import { applyTestEnv } from './helpers/setupEnv.js';

describe('GET /health', () => {
  let memoryMongo: MongoMemoryServer;

  beforeAll(async () => {
    memoryMongo = await MongoMemoryServer.create();
    applyTestEnv({ MONGODB_URI: memoryMongo.getUri('care_circle_test') });
    await resetFirebaseForTests();
    initFirebase();
    await connectMongo();
  }, 120_000);

  afterAll(async () => {
    await disconnectMongo();
    await resetFirebaseForTests();
    await memoryMongo.stop();
  });

  it('returns ok envelope when mongo and firebase are up', async () => {
    const app = createApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.mongo).toBe('up');
    expect(res.body.data.firebase).toBe('up');
  });

  it('distinguishes live and ready', async () => {
    const app = createApp();
    const live = await request(app).get('/health/live');
    expect(live.status).toBe(200);
    expect(live.body.data.status).toBe('live');

    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.data.status).toBe('ready');
  });

  it('returns structured 404 for unknown routes', async () => {
    const app = createApp();
    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });
});
