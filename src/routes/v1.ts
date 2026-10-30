import { Router } from 'express';
import { circleRouter } from '../modules/circle/circle.routes.js';
import { inviteRouter } from '../modules/circle/invite.routes.js';
import { issuerRouter } from '../modules/circle/issuer.routes.js';
import { deviceRouter } from '../modules/device/device.routes.js';
import { accountRouter } from '../modules/member/account.routes.js';
import { memberRouter } from '../modules/member/member.routes.js';
import { reminderRouter } from '../modules/reminder/reminder.routes.js';
import { updateRouter } from '../modules/update/update.routes.js';

export const v1Router = Router();

v1Router.use('/internal', issuerRouter);
v1Router.use('/circles/:circleId/devices', deviceRouter);
v1Router.use('/circles/:circleId/members', memberRouter);
v1Router.use('/circles/:circleId/reminders', reminderRouter);
v1Router.use('/circles/:circleId/updates', updateRouter);
v1Router.use('/circles/:circleId', inviteRouter);
v1Router.use('/circles/:circleId', circleRouter);
v1Router.use('/members', accountRouter);
