import { Monitor } from '../../models/Monitor.js';
import { Collection } from '../../models/Collection.js';
import { Environment } from '../../models/Environment.js';
import { TestRun } from '../../models/TestRun.js';
import { owned } from '../owned.js';
import { runCollection } from '../runner/collectionRunner.js';
import { loadBaseVariables } from '../variables/variableContext.js';
import { ValidationError, TooBusyError } from '../../utils/errors.js';
import { encryptField, decryptField } from '../security/fieldCrypto.js';
import { sendMonitorAlert } from './monitorAlerts.js';

/** Monitors one account may have. Each can run as often as every 5 minutes. */
export const MAX_MONITORS_PER_ACCOUNT = 5;

/** Runs kept per monitor. Every 5 minutes is 288 a day, so older ones are trimmed. */
export const RUNS_KEPT_PER_MONITOR = 100;

/**
 * How long a run holds its monitor. Longer than the runner's 5-minute budget, so a live
 * run is never claimed twice; short enough that a crash mid-run frees it soon after.
 */
export const RUN_LOCK_MS = 7 * 60 * 1000;

const minutes = (n) => n * 60 * 1000;

// Free to claim: not locked, or locked by a run that must have died.
export const unlockedFilter = (now) => ({ $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] });

async function assertTargets(ownerId, { collectionId, environmentId }) {
  if (collectionId !== undefined && !(await owned(Collection, ownerId).byId(collectionId).select('_id').lean())) {
    throw new ValidationError('That collection does not exist.');
  }
  if (environmentId && !(await owned(Environment, ownerId).byId(environmentId).select('_id').lean())) {
    throw new ValidationError('That environment does not exist.');
  }
}

// The lock is a server detail; the UI only needs to know whether a run is going. The
// webhook URL is decrypted for the people who can see the monitor, so they can edit it.
function present(monitor, now = new Date()) {
  if (!monitor) return monitor;
  const { lockedUntil, alertWebhookUrl, ...rest } = monitor;
  return {
    ...rest,
    alertWebhookUrl: alertWebhookUrl ? decryptField(alertWebhookUrl) : '',
    running: Boolean(lockedUntil && lockedUntil > now),
  };
}

// Status values that count as "not passing" for alerts. A skipped run says nothing
// about the API under test, so it changes nothing.
const FAILING = new Set(['failed', 'error']);

export async function listMonitors(ownerId) {
  const list = await owned(Monitor, ownerId).find().sort({ createdAt: 1 }).lean();
  return list.map((m) => present(m));
}

/** @param createdBy the person creating it — alert emails go to them. */
export async function createMonitor(ownerId, payload, createdBy = null) {
  const count = await owned(Monitor, ownerId).countDocuments();
  if (count >= MAX_MONITORS_PER_ACCOUNT) {
    throw new ValidationError(`You can have up to ${MAX_MONITORS_PER_ACCOUNT} monitors. Delete one to add another.`);
  }
  await assertTargets(ownerId, payload);

  const monitor = await owned(Monitor, ownerId).create({
    name: payload.name,
    collectionId: payload.collectionId,
    environmentId: payload.environmentId || null,
    intervalMinutes: payload.intervalMinutes,
    enabled: payload.enabled ?? true,
    createdBy,
    alertEmail: payload.alertEmail ?? true,
    alertWebhookUrl: payload.alertWebhookUrl ? encryptField(payload.alertWebhookUrl) : '',
    // Runs at once, so the first result shows up while the person is still looking.
    nextRunAt: new Date(),
  });
  return present(monitor.toObject());
}

export async function updateMonitor(ownerId, id, payload) {
  const current = await owned(Monitor, ownerId).byId(id).lean();
  if (!current) return null;
  await assertTargets(ownerId, payload);

  const update = {};
  for (const field of ['name', 'collectionId', 'intervalMinutes', 'enabled', 'alertEmail']) {
    if (payload[field] !== undefined) update[field] = payload[field];
  }
  if (payload.environmentId !== undefined) update.environmentId = payload.environmentId || null;
  if (payload.alertWebhookUrl !== undefined) {
    update.alertWebhookUrl = payload.alertWebhookUrl ? encryptField(payload.alertWebhookUrl) : '';
  }

  const now = Date.now();
  if (payload.enabled === true && !current.enabled) {
    // Resuming runs straight away rather than waiting out a whole interval.
    update.nextRunAt = new Date(now);
  } else if (payload.intervalMinutes !== undefined && payload.intervalMinutes !== current.intervalMinutes) {
    // The new interval counts from the last run, or from now if it never ran.
    const from = current.lastRunAt ? new Date(current.lastRunAt).getTime() : now;
    update.nextRunAt = new Date(Math.max(now, from + minutes(payload.intervalMinutes)));
  }

  return present(await owned(Monitor, ownerId).updateById(id, { $set: update }).lean());
}

export async function deleteMonitor(ownerId, id) {
  // Its runs stay in Runs and on the Dashboard: they are a record of what happened.
  return owned(Monitor, ownerId).deleteById(id);
}

