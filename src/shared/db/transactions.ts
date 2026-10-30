import mongoose, { type ClientSession } from 'mongoose';
import { getLogger } from '../../config/logger.js';

export type TransactionalResult<T> = T & {
  /** True when MongoDB multi-document transaction committed. */
  transactional: boolean;
};

function isTransactionUnsupported(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const e = err as { code?: number; codeName?: string; message?: string };
  const message = e.message ?? '';
  return (
    e.code === 20 ||
    e.codeName === 'IllegalOperation' ||
    /transaction numbers are only allowed/i.test(message) ||
    /replica set member/i.test(message) ||
    /transactions are not supported/i.test(message) ||
    /Transaction numbers/i.test(message)
  );
}

/**
 * Run work in a MongoDB transaction when the deployment supports it.
 * On standalone / transaction-unavailable environments, falls back to non-atomic
 * ordered deletes and sets `transactional: false` — never silently claims atomicity.
 */
export async function runWithOptionalTransaction<T extends Record<string, unknown>>(
  work: (session: ClientSession | null) => Promise<T>,
): Promise<TransactionalResult<T>> {
  const logger = getLogger();
  const session = await mongoose.startSession();

  let started = false;
  try {
    try {
      session.startTransaction();
      started = true;
    } catch (err) {
      if (isTransactionUnsupported(err)) {
        logger.warn(
          { err: { message: err instanceof Error ? err.message : 'unknown' } },
          'MongoDB transactions unavailable at start — ordered non-atomic fallback',
        );
        await session.endSession();
        const result = await work(null);
        return { ...result, transactional: false };
      }
      throw err;
    }

    const result = await work(session);
    await session.commitTransaction();
    return { ...result, transactional: true };
  } catch (err) {
    if (started) {
      try {
        await session.abortTransaction();
      } catch {
        // ignore abort errors
      }
    }
    if (isTransactionUnsupported(err)) {
      logger.warn(
        { err: { message: err instanceof Error ? err.message : 'unknown' } },
        'MongoDB transactions unavailable — falling back to ordered non-atomic deletes',
      );
      try {
        await session.endSession();
      } catch {
        // ignore
      }
      const result = await work(null);
      return { ...result, transactional: false };
    }
    throw err;
  } finally {
    try {
      await session.endSession();
    } catch {
      // already ended on fallback path
    }
  }
}
