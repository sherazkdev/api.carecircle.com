import type { RequestHandler } from 'express';
import {
  getFirebaseLastError,
  getFirebaseStatus,
  isFirebaseInitialized,
} from '../../config/firebase.js';
import { getMongoLastError, getMongoStatus } from '../../config/mongo.js';
import { sendError, sendOk } from '../../shared/utils/response.js';

/** Liveness: process is up. Does not check dependencies. */
export const getLive: RequestHandler = (_req, res) => {
  sendOk(res, {
    status: 'live' as const,
    uptimeSeconds: Math.floor(process.uptime()),
  });
};

function readinessPayload() {
  const mongo = getMongoStatus();
  const firebase = getFirebaseStatus();
  const mongoUp = mongo === 'connected';
  const firebaseUp = firebase === 'up' && isFirebaseInitialized();
  const ready = mongoUp && firebaseUp;

  return {
    ready,
    data: {
      status: ready ? ('ready' as const) : ('not_ready' as const),
      mongo: mongoUp ? ('up' as const) : ('down' as const),
      firebase: firebaseUp ? ('up' as const) : ('down' as const),
      uptimeSeconds: Math.floor(process.uptime()),
      details: {
        mongoState: mongo,
        mongoError: getMongoLastError(),
        firebaseState: firebase,
        firebaseError: getFirebaseLastError(),
      },
    },
  };
}

/** Readiness: Mongo + Firebase usable for serving / claiming work. */
export const getReady: RequestHandler = (_req, res) => {
  const { ready, data } = readinessPayload();
  if (!ready) {
    sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Service is not ready', data);
    return;
  }
  sendOk(res, data);
};

/**
 * Combined health (backward compatible).
 * Same dependency gates as /ready; includes legacy `status: ok|degraded`.
 */
export const getHealth: RequestHandler = (_req, res) => {
  const { ready, data } = readinessPayload();
  const payload = {
    ...data,
    status: ready ? ('ok' as const) : ('degraded' as const),
  };

  if (!ready) {
    sendError(res, 503, 'SERVICE_UNAVAILABLE', 'One or more dependencies are unavailable', payload);
    return;
  }

  sendOk(res, payload);
};
