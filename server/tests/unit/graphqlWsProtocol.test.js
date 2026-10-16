import { describe, it, expect } from 'vitest';
import {
  connectionInit,
  subscribe,
  complete,
  pong,
  classifyServerFrame,
  describeErrors,
  SUBPROTOCOL,
} from '../../src/services/websocket/graphqlWsProtocol.js';

const parse = (s) => JSON.parse(s);

describe('graphql-ws client frames', () => {
  it('uses the standard subprotocol name', () => {
    expect(SUBPROTOCOL).toBe('graphql-ws');
  });

  it('builds connection_init, with and without params', () => {
    expect(parse(connectionInit())).toEqual({ type: 'connection_init' });
    expect(parse(connectionInit({ token: 't' }))).toEqual({
      type: 'connection_init',
      payload: { token: 't' },
    });
  });

  it('builds a subscribe frame carrying the document', () => {
    const frame = parse(subscribe({ id: 'abc', query: 'subscription { ticks }' }));
    expect(frame.id).toBe('abc');
    expect(frame.type).toBe('subscribe');
    expect(frame.payload.query).toBe('subscription { ticks }');
  });

  it('includes variables and operationName only when present', () => {
    const bare = parse(subscribe({ id: '1', query: 'subscription { a }' }));
    expect(bare.payload).not.toHaveProperty('variables');
    expect(bare.payload).not.toHaveProperty('operationName');

    const full = parse(
      subscribe({ id: '1', query: 'subscription S { a }', variables: { x: 1 }, operationName: 'S' }),
    );
    expect(full.payload.variables).toEqual({ x: 1 });
    expect(full.payload.operationName).toBe('S');
  });

  it('generates an id when none is supplied', () => {
    expect(parse(subscribe({ query: 'subscription { a }' })).id).toBeTruthy();
  });

  it('builds complete and pong frames', () => {
    expect(parse(complete('abc'))).toEqual({ id: 'abc', type: 'complete' });
    expect(parse(pong())).toEqual({ type: 'pong' });
  });
});

describe('classifyServerFrame', () => {
  it('recognises the acknowledgement that opens the session', () => {
    expect(classifyServerFrame('{"type":"connection_ack"}').kind).toBe('ack');
  });

  it('recognises a next frame and keeps its payload', () => {
    const frame = classifyServerFrame('{"type":"next","id":"1","payload":{"data":{"tick":5}}}');
    expect(frame.kind).toBe('next');
    expect(frame.payload).toEqual({ data: { tick: 5 } });
  });

  it('recognises errors, complete, ping and pong', () => {
    expect(classifyServerFrame('{"type":"error","id":"1","payload":[{"message":"bad"}]}').kind).toBe('error');
    expect(classifyServerFrame('{"type":"complete","id":"1"}').kind).toBe('complete');
    expect(classifyServerFrame('{"type":"ping"}').kind).toBe('ping');
    expect(classifyServerFrame('{"type":"pong"}').kind).toBe('pong');
  });

  it('reports a frame that is not JSON rather than ignoring it', () => {
    // A server speaking a different subprotocol would otherwise look like silence.
    expect(classifyServerFrame('not json').kind).toBe('invalid');
  });

  it('reports a frame with no type', () => {
    expect(classifyServerFrame('{"foo":1}').kind).toBe('invalid');
  });

  it('reports an unrecognised type instead of silently dropping it', () => {
    const frame = classifyServerFrame('{"type":"data","id":"1"}');
    expect(frame.kind).toBe('unknown');
    // "data" is the *older* subscriptions-transport-ws protocol — worth surfacing.
    expect(frame.type).toBe('data');
  });

  it('accepts a Buffer as well as a string', () => {
    expect(classifyServerFrame(Buffer.from('{"type":"connection_ack"}')).kind).toBe('ack');
  });
});

describe('describeErrors', () => {
  it('joins GraphQL error messages', () => {
    expect(describeErrors([{ message: 'a' }, { message: 'b' }])).toBe('a; b');
  });

  it('falls back when the shape is unexpected', () => {
    expect(describeErrors(null)).toMatch(/rejected the subscription/);
    expect(describeErrors([])).toMatch(/rejected the subscription/);
  });
});
