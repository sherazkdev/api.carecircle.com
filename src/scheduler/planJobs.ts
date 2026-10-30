import { DateTime } from 'luxon';
import { getEnv } from '../config/env.js';
import type {
  AppointmentData,
  MedicationData,
  TaskData,
} from '../modules/reminder/reminderData.schemas.js';
import type { ReminderModule, ReminderStatus } from '../shared/types/domain.js';
import { getClock } from './clock.js';
import { insertPlannedJobs, type PlannedJob } from './jobInsert.js';
import {
  findNextLocalOccurrence,
  hhmmToHourMinute,
  localPartsFromOccurrenceKey,
  resolveLocalDateTime,
  toOccurrenceKey,
} from './timeLocal.js';

export type PlanReminderInput = {
  circleId: string;
  itemId: string;
  module: ReminderModule;
  timezone: string;
  data: MedicationData | AppointmentData | TaskData;
  status?: ReminderStatus | null | undefined;
  /** Defaults to clock.now() */
  now?: Date | undefined;
};

function missGraceMs(): number {
  return getEnv().MISS_GRACE_MINUTES * 60_000;
}

function pushOccurrenceJobs(input: {
  jobs: PlannedJob[];
  circleId: string;
  itemId: string;
  module: ReminderModule;
  occurrenceKey: string;
  occurrenceLocal: DateTime;
  leadTimeMinutes: number;
  now: Date;
  beforeType: PlannedJob['type'];
  dueType: PlannedJob['type'];
  missedType: PlannedJob['type'];
}): void {
  const T = input.occurrenceLocal.toUTC();
  const tMs = T.toMillis();
  const nowMs = input.now.getTime();

  if (tMs <= nowMs) {
    // Never enqueue historical due/missed/before for past occurrences.
    return;
  }

  if (input.leadTimeMinutes > 0) {
    const beforeAt = T.minus({ minutes: input.leadTimeMinutes });
    if (beforeAt.toMillis() > nowMs) {
      input.jobs.push({
        circleId: input.circleId,
        itemId: input.itemId,
        module: input.module,
        occurrenceKey: input.occurrenceKey,
        type: input.beforeType,
        fireAt: beforeAt.toJSDate(),
        audience: 'owner',
        payloadHints: { leadTimeMinutes: input.leadTimeMinutes },
      });
    }
  }

  input.jobs.push({
    circleId: input.circleId,
    itemId: input.itemId,
    module: input.module,
    occurrenceKey: input.occurrenceKey,
    type: input.dueType,
    fireAt: T.toJSDate(),
    audience: 'owner',
  });

  const missedAt = new Date(tMs + missGraceMs());
  if (missedAt.getTime() > nowMs) {
    input.jobs.push({
      circleId: input.circleId,
      itemId: input.itemId,
      module: input.module,
      occurrenceKey: input.occurrenceKey,
      type: input.missedType,
      fireAt: missedAt,
      audience: 'family',
    });
  }
}

export function planMedicationJobs(input: {
  circleId: string;
  itemId: string;
  timezone: string;
  data: MedicationData;
  now: Date;
  /** If set, only plan for this dose time stream (HH:mm). */
  onlyTime?: string;
}): PlannedJob[] {
  const jobs: PlannedJob[] = [];
  const times = input.onlyTime ? [input.onlyTime] : input.data.times;
  const mode = input.data.scheduleMode === 'daily' ? 'daily' : 'specificDays';

  for (const time of times) {
    const { hour, minute } = hhmmToHourMinute(time);
    const next = findNextLocalOccurrence({
      zone: input.timezone,
      after: input.now,
      hour,
      minute,
      startDate: input.data.startDate,
      mode,
      repeatDays: input.data.repeatDays,
      exclusive: true,
    });
    if (!next) {
      continue;
    }
    pushOccurrenceJobs({
      jobs,
      circleId: input.circleId,
      itemId: input.itemId,
      module: 'medication',
      occurrenceKey: toOccurrenceKey(next),
      occurrenceLocal: next,
      leadTimeMinutes: input.data.leadTimeMinutes,
      now: input.now,
      beforeType: 'med_before',
      dueType: 'med_due',
      missedType: 'med_missed',
    });
  }
  return jobs;
}

