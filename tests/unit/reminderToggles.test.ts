import { describe, expect, it } from 'vitest';
import { isRemindMeFamilyBeforeEnabled, normalizeReminderData } from '../../src/modules/reminder/reminderToggles.js';

describe('reminder toggles', () => {
  it('defaults remindMeFamilyBefore from reminderEnabled', () => {
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
    expect(normalized.remindMeFamilyBefore).toBe(true);
    expect(isRemindMeFamilyBeforeEnabled(normalized)).toBe(true);
  });

  it('honours explicit remindMeFamilyBefore when reminderEnabled differs', () => {
    const data = normalizeReminderData({
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
    expect(isRemindMeFamilyBeforeEnabled(data)).toBe(false);
  });
});