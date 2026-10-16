import { describe, it, expect } from 'vitest';
import {
  matchesCondition,
  createWaiter,
  normalizeTimeout,
  describeCondition,
  STRATEGIES,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
} from '../../src/services/websocket/waitEngine.js';

const msg = (payload, type = 'text', direction = 'received') => ({
  id: Math.random().toString(36),
  direction,
  type,
  payload,
  size: payload.length,
  timestamp: Date.now(),
});

const json = (obj) => msg(JSON.stringify(obj), 'json');

describe('matchesCondition — strategies', () => {
  it('next matches any traffic', () => {
    expect(matchesCondition(msg('anything'), { strategy: STRATEGIES.NEXT })).toBe(true);
  });

  it('never matches a system/lifecycle entry', () => {
    // "Connected" must not satisfy a wait for a reply.
    expect(matchesCondition(msg('Connected', 'text', 'system'), { strategy: STRATEGIES.NEXT })).toBe(false);
  });

  it('contains matches a substring', () => {
    expect(matchesCondition(msg('hello world'), { strategy: STRATEGIES.CONTAINS, value: 'world' })).toBe(true);
    expect(matchesCondition(msg('hello'), { strategy: STRATEGIES.CONTAINS, value: 'world' })).toBe(false);
  });

  it('equals requires the whole payload', () => {
    expect(matchesCondition(msg('pong'), { strategy: STRATEGIES.EQUALS, value: 'pong' })).toBe(true);
    expect(matchesCondition(msg('pong!'), { strategy: STRATEGIES.EQUALS, value: 'pong' })).toBe(false);
  });

  it('type matches the detected message type', () => {
    expect(matchesCondition(json({ a: 1 }), { strategy: STRATEGIES.TYPE, value: 'json' })).toBe(true);
    expect(matchesCondition(msg('plain'), { strategy: STRATEGIES.TYPE, value: 'json' })).toBe(false);
  });
});

describe('matchesCondition — jsonPath', () => {
  it('matches on a field existing', () => {
    expect(
      matchesCondition(json({ type: 'user.created' }), { strategy: STRATEGIES.JSON_PATH, path: '$.type' }),
    ).toBe(true);
  });

  it('matches on a field value', () => {
    const condition = { strategy: STRATEGIES.JSON_PATH, path: '$.type', value: 'user.created' };
    expect(matchesCondition(json({ type: 'user.created' }), condition)).toBe(true);
    expect(matchesCondition(json({ type: 'user.deleted' }), condition)).toBe(false);
  });

  it('reads nested fields', () => {
    expect(
      matchesCondition(json({ data: { user: { id: 7 } } }), {
        strategy: STRATEGIES.JSON_PATH,
        path: '$.data.user.id',
        value: '7',
      }),
    ).toBe(true);
  });

  it('does not match a text message', () => {
    expect(matchesCondition(msg('not json'), { strategy: STRATEGIES.JSON_PATH, path: '$.a' })).toBe(false);
  });

  it('never throws on a malformed JSONPath', () => {
    expect(() => matchesCondition(json({ a: 1 }), { strategy: STRATEGIES.JSON_PATH, path: '$[[[' })).not.toThrow();
  });
});

describe('createWaiter — single match', () => {
  it('resolves on the first matching message and ignores unrelated traffic', () => {
    // The point of waits: heartbeats and broadcasts must not satisfy the test.
    const waiter = createWaiter({ strategy: STRATEGIES.JSON_PATH, path: '$.type', value: 'ready' });

    waiter.offer(json({ type: 'heartbeat' }));
    waiter.offer(msg('unrelated broadcast'));
    expect(waiter.result().satisfied).toBe(false);

    waiter.offer(json({ type: 'ready' }));
    const result = waiter.result();
    expect(result.satisfied).toBe(true);
    expect(JSON.parse(result.matched.payload).type).toBe('ready');
  });

  it('records everything seen while waiting, for failure reports', () => {
    const waiter = createWaiter({ strategy: STRATEGIES.CONTAINS, value: 'never' });
    waiter.offer(msg('a'));
    waiter.offer(msg('b'));
    expect(waiter.result().seen).toHaveLength(2);
  });

  it('fails on timeout when nothing matched', () => {
    const waiter = createWaiter({ strategy: STRATEGIES.CONTAINS, value: 'nope' });
    waiter.offer(msg('something else'));
    const settled = waiter.settleOnTimeout();
    expect(settled.satisfied).toBe(false);
    expect(settled.timedOut).toBe(true);
  });
});

