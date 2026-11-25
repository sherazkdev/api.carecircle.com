import { describe, expect, it } from 'vitest';
import { isRemindFamilyBeforeEnabled, normalizeReminderData } from '../../src/modules/reminder/reminderToggles.js';
import { parseReminderData } from '../../src/modules/reminder/reminderData.schemas.js';

describe('reminder toggles', () => {
  it('defaults remindFamilyBefore from reminderEnabled', () => {
    const normalized = normalizeReminderData({
      title: 'x',
      scheduleMode: 'daily',
      times: ['08:00'],
      startDate: '2026-03-01',
      snoozeMinutes: 0,
      reminderEnabled: true,
      notifyFamilyOnMiss: true,
      leadTimeMinutes: 10,
      reminderTone: 'gentle_chime',
    });
    expect(normalized.remindFamilyBefore).toBe(true);
    expect(isRemindFamilyBeforeEnabled(normalized)).toBe(true);
  });

  it('honours explicit remindFamilyBefore when reminderEnabled differs', () => {
    const data = normalizeReminderData({
      title: 'x',
      scheduleMode: 'daily',
      times: ['08:00'],
      startDate: '2026-03-01',
      snoozeMinutes: 0,
      reminderEnabled: true,
      remindFamilyBefore: false,
      notifyFamilyOnMiss: true,
      leadTimeMinutes: 10,
      reminderTone: 'gentle_chime',
    });
    expect(isRemindFamilyBeforeEnabled(data)).toBe(false);
  });

  it('accepts legacy remindMeFamilyBefore on upsert payload', () => {
    const parsed = parseReminderData('medication', {
      title: 'x',
      scheduleMode: 'daily',
      times: ['08:00'],
      startDate: '2026-03-01',
      snoozeMinutes: 0,
      reminderEnabled: true,
      remindMeFamilyBefore: false,
      notifyFamilyOnMiss: true,
      leadTimeMinutes: 10,
      reminderTone: 'gentle_chime',
    });
    expect(parsed.remindFamilyBefore).toBe(false);
    expect('remindMeFamilyBefore' in parsed).toBe(false);
  });
});