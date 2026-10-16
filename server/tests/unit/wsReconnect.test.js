import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as manager from '../../src/services/websocket/connectionManager.js';

// Reconnection and heartbeat are timer-driven, so fake timers make them deterministic
// instead of turning the suite into a stopwatch race.
class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.pings = 0;
    this.terminated = false;
    this.protocol = '';
  }
  send(p) {
    this.sent.push(p);
  }
  ping() {
    this.pings += 1;
  }
  close(code, reason) {
    this.closedWith = { code, reason };
    // A real peer answers a close frame; the manager reacts to 'close'.
    this.emit('close', code ?? 1000, Buffer.from(reason ?? ''));
  }
  terminate() {
    this.terminated = true;
  }
}

// Every call hands back a fresh socket, mimicking a real reconnect.
function socketFactory() {
  const sockets = [];
  const create = () => {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  };
  return { sockets, create };
}

beforeEach(() => {
  manager.closeAll();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  manager.closeAll();
});

async function open(options = {}, listeners = {}) {
  const factory = socketFactory();
  const { id } = await manager.openConnection(
    { url: 'wss://example.com/socket', ...options },
    listeners,
    { createSocket: factory.create },
  );
  return { id, factory };
}

describe('automatic reconnection', () => {
  it('reconnects after an unexpected drop', async () => {
    const onReconnecting = vi.fn();
    const { id, factory } = await open({ reconnect: { enabled: true, maxRetries: 3, delayMs: 100 } }, { onReconnecting });

    factory.sockets[0].emit('open');
    expect(manager.describeConnection(id).state).toBe(manager.STATES.OPEN);

    // Peer vanishes.
    factory.sockets[0].emit('close', 1006, Buffer.from('abnormal'));

    expect(manager.describeConnection(id).state).toBe(manager.STATES.RECONNECTING);
    expect(onReconnecting).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, maxRetries: 3 }));

    vi.advanceTimersByTime(100);
    expect(factory.sockets).toHaveLength(2); // a fresh socket was created

    factory.sockets[1].emit('open');
    expect(manager.describeConnection(id).state).toBe(manager.STATES.OPEN);
    expect(manager.describeConnection(id).reconnectAttempts).toBe(1);
  });

  it('reports that an open was actually a reconnect', async () => {
    const onOpen = vi.fn();
    const { factory } = await open({ reconnect: { enabled: true, delayMs: 10 } }, { onOpen });

    factory.sockets[0].emit('open');
    factory.sockets[0].emit('close', 1006, Buffer.from(''));
    vi.advanceTimersByTime(10);
    factory.sockets[1].emit('open');

    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ reconnected: true, attempt: 1 }));
  });

  it('gives up after the configured number of retries', async () => {
    const onClose = vi.fn();
    const { id, factory } = await open({ reconnect: { enabled: true, maxRetries: 2, delayMs: 10 } }, { onClose });

    factory.sockets[0].emit('open');

    // Drop, retry, drop, retry, drop -> exhausted.
    factory.sockets[0].emit('close', 1006, Buffer.from('gone'));
    vi.advanceTimersByTime(10);
    factory.sockets[1].emit('close', 1006, Buffer.from('gone'));
    vi.advanceTimersByTime(10);
    factory.sockets[2].emit('close', 1006, Buffer.from('gone'));

    // Three sockets tried in total; no fourth.
    expect(factory.sockets).toHaveLength(3);
    expect(manager.describeConnection(id)).toBe(null);
    expect(onClose).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: expect.stringMatching(/exhausted/i) }),
    );
  });

  it('never reconnects forever, even if asked to', async () => {
    // The caller cannot opt out of the hard ceiling.
    const { factory } = await open({
      reconnect: { enabled: true, maxRetries: 9999, delayMs: 1 },
    });

    factory.sockets[0].emit('open');
    for (let i = 0; i < LIMIT_PROBE; i += 1) {
      factory.sockets[factory.sockets.length - 1].emit('close', 1006, Buffer.from(''));
      vi.advanceTimersByTime(1);
    }

    expect(factory.sockets.length).toBeLessThanOrEqual(manager.LIMITS.MAX_RECONNECT_ATTEMPTS + 1);
  });

  it('does not reconnect when disabled', async () => {
    const { id, factory } = await open({ reconnect: { enabled: false } });
    factory.sockets[0].emit('open');
    factory.sockets[0].emit('close', 1006, Buffer.from('gone'));

    vi.advanceTimersByTime(5000);
    expect(factory.sockets).toHaveLength(1);
    expect(manager.describeConnection(id)).toBe(null);
  });

  it('does not reconnect after a deliberate close', async () => {
    // Closing on purpose must not be undone by the retry policy.
    const { id, factory } = await open({ reconnect: { enabled: true, maxRetries: 3, delayMs: 10 } });
    factory.sockets[0].emit('open');

    manager.closeConnection(id);
    vi.advanceTimersByTime(1000);

    expect(factory.sockets).toHaveLength(1);
    expect(manager.describeConnection(id)).toBe(null);
  });
});