export function planAppointmentJobs(input: {
  circleId: string;
  itemId: string;
  timezone: string;
  data: AppointmentData;
  status: ReminderStatus;
  now: Date;
}): PlannedJob[] {
  if (input.status !== 'active') {
    return [];
  }
  const jobs: PlannedJob[] = [];
  const starts = DateTime.fromISO(input.data.startsAt, { setZone: true });
  if (!starts.isValid) {
    return [];
  }
  const local = starts.setZone(input.timezone);
  pushOccurrenceJobs({
    jobs,
    circleId: input.circleId,
    itemId: input.itemId,
    module: 'appointment',
    occurrenceKey: toOccurrenceKey(local),
    occurrenceLocal: local,
    leadTimeMinutes: input.data.leadTimeMinutes,
    now: input.now,
    beforeType: 'appt_before',
    dueType: 'appt_due',
    missedType: 'appt_missed',
  });
  return jobs;
}

export function planTaskJobs(input: {
  circleId: string;
  itemId: string;
  timezone: string;
  data: TaskData;
  status: ReminderStatus;
  now: Date;
}): PlannedJob[] {
  if (input.status !== 'active') {
    return [];
  }
  const jobs: PlannedJob[] = [];
  const { hour, minute } = hhmmToHourMinute(input.data.time);

  let next: DateTime | null = null;
  if (input.data.repeatMode === 'doesNotRepeat') {
    next = findNextLocalOccurrence({
      zone: input.timezone,
      after: input.now,
      hour,
      minute,
      onlyDate: input.data.date,
      mode: 'doesNotRepeat',
      exclusive: true,
    });
  } else if (input.data.repeatMode === 'daily') {
    next = findNextLocalOccurrence({
      zone: input.timezone,
      after: input.now,
      hour,
      minute,
      startDate: input.data.date,
      mode: 'daily',
      exclusive: true,
    });
  } else {
    next = findNextLocalOccurrence({
      zone: input.timezone,
      after: input.now,
      hour,
      minute,
      startDate: input.data.date,
      mode: 'custom',
      repeatDays: input.data.repeatDays,
      exclusive: true,
    });
  }

  if (!next) {
    return [];
  }

  pushOccurrenceJobs({
    jobs,
    circleId: input.circleId,
    itemId: input.itemId,
    module: 'task',
    occurrenceKey: toOccurrenceKey(next),
    occurrenceLocal: next,
    leadTimeMinutes: input.data.leadTimeMinutes,
    now: input.now,
    beforeType: 'task_before',
    dueType: 'task_due',
    missedType: 'task_missed',
  });
  return jobs;
}

export function buildPlanForReminder(input: PlanReminderInput): PlannedJob[] {
  const now = input.now ?? getClock().now();
  if (input.module === 'medication') {
    return planMedicationJobs({
      circleId: input.circleId,
      itemId: input.itemId,
      timezone: input.timezone,
      data: input.data as MedicationData,
      now,
    });
  }
  if (input.module === 'appointment') {
    return planAppointmentJobs({
      circleId: input.circleId,
      itemId: input.itemId,
      timezone: input.timezone,
      data: input.data as AppointmentData,
      status: input.status ?? 'active',
      now,
    });
  }
  return planTaskJobs({
    circleId: input.circleId,
    itemId: input.itemId,
    timezone: input.timezone,
    data: input.data as TaskData,
    status: input.status ?? 'active',
    now,
  });
}

export async function planAndInsertReminderJobs(input: PlanReminderInput): Promise<number> {
  const jobs = buildPlanForReminder(input);
  return insertPlannedJobs(jobs);
}

