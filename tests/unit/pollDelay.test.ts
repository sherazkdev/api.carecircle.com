import { describe, expect, it } from 'vitest';
import { delayUntilNextFire } from '../../src/scheduler/pollDelay.js';

describe('delayUntilNextFire', () => {
  const now = Date.parse('2026-11-12T10:00:00.000Z');

  it('sleeps until the job fire time when that is sooner than the max poll', () => {
    const fireAt = Date.parse('2026-11-12T10:00:00.400Z');
    expect(delayUntilNextFire(now, fireAt, 5_000)).toBe(400);
  });

  it('does not sleep longer than the max poll when the next job is far away', () => {
    const fireAt = Date.parse('2026-11-12T15:00:00.000Z');
    expect(delayUntilNextFire(now, fireAt, 5_000)).toBe(5_000);
  });

  it('retries soon when a job is already due', () => {
    const fireAt = Date.parse('2026-11-12T09:59:00.000Z');
    expect(delayUntilNextFire(now, fireAt, 5_000)).toBe(250);
  });

  it('uses the max poll when nothing is queued', () => {
    expect(delayUntilNextFire(now, null, 1_000)).toBe(1_000);
  });

  it('keeps a 15:00 job on that minute even when the max poll is one minute', () => {
    const fireAt = Date.parse('2026-11-12T10:15:00.000Z');
    const justBefore = fireAt - 12_000;
    expect(delayUntilNextFire(justBefore, fireAt, 60_000)).toBe(12_000);
  });
});
