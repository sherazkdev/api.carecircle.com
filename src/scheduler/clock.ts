export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Deterministic clock for scheduler tests. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(initial: Date | string) {
    this.current = typeof initial === 'string' ? new Date(initial) : new Date(initial.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(next: Date | string): void {
    this.current = typeof next === 'string' ? new Date(next) : new Date(next.getTime());
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  advanceMinutes(minutes: number): void {
    this.advanceMs(minutes * 60_000);
  }
}

let activeClock: Clock = new SystemClock();

export function getClock(): Clock {
  return activeClock;
}

export function setClock(clock: Clock): void {
  activeClock = clock;
}

export function resetClock(): void {
  activeClock = new SystemClock();
}
