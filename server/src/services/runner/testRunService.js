import { TestRun } from '../../models/TestRun.js';
import { owned } from '../owned.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * History list: summaries only (no embedded per-step results), so browsing runs stays
 * light once there are many. Full detail is a separate lookup.
 */
export async function listTestRuns(ownerId, { collectionId, monitorId, limit } = {}) {
  const filter = {};
  if (collectionId) filter.collectionId = collectionId;
  if (monitorId) filter.monitorId = monitorId;

  const cappedLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  return owned(TestRun, ownerId)
    .find(filter)
    .select('-results')
    .sort({ startedAt: -1 })
    .limit(cappedLimit)
    .lean();
}

export async function getTestRun(ownerId, id) {
  return owned(TestRun, ownerId).byId(id).lean();
}
