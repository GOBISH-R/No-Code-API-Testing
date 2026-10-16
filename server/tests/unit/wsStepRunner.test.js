import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { runWebSocketRequest } from '../../src/services/websocket/wsStepRunner.js';
import * as manager from '../../src/services/websocket/connectionManager.js';

/**
 * A minimal echo server.
 *
 * The step runner's multi-step behaviour was previously only exercised through the
 * GraphQL subscription tests, which all use a single step — so nothing covered how one
 * step's traffic is handed to the next. That gap is what this file closes.
 */
class FakeEchoServer extends EventEmitter {
  constructor({ echo = true } = {}) {
    super();
    this.protocol = null;
    this.sent = [];
    this.echo = echo;
    setTimeout(() => this.emit('open'), 0);
  }

  send(raw) {
    this.sent.push(raw);
    if (this.echo) setTimeout(() => this.emit('message', Buffer.from(raw), false), 5);
  }

  close() {
    this.emit('close', 1000, Buffer.from(''));
  }
  terminate() {}
  ping() {}
}

function wsRequest(steps, websocket = {}) {
  return {
    name: 'Echo',
    protocol: 'websocket',
    url: 'wss://example.com/socket',
    params: [],
    headers: [],
    auth: { type: 'none' },
    websocket: { subprotocols: '', steps, ...websocket },
  };
}

afterEach(() => manager.closeAll());

describe('WebSocket steps', () => {
  it('gives each step its own reply rather than replaying the previous one', async () => {
    // The regression this guards: every step used to be offered the *entire* message
    // history, so step two matched the message step one had already consumed.
    const request = wsRequest([
      { name: 'First', send: 'alpha', waitFor: { strategy: 'next', timeoutMs: 1500 } },
      { name: 'Second', send: 'beta', waitFor: { strategy: 'next', timeoutMs: 1500 } },
    ]);

    const result = await runWebSocketRequest(request, {}, {
      createSocket: () => new FakeEchoServer(),
    });

    expect(result.success).toBe(true);
    expect(result.websocket.steps[0].matched.payload).toBe('alpha');
    expect(result.websocket.steps[1].matched.payload).toBe('beta');
  });

  it('lets a silence step pass after earlier steps have seen traffic', async () => {
    // Proving an unsubscribe worked means asserting nothing arrives *from now on*.
    // Replaying history made that impossible: the wait failed on a message that had
    // already been accounted for.
    const request = wsRequest([
      { name: 'Echo once', send: 'ping', waitFor: { strategy: 'next', timeoutMs: 1500 } },
      { name: 'Then quiet', waitFor: { strategy: 'silence', timeoutMs: 200 } },
    ]);

    const result = await runWebSocketRequest(request, {}, {
      createSocket: () => new FakeEchoServer(),
    });

    expect(result.success).toBe(true);
    expect(result.websocket.steps[1].success).toBe(true);
  });

  it('still counts a message that arrived before its step registered', async () => {
    // The cursor must not overcorrect: a server fast enough to reply before the next
    // step starts waiting should still satisfy that step.
    const request = wsRequest([
      { name: 'Send', send: 'early', waitFor: { strategy: 'contains', value: 'early', timeoutMs: 1500 } },
    ]);

    const result = await runWebSocketRequest(request, {}, {
      createSocket: () => new FakeEchoServer(),
    });

    expect(result.success).toBe(true);
  });

  it('fails a silence step when the server does speak', async () => {
    const request = wsRequest([
      { name: 'Should be quiet', send: 'noise', waitFor: { strategy: 'silence', timeoutMs: 400 } },
    ]);

    const result = await runWebSocketRequest(request, {}, {
      createSocket: () => new FakeEchoServer(),
    });

    expect(result.success).toBe(false);
  });
});
