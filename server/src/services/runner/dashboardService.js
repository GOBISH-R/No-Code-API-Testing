import mongoose from 'mongoose';
import { TestRun } from '../../models/TestRun.js';
import { owned } from '../owned.js';
import { listTestRuns } from './testRunService.js';

const RECENT_LIMIT = 10;
const TREND_DAYS = 14;

function matchStage(collectionId) {
  return collectionId ? { collectionId: new mongoose.Types.ObjectId(collectionId) } : {};
}

async function getStatusCounts(ownerId, match) {
  const rows = await owned(TestRun, ownerId).aggregate([
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const counts = { passed: 0, failed: 0, error: 0 };
  for (const row of rows) counts[row._id] = row.count;
  return counts;
}

// Averages response time across every successful step of every matched run —
// unwinding the embedded results array rather than pulling full documents into Node.
async function getAverageResponseTime(ownerId, match) {
  const [row] = await owned(TestRun, ownerId).aggregate([
    { $match: match },
    { $unwind: '$results' },
    { $match: { 'results.success': true } },
    { $group: { _id: null, avg: { $avg: '$results.response.time' } } },
  ]);
  return row ? Math.round(row.avg) : null;
}

// Backfills days with zero runs so the trend always covers a fixed TREND_DAYS-day
// window — a quiet day is meaningful (a gap), not just an absent group.
function backfillDays(rows) {
  const byDate = new Map(rows.map((r) => [r._id, r]));
  const days = [];
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const row = byDate.get(date);
    days.push({ date, passed: row?.passed || 0, failed: row?.failed || 0, error: row?.error || 0 });
  }
  return days;
}

async function getTrend(ownerId, match) {
  const since = new Date(Date.now() - TREND_DAYS * 24 * 60 * 60 * 1000);
  const rows = await owned(TestRun, ownerId).aggregate([
    { $match: { ...match, startedAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt' } },
        passed: { $sum: { $cond: [{ $eq: ['$status', 'passed'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        error: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
      },
    },
  ]);
  return backfillDays(rows);
}

/**
 * Reads stored TestRun data only — deliberately never triggers execution itself.
 *
 * Every aggregation here goes through owned(), which forces `{ $match: { userId } }`
 * in as the *first* stage. First matters: a $match after a $group would filter numbers
 * that had already been averaged across every account in the database.
 */
export async function getDashboardSummary(ownerId, { collectionId } = {}) {
  const match = matchStage(collectionId);

  const [counts, averageResponseTimeMs, recentRuns, trend] = await Promise.all([
    getStatusCounts(ownerId, match),
    getAverageResponseTime(ownerId, match),
    listTestRuns(ownerId, { collectionId, limit: RECENT_LIMIT }),
    getTrend(ownerId, match),
  ]);

  const totalRuns = counts.passed + counts.failed + counts.error;

  return {
    totalRuns,
    passed: counts.passed,
    failed: counts.failed,
    error: counts.error,
    passRate: totalRuns > 0 ? counts.passed / totalRuns : null,
    averageResponseTimeMs,
    recentRuns,
    trend,
  };
}