describe('createWaiter — ordered sequence', () => {
  const sequence = [
    { strategy: STRATEGIES.JSON_PATH, path: '$.type', value: 'ack' },
    { strategy: STRATEGIES.JSON_PATH, path: '$.type', value: 'data' },
    { strategy: STRATEGIES.JSON_PATH, path: '$.type', value: 'complete' },
  ];

  it('is satisfied only once every step matches in order', () => {
    const waiter = createWaiter({ strategy: STRATEGIES.SEQUENCE, sequence });

    waiter.offer(json({ type: 'ack' }));
    expect(waiter.result().satisfied).toBe(false);
    waiter.offer(json({ type: 'data' }));
    expect(waiter.result().satisfied).toBe(false);
    waiter.offer(json({ type: 'complete' }));

    const result = waiter.result();
    expect(result.satisfied).toBe(true);
    expect(result.matchedSequence).toHaveLength(3);
  });

  it('tolerates unrelated messages between the expected ones', () => {
    const waiter = createWaiter({ strategy: STRATEGIES.SEQUENCE, sequence });
    waiter.offer(json({ type: 'ack' }));
    waiter.offer(json({ type: 'heartbeat' }));
    waiter.offer(json({ type: 'data' }));
    waiter.offer(msg('noise'));
    waiter.offer(json({ type: 'complete' }));
    expect(waiter.result().satisfied).toBe(true);
  });

  it('is not satisfied when the order is wrong', () => {
    const waiter = createWaiter({ strategy: STRATEGIES.SEQUENCE, sequence });
    waiter.offer(json({ type: 'complete' }));
    waiter.offer(json({ type: 'data' }));
    waiter.offer(json({ type: 'ack' }));
    expect(waiter.result().satisfied).toBe(false);
  });
});

describe('createWaiter — silence (nothing should arrive)', () => {
  it('is satisfied when the window passes with no traffic', () => {
    // How you prove an unsubscribe actually worked.
    const waiter = createWaiter({ strategy: STRATEGIES.SILENCE });
    expect(waiter.settleOnTimeout().satisfied).toBe(true);
  });

  it('fails as soon as any message arrives', () => {
    const waiter = createWaiter({ strategy: STRATEGIES.SILENCE });
    waiter.offer(msg('unexpected'));
    expect(waiter.result().satisfied).toBe(false);
    expect(waiter.settleOnTimeout().satisfied).toBe(false);
  });

  it('is not broken by lifecycle entries', () => {
    const waiter = createWaiter({ strategy: STRATEGIES.SILENCE });
    waiter.offer(msg('Connected', 'text', 'system'));
    expect(waiter.settleOnTimeout().satisfied).toBe(true);
  });

  it('is not satisfied before the window has actually elapsed', () => {
    // result() is polled; reporting "satisfied" straight away made a silence wait
    // resolve on its first poll, so it passed without ever waiting for anything.
    const waiter = createWaiter({ strategy: STRATEGIES.SILENCE });
    expect(waiter.result().satisfied).toBe(false);
    expect(waiter.result().failedEarly).toBe(false);
  });

  it('flags an early failure so the caller can stop waiting', () => {
    const waiter = createWaiter({ strategy: STRATEGIES.SILENCE });
    waiter.offer(msg('unexpected'));
    expect(waiter.result().failedEarly).toBe(true);
  });
});

describe('normalizeTimeout', () => {
  it('defaults when unset or invalid', () => {
    expect(normalizeTimeout(undefined)).toBe(DEFAULT_TIMEOUT_MS);
    expect(normalizeTimeout(0)).toBe(DEFAULT_TIMEOUT_MS);
    expect(normalizeTimeout(-5)).toBe(DEFAULT_TIMEOUT_MS);
    expect(normalizeTimeout('abc')).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('honours a sensible value', () => {
    expect(normalizeTimeout(2500)).toBe(2500);
  });

  it('clamps an over-long wait so a run can never hang', () => {
    expect(normalizeTimeout(10 * 60 * 1000)).toBe(MAX_TIMEOUT_MS);
  });
});

describe('describeCondition', () => {
  it('explains each strategy for failure messages', () => {
    expect(describeCondition({ strategy: STRATEGIES.CONTAINS, value: 'x' })).toMatch(/containing "x"/);
    expect(describeCondition({ strategy: STRATEGIES.JSON_PATH, path: '$.a', value: '1' })).toMatch(/\$\.a = 1/);
    expect(describeCondition({ strategy: STRATEGIES.SILENCE })).toBe('no messages');
    expect(describeCondition({ strategy: STRATEGIES.SEQUENCE, sequence: [1, 2] })).toMatch(/2 messages in order/);
  });
});
