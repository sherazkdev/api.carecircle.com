import { DateTime } from 'luxon';
import { luxonWeekdayToSpec } from '../modules/reminder/occurrence.utils.js';

/**
 * DST policies (Phase 6):
 * - Spring-forward gap (nonexistent local time): schedule at the next valid local minute after the gap.
 * - Fall-back overlap (ambiguous local time): use the earlier offset (Luxon fromObject default).
 * - occurrenceKey always uses circle-local calendar components without zero-padding.
 */

export function toOccurrenceKey(dt: DateTime): string {
  return `${dt.year}-${dt.month}-${dt.day}-${dt.hour}-${dt.minute}`;
}

export function resolveLocalDateTime(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): DateTime {
  const direct = DateTime.fromObject(
    { year, month, day, hour, minute },
    { zone },
  );
  if (direct.isValid) {
    return direct;
  }

  // Spring-forward: walk forward from the intended wall-clock minute until a valid local time exists.
  const dayStart = DateTime.fromObject({ year, month, day, hour: 0, minute: 0 }, { zone });
  if (!dayStart.isValid) {
    throw new Error(`Invalid local calendar day ${year}-${month}-${day} in ${zone}`);
  }
  const targetMinutes = hour * 60 + minute;
  for (let m = targetMinutes; m < 24 * 60 + 120; m++) {
    const candidate = dayStart.plus({ minutes: m });
    if (!candidate.isValid) {
      continue;
    }
    if (candidate.year !== year || candidate.month !== month || candidate.day !== day) {
      // Crossed into next calendar day — use first valid instant after the gap.
      return candidate;
    }
    const wall = candidate.hour * 60 + candidate.minute;
    if (wall >= targetMinutes) {
      return candidate;
    }
  }
  throw new Error(`Unable to resolve local time ${hour}:${minute} on ${year}-${month}-${day} in ${zone}`);
}

export function localPartsFromOccurrenceKey(
  occurrenceKey: string,
  zone: string,
): DateTime | null {
  const parts = occurrenceKey.split('-').map(Number);
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
  try {
    return resolveLocalDateTime(zone, year, month, day, hour, minute);
  } catch {
    return null;
  }
}

export function isAllowedWeekday(
  dt: DateTime,
  mode: 'daily' | 'specificDays' | 'doesNotRepeat' | 'custom',
  repeatDays?: number[],
): boolean {
  if (mode === 'daily' || mode === 'doesNotRepeat') {
    return true;
  }
  const day = luxonWeekdayToSpec(dt.weekday);
  return Boolean(repeatDays?.includes(day));
}

/**
 * Find the next local wall-clock occurrence at hour:minute on an allowed day,
 * strictly after `after` (exclusive of equal instant when `exclusive` true).
 */
export function findNextLocalOccurrence(input: {
  zone: string;
  after: Date;
  hour: number;
  minute: number;
  startDate?: string | undefined;
  mode: 'daily' | 'specificDays' | 'doesNotRepeat' | 'custom';
  repeatDays?: number[] | undefined;
  /** For doesNotRepeat: only this calendar date is valid */
  onlyDate?: string | undefined;
  exclusive?: boolean | undefined;
  maxDaysForward?: number | undefined;
}): DateTime | null {
  const zone = input.zone;
  const afterDt = DateTime.fromJSDate(input.after, { zone });
  const maxDays = input.maxDaysForward ?? 400;

  let startDay = afterDt.startOf('day');
  if (input.startDate) {
    const sd = DateTime.fromISO(input.startDate, { zone }).startOf('day');
    if (sd.isValid && sd > startDay) {
      startDay = sd;
    }
  }
  if (input.onlyDate) {
    const od = DateTime.fromISO(input.onlyDate, { zone }).startOf('day');
    if (!od.isValid) {
      return null;
    }
    if (od < startDay) {
      return null;
    }
    startDay = od;
  }

  for (let offset = 0; offset <= maxDays; offset++) {
    const day = startDay.plus({ days: offset });
    if (input.onlyDate && day.toISODate() !== input.onlyDate) {
      continue;
    }
    if (!isAllowedWeekday(day, input.mode, input.repeatDays)) {
      continue;
    }
    let candidate: DateTime;
    try {
      candidate = resolveLocalDateTime(
        zone,
        day.year,
        day.month,
        day.day,
        input.hour,
        input.minute,
      );
    } catch {
      continue;
    }

    const exclusive = input.exclusive ?? true;
    if (exclusive ? candidate.toMillis() > afterDt.toMillis() : candidate.toMillis() >= afterDt.toMillis()) {
      return candidate;
    }
  }
  return null;
}

export function hhmmToHourMinute(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(':');
  return { hour: Number(h), minute: Number(m) };
}