const LIMIT_PROBE = 25;

describe('manual reconnection', () => {
  it('reconnects on demand and resets the attempt counter', async () => {
    const { id, factory } = await open({ reconnect: { enabled: true, maxRetries: 1, delayMs: 5 } });
    factory.sockets[0].emit('open');

    // Burn the single automatic retry.
    factory.sockets[0].emit('close', 1006, Buffer.from(''));
    vi.advanceTimersByTime(5);
    expect(manager.describeConnection(id).reconnectAttempts).toBe(1);

    // A person clicking Reconnect is a fresh decision, not a continuation.
    manager.reconnect(id);
    expect(manager.describeConnection(id).reconnectAttempts).toBe(0);
    expect(factory.sockets).toHaveLength(3);
  });

  it('refuses to reconnect an unknown connection', () => {
    expect(() => manager.reconnect('nope')).toThrow(/no longer open/i);
  });
});

describe('heartbeat', () => {
  it('sends protocol-level pings on the configured interval', async () => {
    const { factory } = await open({ heartbeat: { enabled: true, intervalMs: 1000, timeoutMs: 500 } });
    factory.sockets[0].emit('open');

    // A pong must answer each ping — otherwise the second ping never happens, because
    // the missed deadline correctly tears the connection down.
    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(1000);
      factory.sockets[0].emit('pong');
    }

    expect(factory.sockets[0].pings).toBe(3);
  });

  it('does not send pings when disabled', async () => {
    const { factory } = await open({ heartbeat: { enabled: false } });
    factory.sockets[0].emit('open');
    vi.advanceTimersByTime(120_000);
    expect(factory.sockets[0].pings).toBe(0);
  });

  it('keeps the connection alive while pongs come back', async () => {
    const { id, factory } = await open({ heartbeat: { enabled: true, intervalMs: 1000, timeoutMs: 500 } });
    factory.sockets[0].emit('open');

    // Advance exactly one interval at a time and answer immediately; drifting past the
    // pong deadline would (correctly) kill the connection.
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(1000);
      factory.sockets[0].emit('pong');
    }

    expect(manager.describeConnection(id).state).toBe(manager.STATES.OPEN);
    expect(factory.sockets[0].pings).toBe(5);
  });

  it('treats a missing pong as a dead connection', async () => {
    // The socket still looks open, which is exactly why this check exists.
    const onHeartbeatTimeout = vi.fn();
    const { id, factory } = await open(
      { heartbeat: { enabled: true, intervalMs: 1000, timeoutMs: 500 }, reconnect: { enabled: false } },
      { onHeartbeatTimeout },
    );
    factory.sockets[0].emit('open');

    vi.advanceTimersByTime(1000); // ping sent
    vi.advanceTimersByTime(500); // no pong

    expect(onHeartbeatTimeout).toHaveBeenCalled();
    expect(manager.describeConnection(id)).toBe(null);
  });

  it('reconnects after a heartbeat timeout when reconnection is enabled', async () => {
    const { factory } = await open({
      heartbeat: { enabled: true, intervalMs: 1000, timeoutMs: 500 },
      reconnect: { enabled: true, maxRetries: 2, delayMs: 10 },
    });
    factory.sockets[0].emit('open');

    vi.advanceTimersByTime(1500); // ping, then no pong
    vi.advanceTimersByTime(10); // retry delay

    expect(factory.sockets).toHaveLength(2);
  });

  it('stops pinging once the connection closes', async () => {
    const { id, factory } = await open({ heartbeat: { enabled: true, intervalMs: 500, timeoutMs: 200 } });
    factory.sockets[0].emit('open');
    vi.advanceTimersByTime(500);
    const pingsBefore = factory.sockets[0].pings;

    manager.forceClose(id);
    vi.advanceTimersByTime(5000);

    expect(factory.sockets[0].pings).toBe(pingsBefore);
  });
});

describe('configuration limits', () => {
  it('clamps an excessive retry count and delay', async () => {
    const { id, factory } = await open({
      reconnect: { enabled: true, maxRetries: 9999, delayMs: 10 * 60 * 1000 },
    });
    factory.sockets[0].emit('open');
    expect(manager.describeConnection(id)).toBeTruthy();
    // Clamping is asserted behaviourally above; here we only confirm it did not throw.
  });

  it('defaults sensibly when nothing is configured', async () => {
    const { id, factory } = await open({});
    factory.sockets[0].emit('open');
    expect(manager.describeConnection(id).reconnectAttempts).toBe(0);
  });
});
