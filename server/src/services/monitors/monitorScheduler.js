import mongoose from 'mongoose';
import { Monitor } from '../../models/Monitor.js';
import { executeMonitor, unlockedFilter, RUN_LOCK_MS } from './monitorService.js';

/** How often the scheduler looks for due monitors. A run starts at most this late. */
const TICK_MS = 30 * 1000;

/**
 * Monitor runs this server instance performs at once, across all accounts. Each run is
 * sequential outbound HTTP for up to five minutes, so a handful at a time is plenty —
 * and the runner's own per-account gate still applies inside each one.
 */
const MAX_PARALLEL_RUNS = 4;

const dueFilter = (now) => ({ enabled: true, nextRunAt: { $lte: now }, ...unlockedFilter(now) });

/**
 * Claims the most overdue monitor, if there is one.
 *
 * This is the one place that reads monitors across accounts, and it is deliberately
 * narrow: it finds a due monitor, then claims it with a conditional update that only
 * succeeds if nobody else claimed it first — safe with several server instances. Claiming
 * advances nextRunAt at once, so a slow run is never picked up a second time. Everything
 * after the claim runs as the monitor's owner, through owned().
 */
export async function claimNextDue(now = new Date()) {
  const candidate = await Monitor.findOne(dueFilter(now)).sort({ nextRunAt: 1 }).select('_id intervalMinutes').lean();
  if (!candidate) return null;

  return Monitor.findOneAndUpdate(
    { _id: candidate._id, ...dueFilter(now) },
    {
      $set: {
        lockedUntil: new Date(now.getTime() + RUN_LOCK_MS),
        nextRunAt: new Date(now.getTime() + candidate.intervalMinutes * 60 * 1000),
      },
    },
    { returnDocument: 'after' },
  ).lean();
}

/**
 * Starts the schedule. Each tick claims due monitors while a run slot is free; runs that
 * outlast a tick simply keep their slot, so ticks never pile up or overlap.
 *
 * @returns {() => void} stops the schedule (in-flight runs finish on their own)
 */
export function startMonitorScheduler({ tickMs = TICK_MS, maxParallel = MAX_PARALLEL_RUNS } = {}) {
  let inFlight = 0;
  let claiming = false;

  const tick = async () => {
    if (claiming || mongoose.connection.readyState !== 1) return;
    claiming = true;
    try {
      while (inFlight < maxParallel) {
        const monitor = await claimNextDue();
        if (!monitor) break;
        inFlight += 1;
        executeMonitor(monitor)
          .catch((err) => console.warn(`[monitors] Could not record a monitor run: ${err.message}`))
          .finally(() => {
            inFlight -= 1;
          });
      }
    } catch (err) {
      console.warn(`[monitors] Scheduler tick failed: ${err.message}`);
    } finally {
      claiming = false;
    }
  };

  tick();
  const timer = setInterval(tick, tickMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
