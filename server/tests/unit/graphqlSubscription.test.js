import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { runWebSocketRequest } from '../../src/services/websocket/wsStepRunner.js';
import * as manager from '../../src/services/websocket/connectionManager.js';

/**
 * A stand-in graphql-ws server.
 *
 * No public GraphQL subscription endpoint was reachable, and a local one would be
 * refused by our own SSRF guard — so the protocol partner is simulated here instead.
 * That is arguably the better test anyway: the whole init -> ack -> subscribe ->
 * next -> complete sequence runs deterministically, with no third party to flake.
 */
class FakeGraphQLWsServer extends EventEmitter {
  constructor({ ticks = [], ackDelay = 0, sendAck = true, errorOnSubscribe = null } = {}) {
    super();
    this.protocol = 'graphql-ws';
    this.received = [];
    this.ticks = ticks;
    this.ackDelay = ackDelay;
    this.sendAck = sendAck;
    this.errorOnSubscribe = errorOnSubscribe;
    this.terminated = false;
    setTimeout(() => this.emit('open'), 0);
  }

  send(raw) {
    const frame = JSON.parse(raw);
    this.received.push(frame);

    if (frame.type === 'connection_init' && this.sendAck) {
      setTimeout(() => this.reply({ type: 'connection_ack' }), this.ackDelay);
    }

    if (frame.type === 'subscribe') {
      if (this.errorOnSubscribe) {
        setTimeout(() => this.reply({ type: 'error', id: frame.id, payload: this.errorOnSubscribe }), 5);
        return;
      }
      // Emit each tick as its own `next` frame, the way a real subscription streams.
      this.ticks.forEach((payload, i) => {
        setTimeout(() => this.reply({ type: 'next', id: frame.id, payload }), 5 + i * 5);
      });
      setTimeout(() => this.reply({ type: 'complete', id: frame.id }), 5 + this.ticks.length * 5);
    }
  }

  reply(frame) {
    this.emit('message', Buffer.from(JSON.stringify(frame)), false);
  }

  close() {
    this.emit('close', 1000, Buffer.from(''));
  }
  terminate() {
    this.terminated = true;
  }
  ping() {}
  removeAllListeners() {
    super.removeAllListeners();
  }
}

function subscriptionRequest(overrides = {}) {
  return {
    name: 'Ticks',
    protocol: 'websocket',
    url: 'wss://example.com/graphql',
    params: [],
    headers: [],
    auth: { type: 'none' },
    websocket: {
      subprotocols: '',
      graphql: {
        enabled: true,
        query: 'subscription { tick { value } }',
        variables: '',
        operationName: '',
        timeoutMs: 3000,
      },
      steps: [],
      ...overrides,
    },
  };
}

afterEach(() => manager.closeAll());

