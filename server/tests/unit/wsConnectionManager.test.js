import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as manager from '../../src/services/websocket/connectionManager.js';
import { isAllowedOrigin } from '../../src/services/websocket/gateway.js';

// A stand-in for the `ws` client so lifecycle transitions can be driven deterministically
// and offline — no external echo server, no timing races.
class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.terminated = false;
    this.closedWith = null;
    this.protocol = '';
  }
  send(payload) {
    this.sent.push(payload);
  }
  close(code, reason) {
    this.closedWith = { code, reason };
  }
  terminate() {
    this.terminated = true;
  }
}

function open(url = 'wss://example.com/socket', listeners = {}, ownerId) {
  const socket = new FakeSocket();
  return manager
    .openConnection({ url }, listeners, { createSocket: () => socket, ownerId })
    .then((result) => ({ ...result, socket }));
}

beforeEach(() => {
  manager.closeAll();
});

describe('connection lifecycle', () => {
  it('starts in connecting and becomes open on the socket open event', async () => {
    const onOpen = vi.fn();
    const { id, socket } = await open('wss://example.com/socket', { onOpen });

    expect(manager.describeConnection(id).state).toBe(manager.STATES.CONNECTING);
    socket.protocol = 'graphql-ws';
    socket.emit('open');

    expect(manager.describeConnection(id).state).toBe(manager.STATES.OPEN);
    // `reconnected`/`attempt` ride along so a run can report whether a step only
    // succeeded after a retry.
    expect(onOpen).toHaveBeenCalledWith({ id, protocol: 'graphql-ws', reconnected: false, attempt: 0 });
  });

  it('reports the negotiated subprotocol as null when the server agreed to none', async () => {
    const { id, socket } = await open();
    socket.emit('open');
    expect(manager.describeConnection(id).protocol).toBe(null);
  });

  it('removes the connection and reports the close code when the peer closes', async () => {
    const onClose = vi.fn();
    const { id, socket } = await open('wss://example.com/socket', { onClose });
    socket.emit('open');
    socket.emit('close', 1000, Buffer.from('bye'));

    expect(manager.describeConnection(id)).toBe(null);
    expect(onClose).toHaveBeenCalledWith({ code: 1000, reason: 'bye', local: false });
  });

  it('surfaces a socket error and drops the connection', async () => {
    const onError = vi.fn();
    const { id, socket } = await open('wss://example.com/socket', { onError });
    socket.emit('error', new Error('connection refused'));

    expect(onError).toHaveBeenCalledWith({ id, message: 'connection refused' });
    expect(manager.describeConnection(id)).toBe(null);
  });

  it('closes gracefully with a 1000 close frame', async () => {
    const { id, socket } = await open();
    socket.emit('open');

    expect(manager.closeConnection(id, 'done')).toBe(true);
    expect(socket.closedWith).toEqual({ code: 1000, reason: 'done' });
    expect(manager.describeConnection(id).state).toBe(manager.STATES.CLOSING);
  });

  it('force close terminates immediately and deregisters', async () => {
    const { id, socket } = await open();
    socket.emit('open');

    manager.forceClose(id);
    expect(socket.terminated).toBe(true);
    expect(manager.describeConnection(id)).toBe(null);
  });

  it('closing an unknown connection is a no-op, not a throw', () => {
    expect(manager.closeConnection('nope')).toBe(false);
    expect(manager.forceClose('nope')).toBe(false);
  });
});

