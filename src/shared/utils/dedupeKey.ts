import type { NotificationType } from '../types/domain.js';

/**
 * Globally unique job dedupe key.
 * Spec: `{itemId}-{occurrenceKey}-{type}`; prefixed with circleId to avoid
 * cross-circle collisions when itemIds are not globally unique.
 * Optional suffix supports incremental med_snooze indices.
 */
export function buildJobDedupeKey(input: {
  circleId: string;
  itemId: string;
  occurrenceKey: string;
  type: NotificationType;
  suffix?: string;
}): string {
  const base = `${input.circleId}:${input.itemId}:${input.occurrenceKey}:${input.type}`;
  return input.suffix ? `${base}:${input.suffix}` : base;
}
