import { TooBusyError } from './errors.js';

/**
 * Bounds how much long-running work runs at once, per account and in total.
 *
 * A collection run can hold the event loop's attention for minutes of outbound calls.
 * Without a per-account cap, one person clicking Run repeatedly (or a script doing it)
 * starves everyone else; without a total cap, enough people doing it at once exhausts
 * sockets and memory. Refusing immediately is deliberate — queueing would hide the
 * overload behind a spinner until the browser gave up anyway.
 *
 * In-process by design: it protects this server instance. Horizontal scaling gives each
 * instance its own gate, which is the right unit for what it protects.
 */
export function createConcurrencyGate({ perKey, total, label = 'task' }) {
  const active = new Map();
  let running = 0;

  return {
    acquire(key) {
      const k = String(key);
      const mine = active.get(k) || 0;
      if (mine >= perKey) {
        throw new TooBusyError(
          `You already have ${mine} ${label}${mine === 1 ? '' : 's'} in progress. Wait for one to finish.`,
        );
      }
      if (running >= total) {
        throw new TooBusyError(`The server is busy with other ${label}s right now. Try again in a moment.`);
      }

      active.set(k, mine + 1);
      running += 1;

      let released = false;
      // Idempotent, so a finally block and an error path can both call it safely.
      return () => {
        if (released) return;
        released = true;
        running -= 1;
        const left = (active.get(k) || 1) - 1;
        if (left > 0) active.set(k, left);
        else active.delete(k);
      };
    },
    inUse(key) {
      return key === undefined ? running : active.get(String(key)) || 0;
    },
  };
}