describe('GraphQL subscription over WebSocket', () => {
  it('performs the graphql-ws handshake in order', async () => {
    let server;
    const request = subscriptionRequest({
      steps: [{ name: 'First tick', waitFor: { strategy: 'next', timeoutMs: 2000 } }],
    });

    const result = await runWebSocketRequest(request, {}, {
      createSocket: () => {
        server = new FakeGraphQLWsServer({ ticks: [{ data: { tick: { value: 1 } } }] });
        return server;
      },
    });

    expect(result.success).toBe(true);
    // connection_init must precede subscribe — the server ignores a subscribe sent first.
    expect(server.received.map((f) => f.type)).toEqual(['connection_init', 'subscribe']);
    expect(server.received[1].payload.query).toContain('subscription');
  });

  it('requests the graphql-ws subprotocol', async () => {
    let requested;
    const request = subscriptionRequest({
      steps: [{ name: 'tick', waitFor: { strategy: 'next', timeoutMs: 2000 } }],
    });

    await runWebSocketRequest(request, {}, {
      createSocket: (_url, protocols) => {
        requested = protocols;
        return new FakeGraphQLWsServer({ ticks: [{ data: { tick: { value: 1 } } }] });
      },
    });

    expect(requested).toContain('graphql-ws');
  });

  it('asserts on a subscription payload with ordinary JSONPath', async () => {
    // The payload is unwrapped into the message body, so `$.data.…` works exactly as
    // it does for HTTP GraphQL — no subscription-specific assertion type needed.
    const request = subscriptionRequest({
      steps: [
        {
          name: 'Tick value',
          waitFor: { strategy: 'jsonPath', path: '$.data.tick.value', timeoutMs: 2000 },
          assertions: [
            { source: 'json', path: '$.data.tick.value', operator: 'equals', expected: '42' },
          ],
          captures: [{ source: 'json', path: '$.data.tick.value', variableName: 'tickValue' }],
        },
      ],
    });

    const result = await runWebSocketRequest(request, {}, {
      createSocket: () => new FakeGraphQLWsServer({ ticks: [{ data: { tick: { value: 42 } } }] }),
    });

    expect(result.success).toBe(true);
    expect(result.assertions.allPassed).toBe(true);
    expect(result.captures[0]).toMatchObject({ variableName: 'tickValue', value: 42 });
  });

  it('handles a stream of several messages across steps', async () => {
    const request = subscriptionRequest({
      steps: [
        {
          name: 'Wait for the third tick',
          waitFor: { strategy: 'jsonPath', path: '$.data.tick.value', value: '3', timeoutMs: 2500 },
          assertions: [{ source: 'json', path: '$.data.tick.value', operator: 'equals', expected: '3' }],
        },
      ],
    });

    const result = await runWebSocketRequest(request, {}, {
      createSocket: () =>
        new FakeGraphQLWsServer({
          ticks: [1, 2, 3, 4].map((value) => ({ data: { tick: { value } } })),
        }),
    });

    expect(result.success).toBe(true);
    expect(result.websocket.messagesReceived).toBeGreaterThanOrEqual(3);
  });

  it('reports a subscription the server rejects, in the server\'s own words', async () => {
    const request = subscriptionRequest({
      steps: [{ name: 'never', waitFor: { strategy: 'next', timeoutMs: 1000 } }],
    });

    const result = await runWebSocketRequest(request, {}, {
      createSocket: () =>
        new FakeGraphQLWsServer({ errorOnSubscribe: [{ message: 'Unknown field "nope"' }] }),
    });

    expect(result.success).toBe(false);
    // The error frame used to be swallowed, leaving the step to time out — so the
    // report blamed a slow server instead of the invalid field it actually named.
    expect(result.error).toContain('Unknown field "nope"');
    expect(result.error).not.toMatch(/timed out/i);
  });


  it('fails clearly when the server never acknowledges', async () => {
    // A server speaking a different subprotocol would otherwise just look silent.
    const request = subscriptionRequest({ graphql: { enabled: true, query: 'subscription { a }', timeoutMs: 300 } });

    const result = await runWebSocketRequest(request, {}, {
      createSocket: () => new FakeGraphQLWsServer({ sendAck: false }),
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/connection_ack/i);
  });

  it('substitutes variables into the subscription document', async () => {
    let server;
    const request = subscriptionRequest({
      graphql: {
        enabled: true,
        query: 'subscription { tick(room: "{{room}}") { value } }',
        variables: '{"limit":{{limit}}}',
        timeoutMs: 2000,
      },
      steps: [{ name: 'tick', waitFor: { strategy: 'next', timeoutMs: 1500 } }],
    });

    await runWebSocketRequest(request, { room: 'lobby', limit: '5' }, {
      createSocket: () => {
        server = new FakeGraphQLWsServer({ ticks: [{ data: { tick: { value: 1 } } }] });
        return server;
      },
    });

    const subscribeFrame = server.received.find((f) => f.type === 'subscribe');
    expect(subscribeFrame.payload.query).toContain('"lobby"');
    expect(subscribeFrame.payload.variables).toEqual({ limit: 5 });
  });

  it('answers a protocol ping without polluting the message log', async () => {
    let server;
    const request = subscriptionRequest({
      steps: [{ name: 'tick', waitFor: { strategy: 'next', timeoutMs: 2000 } }],
    });

    const result = await runWebSocketRequest(request, {}, {
      createSocket: () => {
        server = new FakeGraphQLWsServer({ ticks: [{ data: { tick: { value: 1 } } }] });
        setTimeout(() => server.reply({ type: 'ping' }), 2);
        return server;
      },
    });

    expect(server.received.some((f) => f.type === 'pong')).toBe(true);
    // The ping/pong exchange must not be counted as subscription data.
    expect(result.websocket.messagesReceived).toBe(1);
  });
});