/** Next chronological dose after occurrence T for snooze cutoff. */
export function findNextMedicationDoseAfter(input: {
  timezone: string;
  data: MedicationData;
  afterOccurrenceKey: string;
}): DateTime | null {
  const current = localPartsFromOccurrenceKey(input.afterOccurrenceKey, input.timezone);
  if (!current) {
    return null;
  }
  const mode = input.data.scheduleMode === 'daily' ? 'daily' : 'specificDays';
  let soonest: DateTime | null = null;
  for (const time of input.data.times) {
    const { hour, minute } = hhmmToHourMinute(time);
    const next = findNextLocalOccurrence({
      zone: input.timezone,
      after: current.toJSDate(),
      hour,
      minute,
      startDate: input.data.startDate,
      mode,
      repeatDays: input.data.repeatDays,
      exclusive: true,
    });
    if (next && (!soonest || next.toMillis() < soonest.toMillis())) {
      soonest = next;
    }
  }
  return soonest;
}

export function planNextSnoozeJob(input: {
  circleId: string;
  itemId: string;
  timezone: string;
  data: MedicationData;
  occurrenceKey: string;
  snoozeIndex: number;
  fromFireAt: Date;
}): PlannedJob | null {
  if (input.data.snoozeMinutes <= 0) {
    return null;
  }
  const occurrenceLocal = localPartsFromOccurrenceKey(input.occurrenceKey, input.timezone);
  if (!occurrenceLocal) {
    return null;
  }
  const T = occurrenceLocal.toUTC();
  const twoHourCap = T.plus({ hours: 2 });
  const nextDose = findNextMedicationDoseAfter({
    timezone: input.timezone,
    data: input.data,
    afterOccurrenceKey: input.occurrenceKey,
  });
  const cutoff = nextDose
    ? DateTime.min(twoHourCap, nextDose.toUTC())
    : twoHourCap;

  const snoozeAt = DateTime.fromJSDate(input.fromFireAt, { zone: 'utc' }).plus({
    minutes: input.data.snoozeMinutes,
  });
  if (snoozeAt.toMillis() >= cutoff.toMillis()) {
    return null;
  }

  return {
    circleId: input.circleId,
    itemId: input.itemId,
    module: 'medication',
    occurrenceKey: input.occurrenceKey,
    type: 'med_snooze',
    fireAt: snoozeAt.toJSDate(),
    audience: 'owner',
    dedupeSuffix: String(input.snoozeIndex),
    payloadHints: {
      snoozeIndex: input.snoozeIndex,
      snoozeMinutes: input.data.snoozeMinutes,
      cutoffIso: cutoff.toUTC().toISO(),
    },
  };
}

export function planNextOccurrenceAfterDue(input: {
  circleId: string;
  itemId: string;
  module: ReminderModule;
  timezone: string;
  data: MedicationData | AppointmentData | TaskData;
  status?: ReminderStatus | null;
  /** The occurrence that just fired (due). */
  completedOccurrenceKey: string;
  /** For medication: which time stream (HH:mm) */
  timeHhMm?: string;
}): PlannedJob[] {
  const completed = localPartsFromOccurrenceKey(input.completedOccurrenceKey, input.timezone);
  if (!completed) {
    return [];
  }
  // Plan as if "now" is the completed occurrence instant so the next slot is after it.
  const now = completed.toUTC().toJSDate();

  if (input.module === 'medication') {
    const data = input.data as MedicationData;
    return planMedicationJobs({
      circleId: input.circleId,
      itemId: input.itemId,
      timezone: input.timezone,
      data,
      now,
      ...(input.timeHhMm !== undefined ? { onlyTime: input.timeHhMm } : {}),
    });
  }
  if (input.module === 'appointment') {
    return []; // one-shot
  }
  return planTaskJobs({
    circleId: input.circleId,
    itemId: input.itemId,
    timezone: input.timezone,
    data: input.data as TaskData,
    status: input.status ?? 'active',
    now,
  });
}

/** Exported for tests */
export { resolveLocalDateTime, toOccurrenceKey };
