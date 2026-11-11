/**
 * Local Docker scheduler smoke — plan a due reminder via reminder.service (no direct job inserts).
 * Run on host: npx tsx scripts/scheduler-docker-smoke.ts
 */
import { DateTime } from 'luxon';
import { connectMongo, disconnectMongo } from '../src/config/mongo.js';
import { configureDeliveryPort } from '../src/modules/notification/configureDelivery.js';
import { Circle } from '../src/modules/circle/circle.model.js';
import { Device } from '../src/modules/device/device.model.js';
import { Member } from '../src/modules/member/member.model.js';
import { upsertReminder } from '../src/modules/reminder/reminder.service.js';
import { Job } from '../src/scheduler/job.model.js';
import { ensureAllIndexes } from '../src/shared/db/ensureIndexes.js';
import { applyTestEnv } from '../tests/helpers/setupEnv.js';

const SMOKE_DB = 'care_circle_scheduler_smoke';
const CIRCLE_ID = 'smoke-circle-1';
const ITEM_ID = 'smoke-med-due';
const MONGO_URI =
  process.env.SMOKE_MONGODB_URI ?? `mongodb://127.0.0.1:27018/${SMOKE_DB}`;

function die(msg: string): never {
  console.error(`SMOKE_ABORT: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  applyTestEnv({
    NODE_ENV: 'development',
    PROCESS_MODE: 'api',
    DELIVERY_MODE: 'noop',
    MONGODB_URI: MONGO_URI,
  });

  await connectMongo(MONGO_URI);
  await ensureAllIndexes();
  configureDeliveryPort();

  const tz = 'Asia/Karachi';
  const dueLocal = DateTime.now().setZone(tz).plus({ minutes: 2 }).startOf('minute');
  const dueTime = dueLocal.toFormat('HH:mm');
  const startDate = dueLocal.toFormat('yyyy-MM-dd');

  await Circle.deleteMany({ circleId: CIRCLE_ID });
  await Member.deleteMany({ circleId: CIRCLE_ID });
  await Device.deleteMany({ circleId: CIRCLE_ID });
  await Job.deleteMany({ circleId: CIRCLE_ID });

  await Circle.create({ circleId: CIRCLE_ID, ownerUid: 'owner-smoke', timezone: tz });
  await Member.create({
    circleId: CIRCLE_ID,
    uid: 'owner-smoke',
    role: 'owner',
    displayName: 'Smoke Owner',
    prefs: { medication: true, appointment: true, task: true, updates: true },
  });
  await Device.create({
    circleId: CIRCLE_ID,
    uid: 'owner-smoke',
    fcmToken: 'smoke-fcm-token',
    platform: 'android',
  });

  await upsertReminder({
    circleId: CIRCLE_ID,
    module: 'medication',
    itemId: ITEM_ID,
    body: {
      title: 'Smoke med',
      scheduleMode: 'daily',
      times: [dueTime],
      startDate,
      reminderEnabled: true,
      notifyFamilyOnMiss: false,
      leadTimeMinutes: 5,
      snoozeMinutes: 0,
      reminderTone: 'gentle_chime',
    },
  });

  const dueJob = await Job.findOne({
    circleId: CIRCLE_ID,
    itemId: ITEM_ID,
    type: 'med_due',
    state: 'pending',
  }).lean();

  if (!dueJob) {
    die('no pending med_due job after upsertReminder');
  }

  const payload = {
    phase: 'planned',
    circleId: CIRCLE_ID,
    itemId: ITEM_ID,
    dedupeKey: dueJob.dedupeKey,
    state: dueJob.state,
    type: dueJob.type,
    fireAt: dueJob.fireAt.toISOString(),
    occurrenceKey: dueJob.occurrenceKey,
    waitUntilIso: dueJob.fireAt.toISOString(),
    mongoUriHost: '127.0.0.1:27018',
    database: SMOKE_DB,
  };
  console.log(JSON.stringify(payload, null, 2));

  await disconnectMongo();
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  die(message);
});
