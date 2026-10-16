import { describe, it, expect } from 'vitest';
import {
  createMessage,
  systemMessage,
  detectType,
  payloadSize,
  DIRECTIONS,
  MESSAGE_TYPES,
} from '../../src/services/websocket/messageEngine.js';
import { resolveTextValue } from '../../src/services/variables/variableResolver.js';

describe('detectType', () => {
  it('detects JSON objects and arrays', () => {
    expect(detectType('{"a":1}')).toBe(MESSAGE_TYPES.JSON);
    expect(detectType('[1,2]')).toBe(MESSAGE_TYPES.JSON);
    expect(detectType('  {"a":1}  ')).toBe(MESSAGE_TYPES.JSON);
  });

  it('treats bare scalars as text, not JSON', () => {
    // "12" and "null" parse as JSON but calling them JSON messages helps nobody.
    expect(detectType('12')).toBe(MESSAGE_TYPES.TEXT);
    expect(detectType('null')).toBe(MESSAGE_TYPES.TEXT);
    expect(detectType('"quoted"')).toBe(MESSAGE_TYPES.TEXT);
  });

  it('falls back to text for JSON-looking but invalid payloads', () => {
    expect(detectType('{not json')).toBe(MESSAGE_TYPES.TEXT);
    expect(detectType('[1,')).toBe(MESSAGE_TYPES.TEXT);
  });

  it('detects plain text', () => {
    expect(detectType('hello')).toBe(MESSAGE_TYPES.TEXT);
    expect(detectType('')).toBe(MESSAGE_TYPES.TEXT);
  });

  it('flags binary frames', () => {
    expect(detectType(Buffer.from([1, 2, 3]), true)).toBe(MESSAGE_TYPES.BINARY);
  });
});

describe('payloadSize', () => {
  it('measures UTF-8 bytes, not characters', () => {
    expect(payloadSize('abc')).toBe(3);
    expect(payloadSize('é')).toBe(2);
    expect(payloadSize('😀')).toBe(4);
  });

  it('measures binary frames by length', () => {
    expect(payloadSize(Buffer.from([1, 2, 3]), true)).toBe(3);
  });

  it('handles empty and non-string payloads', () => {
    expect(payloadSize('')).toBe(0);
    expect(payloadSize(undefined)).toBe(0);
  });
});

describe('createMessage', () => {
  it('builds a complete log entry', () => {
    const m = createMessage({ connectionId: 'c1', direction: DIRECTIONS.SENT, payload: '{"a":1}' });

    expect(m.id).toBeTruthy();
    expect(m.connectionId).toBe('c1');
    expect(m.direction).toBe('sent');
    expect(m.type).toBe('json');
    expect(m.payload).toBe('{"a":1}');
    expect(m.size).toBe(7);
    expect(typeof m.timestamp).toBe('number');
  });

  it('gives every message a distinct id', () => {
    const a = createMessage({ connectionId: 'c', direction: DIRECTIONS.SENT, payload: 'x' });
    const b = createMessage({ connectionId: 'c', direction: DIRECTIONS.SENT, payload: 'x' });
    expect(a.id).not.toBe(b.id);
  });

  it('records binary frames without decoding their contents', () => {
    const m = createMessage({
      connectionId: 'c1',
      direction: DIRECTIONS.RECEIVED,
      payload: Buffer.from([1, 2, 3, 4]),
      isBinary: true,
    });

    expect(m.type).toBe('binary');
    expect(m.payload).toBe(null); // not decoded — text/JSON is the supported surface
    expect(m.size).toBe(4); // but size and direction are still real test signal
  });

  it('supports both directions', () => {
    expect(createMessage({ direction: DIRECTIONS.RECEIVED, payload: 'x' }).direction).toBe('received');
    expect(createMessage({ direction: DIRECTIONS.SENT, payload: 'x' }).direction).toBe('sent');
  });
});

describe('systemMessage', () => {
  it('records lifecycle events in the same log as traffic', () => {
    // Connection events belong in the log so the sequence reads in real order.
    const m = systemMessage('c1', 'open', 'Connected');
    expect(m.direction).toBe('system');
    expect(m.event).toBe('open');
    expect(m.payload).toBe('Connected');
  });

  it('carries close and error events too', () => {
    expect(systemMessage('c1', 'closed', 'Disconnected — code 1000').event).toBe('closed');
    expect(systemMessage('c1', 'error', 'boom').event).toBe('error');
  });
});

describe('outgoing payload variable substitution', () => {
  it('substitutes {{variables}} in a message body', () => {
    const { text, missing } = resolveTextValue('{"userId":"{{uid}}"}', { uid: '42' });
    expect(text).toBe('{"userId":"42"}');
    expect(missing).toEqual([]);
  });

  it('reports an unresolved variable rather than sending the placeholder', () => {
    const { missing } = resolveTextValue('{"id":"{{nope}}"}', {});
    expect(missing).toEqual(['nope']);
  });

  it('leaves a message with no placeholders untouched', () => {
    expect(resolveTextValue('plain text', { a: '1' }).text).toBe('plain text');
  });
});