describe('messaging guards', () => {
  it('sends only when the connection is open', async () => {
    const { id, socket } = await open();

    // Still connecting.
    expect(() => manager.sendMessage(id, 'hi')).toThrow(/not open/i);

    socket.emit('open');
    manager.sendMessage(id, 'hi');
    expect(socket.sent).toEqual(['hi']);
  });

  it('refuses to send on an unknown connection', () => {
    expect(() => manager.sendMessage('nope', 'hi')).toThrow(/no longer open/i);
  });

  it('rejects a message over the size limit', async () => {
    const { id, socket } = await open();
    socket.emit('open');
    const huge = 'x'.repeat(manager.LIMITS.MAX_MESSAGE_BYTES + 1);
    expect(() => manager.sendMessage(id, huge)).toThrow(/limit/i);
  });

  it('counts messages in both directions', async () => {
    const { id, socket } = await open();
    socket.emit('open');
    manager.sendMessage(id, 'a');
    manager.sendMessage(id, 'b');
    socket.emit('message', Buffer.from('reply'), false);

    const info = manager.describeConnection(id);
    expect(info.messagesSent).toBe(2);
    expect(info.messagesReceived).toBe(1);
  });
});

describe('resource limits', () => {
  it('refuses to exceed the maximum concurrent connections', async () => {
    const opened = [];
    for (let i = 0; i < manager.LIMITS.MAX_CONNECTIONS; i += 1) {
      opened.push(await open());
    }
    expect(manager.connectionCount()).toBe(manager.LIMITS.MAX_CONNECTIONS);
    await expect(open()).rejects.toThrow(/too many open/i);
  });

  it('caps each account separately, so one user cannot take every slot', async () => {
    for (let i = 0; i < manager.LIMITS.MAX_CONNECTIONS_PER_USER; i += 1) {
      await open(undefined, {}, 'user-a');
    }
    await expect(open(undefined, {}, 'user-a')).rejects.toThrow(/per account/i);

    // Somebody else is unaffected by user A being at their limit.
    await expect(open(undefined, {}, 'user-b')).resolves.toBeTruthy();
    expect(manager.connectionCount('user-a')).toBe(manager.LIMITS.MAX_CONNECTIONS_PER_USER);
    expect(manager.connectionCount('user-b')).toBe(1);
  });

  it('gives an account its slot back when a connection closes', async () => {
    const { id } = await open(undefined, {}, 'user-a');
    expect(manager.connectionCount('user-a')).toBe(1);
    manager.forceClose(id);
    expect(manager.connectionCount('user-a')).toBe(0);
  });

  it('does not let concurrent opens overshoot the per-account limit', async () => {
    const attempts = Array.from({ length: manager.LIMITS.MAX_CONNECTIONS_PER_USER + 5 }, () =>
      open(undefined, {}, 'user-a').then(() => 'ok', () => 'refused'),
    );
    const outcomes = await Promise.all(attempts);
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(manager.LIMITS.MAX_CONNECTIONS_PER_USER);
  });

  it('frees a slot once a connection closes', async () => {
    const { id } = await open();
    expect(manager.connectionCount()).toBe(1);
    manager.forceClose(id);
    expect(manager.connectionCount()).toBe(0);
  });

  it('closeAll tears down every connection — used when a browser tab drops', async () => {
    await open();
    await open();
    expect(manager.connectionCount()).toBe(2);
    manager.closeAll();
    expect(manager.connectionCount()).toBe(0);
  });

  it('enforces the SSRF guard before any socket is created', async () => {
    const createSocket = vi.fn();
    await expect(
      manager.openConnection({ url: 'ws://127.0.0.1/s' }, {}, { createSocket }),
    ).rejects.toThrow(/private|internal/i);
    expect(createSocket).not.toHaveBeenCalled();
  });

  it('requires a URL', async () => {
    await expect(manager.openConnection({ url: '  ' }, {}, { createSocket: () => new FakeSocket() })).rejects.toThrow(
      /URL is required/i,
    );
  });
});

describe('gateway origin policy', () => {
  it('accepts the configured client origin', () => {
    expect(isAllowedOrigin('http://localhost:5173', 'http://localhost:5173')).toBe(true);
  });

  it('rejects any other browser origin', () => {
    // Without this, any page the user visits could drive their gateway as an open
    // proxy to arbitrary external servers.
    expect(isAllowedOrigin('https://evil.example.com', 'http://localhost:5173')).toBe(false);
  });

  it('allows non-browser clients, which send no Origin header', () => {
    expect(isAllowedOrigin(undefined, 'http://localhost:5173')).toBe(true);
  });
});
