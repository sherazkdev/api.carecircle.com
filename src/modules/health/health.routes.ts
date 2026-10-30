import { Router } from 'express';
import { getHealth, getLive, getReady } from './health.controller.js';

export const healthRouter = Router();

healthRouter.get('/health/live', getLive);
healthRouter.get('/health/ready', getReady);
healthRouter.get('/health', getHealth);
