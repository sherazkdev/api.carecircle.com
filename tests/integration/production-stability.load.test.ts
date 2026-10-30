import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Circle } from '../../src/modules/circle/circle.model.js';
import { Member } from '../../src/modules/member/member.model.js';
import { resetRateLimitBucketsForTests } from '../../src/shared/middleware/rateLimit.js';
import { installAuthMock, uninstallAuthMock } from '../helpers/authMock.js';
import { applyTestEnv } from '../helpers/setupEnv.js';
import { clearAllCollections, startTestMongo, stopTestMongo } from '../helpers/mongoTest.js';
import {
  startProductionServer,
  type ProductionServerHandle,
} from '../helpers/productionServer.js';

type AutocannonResult = {
  requests: { total: number; average: number };
  latency: { average: number; p95: number; p99: number };
  non2xx: number;
  timeouts: number;
  errors: number;
};

async function runAutocannon(
  url: string,
  opts: { connections?: number; duration?: number; headers?: Record<string, string> },
): Promise<AutocannonResult> {
  const autocannon = (await import('autocannon')).default;
  return new Promise((resolve, reject) => {
    const cannonOpts: import('autocannon').AutocannonOptions = {
      url,
      connections: opts.connections ?? 10,
      duration: opts.duration ?? 5,
    };
    if (opts.headers) {
      cannonOpts.headers = opts.headers;
    }
    const instance = autocannon(cannonOpts, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    });
    autocannon.track(instance, { renderProgressBar: false });
  });
}

describe('controlled load (local isolated)', () => {
  let app: ReturnType<typeof createApp>;
  let prod: ProductionServerHandle | undefined;

  beforeAll(async () => {
    applyTestEnv();
    await startTestMongo();
    installAuthMock();
    app = createApp();
  }, 120_000);

  afterAll(async () => {
    if (prod) {
      await prod.stop();
    }
    uninstallAuthMock();
    await stopTestMongo();
  });

  beforeEach(async () => {
    applyTestEnv();
    installAuthMock();
    resetRateLimitBucketsForTests();
    await clearAllCollections();
    await Circle.create({ circleId: 'load-c', ownerUid: 'owner-1', timezone: 'UTC' });
    await Member.create({
      circleId: 'load-c',
      uid: 'owner-1',
      role: 'owner',
      displayName: 'Owner',
      prefs: { medication: true, appointment: true, task: true, updates: true },
    });
  });

  it(
    'autocannon health burst on compiled server (production process)',
    async () => {
      prod = await startProductionServer();
      const memBefore = process.memoryUsage();
      let result: AutocannonResult;
      try {
        result = await runAutocannon(`${prod.baseUrl}/health/live`, {
          connections: 20,
          duration: 8,
        });
      } catch (err) {
        // Mark NOT TESTED in report if npx/autocannon unavailable
        expect.fail(String(err));
      }
      const memAfter = process.memoryUsage();

      expect(result.requests.total).toBeGreaterThan(100);
      expect(result.errors).toBe(0);
      expect(result.timeouts).toBe(0);
      expect(result.non2xx).toBe(0);
      expect(result.latency.p99).toBeLessThan(5000);

      // Parent process memory — informational only
      expect(memAfter.heapUsed).toBeGreaterThan(0);
      expect(memBefore.rss).toBeGreaterThan(0);
    },
    180_000,
  );

  it(
    'moderate concurrency on authenticated prefs (in-process API stack)',
    async () => {
      const memBefore = process.memoryUsage();
      const burst = await Promise.all(
        Array.from({ length: 40 }, () =>
          request(app)
            .put('/v1/circles/load-c/members/me/prefs')
            .set('Authorization', 'Bearer user:owner-1')
            .send({ medication: true, appointment: true, task: true, updates: true }),
        ),
      );
      const memAfter = process.memoryUsage();
      const ok = burst.filter((r) => r.status === 200).length;
      const err4xx = burst.filter((r) => r.status >= 400 && r.status < 500).length;
      expect(ok).toBe(40);
      expect(err4xx).toBe(0);
      expect(memAfter.heapUsed - memBefore.heapUsed).toBeLessThan(80 * 1024 * 1024);
    },
    60_000,
  );
});