async function trimRuns(ownerId, monitorId) {
  const overflow = await owned(TestRun, ownerId)
    .find({ monitorId })
    .sort({ startedAt: -1 })
    .skip(RUNS_KEPT_PER_MONITOR)
    .select('_id')
    .lean();
  if (overflow.length > 0) {
    await owned(TestRun, ownerId).deleteMany({ _id: { $in: overflow.map((r) => r._id) } });
  }
}

/**
 * Runs one monitor's collection as its owner and records the outcome on the monitor.
 *
 * The caller has already claimed it (set lockedUntil). Never throws: whatever happens
 * becomes the monitor's last status, and the lock is always released.
 */
export async function executeMonitor(monitor) {
  const ownerId = monitor.userId;
  const started = Date.now();
  let outcome;
  let run = null;

  try {
    const variables = await loadBaseVariables(ownerId, monitor.environmentId);
    run = await runCollection(ownerId, monitor.collectionId, {
      environmentId: monitor.environmentId,
      variables,
      monitor,
    });
    if (!run) {
      outcome = {
        enabled: false,
        lastStatus: 'error',
        lastError: 'Its collection no longer exists, so the monitor was paused.',
        lastRunId: null,
      };
    } else {
      outcome = { lastStatus: run.status, lastError: null, lastRunId: run._id };
    }
  } catch (err) {
    if (err instanceof TooBusyError) {
      outcome = { lastStatus: 'skipped', lastError: `Skipped: ${err.message}`, lastRunId: null };
    } else if (err instanceof ValidationError) {
      outcome = { lastStatus: 'error', lastError: err.message, lastRunId: null };
    } else {
      // The message stays in the server log; the owner sees something they can act on.
      console.warn(`[monitors] A monitor run failed: ${err.message}`);
      outcome = { lastStatus: 'error', lastError: 'The run failed unexpectedly. It will try again.', lastRunId: null };
    }
  }

  // Alert on a change of state only: passing → failing, or failing → passing.
  const wasFailing = monitor.alertState === 'failing';
  let alertState = monitor.alertState || 'ok';
  let event = null;
  if (FAILING.has(outcome.lastStatus) && !wasFailing) {
    alertState = 'failing';
    event = 'failed';
  } else if (outcome.lastStatus === 'passed' && wasFailing) {
    alertState = 'ok';
    event = 'recovered';
  }

  const updated = await owned(Monitor, ownerId)
    .updateById(monitor._id, {
      $set: {
        ...outcome,
        alertState,
        lastRunAt: new Date(started),
        lastDurationMs: Date.now() - started,
        lockedUntil: null,
      },
    })
    .lean();

  // Deleted while it ran (or its workspace was): the run it just recorded belongs to
  // nothing anyone can open, so it goes too instead of lingering as an orphan.
  if (!updated) {
    if (outcome.lastRunId) await owned(TestRun, ownerId).deleteById(outcome.lastRunId);
    return null;
  }
  if (outcome.lastRunId) await trimRuns(ownerId, monitor._id);
  // A run that never started (deleted environment, missing collection) still alerts: the
  // monitor is not doing its job, and someone should know. The error is the failure line.
  if (event) {
    const runForAlert = run ?? {
      results: [{ requestName: monitor.name, success: false, error: outcome.lastError }],
    };
    await sendMonitorAlert({ monitor: updated, event, run: runForAlert });
  }
  return present(updated);
}

/**
 * Sends a test alert by every channel the monitor has on, and reports how each went —
 * so a webhook URL can be checked without waiting for something to break.
 */
export async function sendTestAlert(ownerId, id) {
  const monitor = await owned(Monitor, ownerId).byId(id).lean();
  if (!monitor) return null;
  if (!monitor.alertEmail && !monitor.alertWebhookUrl) {
    throw new ValidationError('Turn on email alerts or add a webhook URL first.');
  }
  const collection = await owned(Collection, ownerId).byId(monitor.collectionId).select('name').lean();
  const sample = {
    status: 'failed',
    results: [
      { method: 'GET', requestName: 'Example request', success: true, assertions: { allPassed: false, results: [{ pass: false, label: 'Status code equals 200' }] } },
    ],
  };
  return sendMonitorAlert({ monitor, event: 'test', run: sample, collectionName: collection?.name ?? '' });
}

/**
 * "Run now": claims the monitor the same way the scheduler does, so a manual run and a
 * scheduled one can never overlap, then runs it and returns the updated monitor.
 */
export async function runMonitorNow(ownerId, id) {
  const existing = await owned(Monitor, ownerId).byId(id).select('intervalMinutes enabled').lean();
  if (!existing) return null;

  const now = new Date();
  const claimed = await owned(Monitor, ownerId)
    .findOneAndUpdate(
      { _id: id, ...unlockedFilter(now) },
      {
        $set: {
          lockedUntil: new Date(now.getTime() + RUN_LOCK_MS),
          // A manual run restarts the schedule, as a scheduled one does — otherwise a
          // monitor that was due would run again moments after this.
          ...(existing.enabled ? { nextRunAt: new Date(now.getTime() + minutes(existing.intervalMinutes)) } : {}),
        },
      },
      { returnDocument: 'after' },
    )
    .lean();

  if (!claimed) throw new TooBusyError('This monitor is already running. Wait for it to finish.');
  return executeMonitor(claimed);
}
