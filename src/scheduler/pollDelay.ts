/** How long the worker should sleep before the next claim attempt. */
export function delayUntilNextFire(
  nowMs: number,
  nextReadyAtMs: number | null,
  maxPollMs: number,
): number {
  const cap = Number.isFinite(maxPollMs) && maxPollMs > 0 ? maxPollMs : 5_000;
  if (nextReadyAtMs == null || !Number.isFinite(nextReadyAtMs)) {
    return cap;
  }
  const delta = nextReadyAtMs - nowMs;
  // Already due but not claimed (batch limit or a race). Retry shortly, don't spin.
  if (delta <= 0) {
    return Math.min(250, cap);
  }
  return Math.min(cap, delta);
}
