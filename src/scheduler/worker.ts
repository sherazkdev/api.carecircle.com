import { randomUUID } from 'node:crypto';
import { getLogger } from '../config/logger.js';
import { claimNextJob } from './claimJobs.js';
import { getClock } from './clock.js';
import { processClaimedJob } from './processJob.js';

export type SchedulerWorkerOptions = {
  workerId?: string;
  pollIntervalMs?: number;
  /** Max jobs to process per tick (avoid starving other work). */
  batchSize?: number;
};

export class SchedulerWorker {
  readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Set by stop() — blocks further ticks (including manual test ticks). */
  private stopped = false;
  private tickInFlight = false;

  constructor(options: SchedulerWorkerOptions = {}) {
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.pollIntervalMs = options.pollIntervalMs ?? Number(process.env.SCHEDULER_POLL_INTERVAL_MS ?? 60_000);
    this.batchSize = options.batchSize ?? 50;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.stopped = false;
    this.running = true;
    getLogger().info(
      { workerId: this.workerId, pollIntervalMs: this.pollIntervalMs },
      'scheduler worker started',
    );
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Wait briefly if a tick is in flight
    const start = Date.now();
    while (this.tickInFlight && Date.now() - start < 10_000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    getLogger().info({ workerId: this.workerId }, 'scheduler worker stopped');
  }

  /**
   * Run one poll cycle. Allowed before start() for tests; blocked after stop().
   * Concurrent overlapping ticks are coalesced (second returns 0).
   */
  async tick(): Promise<number> {
    if (this.tickInFlight || this.stopped) {
      return 0;
    }
    this.tickInFlight = true;
    let processed = 0;
    try {
      for (let i = 0; i < this.batchSize; i++) {
        if (this.stopped) {
          break;
        }
        const job = await claimNextJob(this.workerId, getClock().now());
        if (!job) {
          break;
        }
        await processClaimedJob(job);
        processed += 1;
      }
    } catch (err) {
      getLogger().error(
        { err: { message: err instanceof Error ? err.message : 'unknown' }, workerId: this.workerId },
        'scheduler tick failed',
      );
    } finally {
      this.tickInFlight = false;
    }
    return processed;
  }
}

let singleton: SchedulerWorker | null = null;

export function getSchedulerWorker(): SchedulerWorker | null {
  return singleton;
}

export function startSchedulerWorker(options?: SchedulerWorkerOptions): SchedulerWorker {
  if (!singleton) {
    singleton = new SchedulerWorker(options);
  }
  singleton.start();
  return singleton;
}

export async function stopSchedulerWorker(): Promise<void> {
  if (singleton) {
    await singleton.stop();
    singleton = null;
  }
}
