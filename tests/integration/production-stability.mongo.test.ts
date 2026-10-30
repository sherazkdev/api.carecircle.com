import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { initFirebase } from '../../src/config/firebase.js';
import { connectMongo, disconnectMongo } from '../../src/config/mongo.js';
import { ensureAllIndexes } from '../../src/shared/db/ensureIndexes.js';
import { applyTestEnv } from '../helpers/setupEnv.js';
import { startTestMongo, stopTestMongo } from '../helpers/mongoTest.js';

describe('MongoDB failure simulation (isolated memory server)', () => {
  let app: ReturnType<typeof createApp>;
  let mongoUri: string;

  beforeAll(async () => {
    applyTestEnv();
    mongoUri = await startTestMongo();
    process.env.MONGODB_URI = mongoUri;
    const { resetEnvCache } = await import('../../src/config/env.js');
    resetEnvCache();
    initFirebase();
    app = createApp();
  }, 120_000);

  afterAll(async () => {
    await disconnectMongo();
    await stopTestMongo();
  });

  it('readiness reports not ready when MongoDB is disconnected', async () => {
    await mongoose.disconnect();

    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.ok).toBe(false);
    expect(ready.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(ready.body.error.details?.mongo).toBe('down');

    const live = await request(app).get('/health/live');
    expect(live.status).toBe(200);

    await connectMongo(mongoUri);
    await ensureAllIndexes();

    const recovered = await request(app).get('/health/ready');
    expect(recovered.status).toBe(200);
  });

  it('API requests fail safely when database is down', async () => {
    await mongoose.disconnect();

    const res = await request(app)
      .get('/health/ready');
    expect(res.status).toBe(503);

    await connectMongo(mongoUri);
    await ensureAllIndexes();
  });
});
