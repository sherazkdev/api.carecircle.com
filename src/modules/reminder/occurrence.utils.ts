import { DateTime } from 'luxon';
import { isValidOccurrenceKey } from '../../shared/utils/occurrenceKey.js';
import type { MedicationData } from './reminderData.schemas.js';

export type ParsedOccurrenceKey = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/** Spec weekday: 0 = Sunday … 6 = Saturday. */
export function luxonWeekdayToSpec(weekday: number): number {
  // Luxon: 1 = Monday … 7 = Sunday
  return weekday === 7 ? 0 : weekday;
}

export function parseOccurrenceKey(value: string): ParsedOccurrenceKey | null {
  if (!isValidOccurrenceKey(value)) {
    return null;
  }
  const parts = value.split('-').map((p) => Number(p));
  if (parts.length !== 5) {
    return null;
  }
  const [year, month, day, hour, minute] = parts;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return null;
  }
  if (hour > 23 || minute > 59 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const dt = DateTime.fromObject(
    { year, month, day, hour, minute },
    { zone: 'utc' },
  );
  if (!dt.isValid) {
    return null;
  }
  // Reject zero-padded mismatch vs Spec (e.g. 08 vs 8) — pattern already forbids leading zeros
  // except year. Re-serialize without padding and compare.
  const canonical = `${year}-${month}-${day}-${hour}-${minute}`;
  if (canonical !== value) {
    return null;
  }
  return { year, month, day, hour, minute };
}

export function hhmmToParts(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(':');
  return { hour: Number(h), minute: Number(m) };
}

/**
 * Returns true when occurrenceKey is a real scheduled dose for this medication.
 * Uses calendar date validity, startDate, times[], and scheduleMode/repeatDays.
 */
export function isMedicationOccurrenceValid(
  data: MedicationData,
  occurrenceKey: string,
): { ok: true } | { ok: false; reason: string } {
  const parsed = parseOccurrenceKey(occurrenceKey);
  if (!parsed) {
    return { ok: false, reason: 'Invalid occurrenceKey format or impossible date/time' };
  }

  const start = DateTime.fromISO(data.startDate, { zone: 'utc' });
  if (!start.isValid) {
    return { ok: false, reason: 'Medication startDate is invalid' };
  }

  const occurrenceDate = DateTime.fromObject(
    { year: parsed.year, month: parsed.month, day: parsed.day },
    { zone: 'utc' },
  );
  if (!occurrenceDate.isValid) {
    return { ok: false, reason: 'Invalid occurrence date' };
  }

  if (occurrenceDate.startOf('day') < start.startOf('day')) {
    return { ok: false, reason: 'Occurrence is before medication startDate' };
  }

  const timeMatches = data.times.some((t) => {
    const parts = hhmmToParts(t);
    return parts.hour === parsed.hour && parts.minute === parsed.minute;
  });
  if (!timeMatches) {
    return { ok: false, reason: 'Occurrence time is not in medication times[]' };
  }

  if (data.scheduleMode === 'specificDays') {
    const day = luxonWeekdayToSpec(occurrenceDate.weekday);
    if (!data.repeatDays || !data.repeatDays.includes(day)) {
      return { ok: false, reason: 'Occurrence weekday is not in repeatDays' };
    }
  }

  return { ok: true };
}
