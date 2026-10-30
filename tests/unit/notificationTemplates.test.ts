import { describe, expect, it } from 'vitest';
import {
  formatCircleTime,
  formatLeadTime,
  renderNotificationTemplate,
  truncateNotes,
} from '../../src/modules/notification/templates.js';
import type { NotificationType } from '../../src/shared/types/domain.js';

describe('Phase 7 notification templates', () => {
  const scheduledAt = new Date('2026-03-10T03:00:00.000Z'); // 08:00 Asia/Karachi

  it('formats circle timezone in 12-hour clock', () => {
    expect(formatCircleTime(scheduledAt, 'Asia/Karachi')).toBe('08:00 AM');
    expect(formatCircleTime(scheduledAt, 'UTC')).toBe('03:00 AM');
  });

  it('formats lead time including 1 hour for 60 minutes', () => {
    expect(formatLeadTime(10)).toBe('10 min');
    expect(formatLeadTime(5)).toBe('5 min');
    expect(formatLeadTime(60)).toBe('1 hour');
  });

  it('truncates update notes to 100 characters with ellipsis', () => {
    const long = 'a'.repeat(120);
    const out = truncateNotes(long);
    expect(out.endsWith('...')).toBe(true);
    expect(out.length).toBe(103);
  });

  it('renders all 11 Spec §9 templates', () => {
    const cases: Array<{
      type: NotificationType;
      title: string;
      bodyIncludes: string[];
    }> = [
      {
        type: 'med_before',
        title: 'Medication reminder',
        bodyIncludes: ['Paracetamol', '08:00 AM', '10 min'],
      },
      {
        type: 'med_due',
        title: 'Time for your medicine',
        bodyIncludes: ['Take Paracetamol now', '08:00 AM'],
      },
      {
        type: 'med_missed',
        title: 'Dose missed',
        bodyIncludes: ['Paracetamol', '08:00 AM', 'missed'],
      },
      {
        type: 'med_snooze',
        title: 'Dose still pending',
        bodyIncludes: ['Paracetamol', '08:00 AM', 'mark it as taken'],
      },
      {
        type: 'appt_before',
        title: 'Upcoming appointment',
        bodyIncludes: ['Checkup', '08:00 AM', '30 min'],
      },
      {
        type: 'appt_due',
        title: 'Appointment time',
        bodyIncludes: ['Checkup', 'starting now'],
      },
      {
        type: 'appt_missed',
        title: 'Appointment alert',
        bodyIncludes: ['Checkup', 'not marked as completed'],
      },
      {
        type: 'task_before',
        title: 'Task reminder',
        bodyIncludes: ['Refill', '08:00 AM', '5 min'],
      },
      {
        type: 'task_due',
        title: 'Task due now',
        bodyIncludes: ['Refill', 'due now'],
      },
      {
        type: 'task_missed',
        title: 'Task not completed',
        bodyIncludes: ['Refill', 'not marked as completed'],
      },
    ];

    for (const c of cases) {
      const lead =
        c.type === 'med_before'
          ? 10
          : c.type === 'appt_before'
            ? 30
            : c.type === 'task_before'
              ? 5
              : undefined;
      const itemTitle =
        c.type.startsWith('med')
          ? 'Paracetamol'
          : c.type.startsWith('appt')
            ? 'Checkup'
            : 'Refill';
      const rendered = renderNotificationTemplate({
        type: c.type as Exclude<NotificationType, 'update_new'>,
        itemTitle,
        scheduledAt,
        timezone: 'Asia/Karachi',
        ...(lead !== undefined ? { leadTimeMinutes: lead } : {}),
      });
      expect(rendered.title).toBe(c.title);
      for (const part of c.bodyIncludes) {
        expect(rendered.body).toContain(part);
      }
    }

    const update = renderNotificationTemplate({
      type: 'update_new',
      senderDisplayName: 'Sara Miller',
      notes: 'Mom is feeling better today.',
    });
    expect(update.title).toBe('Sara Miller shared an update');
    expect(update.body).toBe('Mom is feeling better today.');
  });
});
