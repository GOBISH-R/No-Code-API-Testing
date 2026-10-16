import { JSONPath } from 'jsonpath-plus';

/**
 * Deciding *which* incoming message a test is waiting for.
 *
 * A WebSocket connection is chatty: heartbeats, unrelated broadcasts and the reply you
 * actually care about all arrive on the same stream. Asserting on "the next message"
 * alone would make tests depend on traffic they have nothing to do with, so a wait
 * declares what it is looking for and ignores everything else.
 */

export const STRATEGIES = {
  // First message of any kind.
  NEXT: 'next',
  CONTAINS: 'contains',
  EQUALS: 'equals',
  JSON_PATH: 'jsonPath',
  TYPE: 'type',
  // Expect an ordered run of messages.
  SEQUENCE: 'sequence',
  // Expect *nothing* to arrive — how you prove an unsubscribe worked.
  SILENCE: 'silence',
};

export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_TIMEOUT_MS = 60_000;

function parsePayload(message) {
  if (!message || message.type !== 'json') return undefined;
  try {
    return JSON.parse(message.payload);
  } catch {
    return undefined;
  }
}

function jsonPathMatches(message, condition) {
  const json = parsePayload(message);
  if (json === undefined) return false;

  let matches;
  try {
    matches = JSONPath({ path: condition.path, json, wrap: true });
  } catch {
    return false;
  }

  if (matches.length === 0) return false;
  // With no expected value the test is "this field exists".
  if (condition.value === undefined || condition.value === '') return true;

  return matches.some((m) => String(m) === String(condition.value));
}

/**
 * Does one message satisfy one condition? Pure, so every strategy is testable without
 * timers or sockets.
 */
export function matchesCondition(message, condition = {}) {
  if (!message) return false;
  // Lifecycle entries are not traffic — a wait must never be satisfied by "Connected".
  if (message.direction === 'system') return false;

  const payload = message.payload ?? '';

  switch (condition.strategy) {
    case STRATEGIES.NEXT:
      return true;
    case STRATEGIES.CONTAINS:
      return String(payload).includes(String(condition.value ?? ''));
    case STRATEGIES.EQUALS:
      return String(payload) === String(condition.value ?? '');
    case STRATEGIES.TYPE:
      return message.type === condition.value;
    case STRATEGIES.JSON_PATH:
      return jsonPathMatches(message, condition);
    default:
      return false;
  }
}

export function normalizeTimeout(timeoutMs) {
  const value = Number(timeoutMs);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS;
  // A runner step must never be able to hang; an over-long wait is clamped, not honoured.
  return Math.min(value, MAX_TIMEOUT_MS);
}

/**
 * Accumulates messages until a condition is satisfied.
 *
 * Kept separate from any transport so the same logic serves a live socket, the
 * Collection Runner and tests. `offer` reports whether the wait is finished; the
 * caller supplies the timing.
 */
export function createWaiter(condition = {}) {
  const strategy = condition.strategy || STRATEGIES.NEXT;
  const sequence = Array.isArray(condition.sequence) ? condition.sequence : [];

  const state = {
    strategy,
    done: false,
    matched: null,
    // Every non-system message seen while waiting — useful context in a failure report.
    seen: [],
    sequenceIndex: 0,
    matchedSequence: [],
  };

  function offer(message) {
    if (state.done || !message || message.direction === 'system') return { ...state };

    state.seen.push(message);

    if (strategy === STRATEGIES.SILENCE) {
      // Any traffic at all fails this wait immediately — no need to burn the timeout.
      state.done = true;
      state.matched = message;
      return { ...state };
    }

    if (strategy === STRATEGIES.SEQUENCE) {
      const expected = sequence[state.sequenceIndex];
      if (expected && matchesCondition(message, expected)) {
        state.matchedSequence.push(message);
        state.sequenceIndex += 1;
        if (state.sequenceIndex >= sequence.length) {
          state.done = true;
          state.matched = message;
        }
      }
      return { ...state };
    }

    if (matchesCondition(message, { ...condition, strategy })) {
      state.done = true;
      state.matched = message;
    }

    return { ...state };
  }

  // Called when the timeout expires: silence *wants* to time out, everything else fails.
  function settleOnTimeout() {
    if (strategy === STRATEGIES.SILENCE) {
      return { satisfied: !state.done, timedOut: true, ...state };
    }
    return { satisfied: false, timedOut: true, ...state };
  }

  function result() {
    if (strategy === STRATEGIES.SILENCE) {
      // Silence can only be *disproved* early; it is confirmed by the clock running out,
      // never before. Reporting it as satisfied up front would let the caller resolve on
      // its first poll — which is to say, never actually wait.
      return { satisfied: false, failedEarly: state.done, timedOut: false, ...state };
    }
    return { satisfied: state.done, timedOut: false, ...state };
  }

  return { offer, settleOnTimeout, result, state };
}

// Human-readable description of what a wait was looking for, for failure messages.
export function describeCondition(condition = {}) {
  switch (condition.strategy) {
    case STRATEGIES.CONTAINS:
      return `a message containing "${condition.value}"`;
    case STRATEGIES.EQUALS:
      return `a message equal to "${condition.value}"`;
    case STRATEGIES.TYPE:
      return `a ${condition.value} message`;
    case STRATEGIES.JSON_PATH:
      return condition.value
        ? `a message where ${condition.path} = ${condition.value}`
        : `a message containing ${condition.path}`;
    case STRATEGIES.SEQUENCE:
      return `${(condition.sequence || []).length} messages in order`;
    case STRATEGIES.SILENCE:
      return 'no messages';
    default:
      return 'any message';
  }
}
