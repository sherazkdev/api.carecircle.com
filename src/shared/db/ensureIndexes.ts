import { Circle } from '../../modules/circle/circle.model.js';
import { CircleCreateTokenNonce } from '../../modules/circle/circleCreateTokenNonce.model.js';
import { CircleInvite } from '../../modules/circle/circleInvite.model.js';
import { Completion } from '../../modules/completion/completion.model.js';
import { Device } from '../../modules/device/device.model.js';
import { Member } from '../../modules/member/member.model.js';
import { DeliveryAttempt } from '../../modules/notification/deliveryAttempt.model.js';
import { ReminderItem } from '../../modules/reminder/reminderItem.model.js';
import { UpdateOutbox } from '../../modules/update/updateOutbox.model.js';
import { Job } from '../../scheduler/job.model.js';

/** Creates/syncs all model indexes. Safe to call on startup. */
export async function ensureAllIndexes(): Promise<void> {
  await Promise.all([
    Circle.syncIndexes(),
    Member.syncIndexes(),
    Device.syncIndexes(),
    ReminderItem.syncIndexes(),
    Completion.syncIndexes(),
    Job.syncIndexes(),
    CircleCreateTokenNonce.syncIndexes(),
    CircleInvite.syncIndexes(),
    DeliveryAttempt.syncIndexes(),
    UpdateOutbox.syncIndexes(),
  ]);
}

export async function listCollectionIndexNames(collectionName: string): Promise<string[]> {
  const models = [
    Circle,
    Member,
    Device,
    ReminderItem,
    Completion,
    Job,
    CircleCreateTokenNonce,
    CircleInvite,
    DeliveryAttempt,
    UpdateOutbox,
  ] as const;
  const match = models.find((m) => m.collection.name === collectionName);
  if (!match) {
    throw new Error(`Unknown collection: ${collectionName}`);
  }
  const indexes = await match.collection.indexes();
  return indexes.map((idx) => idx.name).filter((name): name is string => Boolean(name));
}
