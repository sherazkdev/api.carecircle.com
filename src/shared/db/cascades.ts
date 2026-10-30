import type { ClientSession } from 'mongoose';
import { Completion } from '../../modules/completion/completion.model.js';
import { Circle } from '../../modules/circle/circle.model.js';
import { CircleCreateTokenNonce } from '../../modules/circle/circleCreateTokenNonce.model.js';
import { CircleInvite } from '../../modules/circle/circleInvite.model.js';
import { Device } from '../../modules/device/device.model.js';
import { Member } from '../../modules/member/member.model.js';
import { DeliveryAttempt } from '../../modules/notification/deliveryAttempt.model.js';
import { ReminderItem } from '../../modules/reminder/reminderItem.model.js';
import { UpdateOutbox } from '../../modules/update/updateOutbox.model.js';
import { Job } from '../../scheduler/job.model.js';
import type { ReminderModule } from '../types/domain.js';

export type DeleteCounts = Record<string, number>;

function sessionOpts(session: ClientSession | null | undefined): { session: ClientSession } | Record<string, never> {
  return session ? { session } : {};
}

/**
 * Safe cascading deletion helpers.
 * Prefer ordered multi-collection deletes; wrap in a transaction when a replica set is available.
 */

export async function deleteReminderCascade(
  circleId: string,
  module: ReminderModule,
  itemId: string,
): Promise<DeleteCounts> {
  const [jobs, completions, items] = await Promise.all([
    Job.deleteMany({ circleId, itemId, module }),
    module === 'medication'
      ? Completion.deleteMany({ circleId, itemId })
      : Promise.resolve({ deletedCount: 0 }),
    ReminderItem.deleteOne({ circleId, module, itemId }),
  ]);

  return {
    jobs: jobs.deletedCount,
    completions: 'deletedCount' in completions ? completions.deletedCount : 0,
    reminderItems: items.deletedCount,
  };
}

/** On upsert: remove unfinished jobs so planner can recreate future ones. Completions preserved. */
export async function deleteUnfinishedJobsForItem(
  circleId: string,
  itemId: string,
  module?: ReminderModule,
): Promise<number> {
  const filter: Record<string, unknown> = {
    circleId,
    itemId,
    state: { $in: ['pending', 'claimed', 'failed'] },
  };
  if (module) {
    filter['module'] = module;
  }
  const result = await Job.deleteMany(filter);
  return result.deletedCount;
}

export async function removeMemberFromCircle(
  circleId: string,
  uid: string,
  session: ClientSession | null = null,
): Promise<DeleteCounts> {
  const o = sessionOpts(session);
  const [devices, members] = await Promise.all([
    Device.deleteMany({ circleId, uid }, o),
    Member.deleteOne({ circleId, uid }, o),
  ]);
  return {
    devices: devices.deletedCount,
    members: members.deletedCount,
  };
}

export async function deleteCircleCascade(
  circleId: string,
  session: ClientSession | null = null,
): Promise<DeleteCounts> {
  const o = sessionOpts(session);

  const jobs = await Job.deleteMany({ circleId }, o);
  const completions = await Completion.deleteMany({ circleId }, o);
  const reminders = await ReminderItem.deleteMany({ circleId }, o);
  const devices = await Device.deleteMany({ circleId }, o);
  const members = await Member.deleteMany({ circleId }, o);
  const deliveryAttempts = await DeliveryAttempt.deleteMany({ circleId }, o);
  const updates = await UpdateOutbox.deleteMany({ circleId }, o);
  const invites = await CircleInvite.deleteMany({ circleId }, o);
  const createNonces = await CircleCreateTokenNonce.deleteMany({ circleId }, o);
  const circle = await Circle.deleteOne({ circleId }, o);

  return {
    jobs: jobs.deletedCount,
    completions: completions.deletedCount,
    reminderItems: reminders.deletedCount,
    devices: devices.deletedCount,
    members: members.deletedCount,
    deliveryAttempts: deliveryAttempts.deletedCount,
    updateOutbox: updates.deletedCount,
    invites: invites.deletedCount,
    createTokenNonces: createNonces.deletedCount,
    circles: circle.deletedCount,
  };
}
