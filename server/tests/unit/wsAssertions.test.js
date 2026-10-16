import { describe, it, expect } from 'vitest';
import { runAssertions } from '../../src/services/assertions/assertionEngine.js';
import { runCaptures } from '../../src/services/variables/captureEngine.js';
import { compare } from '../../src/services/assertions/comparator.js';
import { validateWsAssertions, validateWaitCondition } from '../../src/validators/wsAssertionValidator.js';

// The whole point of these: WebSocket assertions run through the *existing* assertion
// and capture engines. Only the context shape and the source names are new.

function wsContext({ payload = '{"type":"user.created","data":{"id":7}}', type = 'json', count = 1, connection } = {}) {
  let body;
  try {
    body = JSON.parse(payload);
  } catch {
    body = payload;
  }

  return {
    // `body` is what lets the shared `json` source work on a WebSocket message.
    body,
    message: { payload, type, size: Buffer.byteLength(payload) },
    messageCount: count,
    connection: connection || { state: 'open', closeCode: null, closeReason: null },
  };
}

describe('new comparator operators', () => {
  it('startsWith / endsWith', () => {
    expect(compare('hello world', 'startsWith', 'hello')).toBe(true);
    expect(compare('hello world', 'startsWith', 'world')).toBe(false);
    expect(compare('hello world', 'endsWith', 'world')).toBe(true);
    expect(compare('hello world', 'endsWith', 'hello')).toBe(false);
  });

  it('does not pass on a missing value', () => {
    expect(compare(undefined, 'startsWith', 'x')).toBe(false);
    expect(compare(null, 'endsWith', 'x')).toBe(false);
  });
});

describe('WebSocket assertions through the shared engine', () => {
  it('asserts on raw message text', () => {
    const summary = runAssertions(
      [
        { source: 'message', operator: 'contains', expected: 'user.created' },
        { source: 'message', operator: 'startsWith', expected: '{' },
        { source: 'message', operator: 'isNotEmpty', expected: '' },
      ],
      wsContext(),
    );

    expect(summary.allPassed).toBe(true);
  });

  it('asserts on JSON fields using the same source HTTP uses', () => {
    const summary = runAssertions(
      [
        { source: 'json', path: '$.type', operator: 'equals', expected: 'user.created' },
        { source: 'json', path: '$.data.id', operator: 'equals', expected: '7' },
        { source: 'json', path: '$.missing', operator: 'notExists', expected: '' },
      ],
      wsContext(),
    );

    expect(summary.allPassed).toBe(true);
  });

  it('asserts on message type and size', () => {
    const summary = runAssertions(
      [
        { source: 'messageType', operator: 'equals', expected: 'json' },
        { source: 'messageSize', operator: 'greaterThan', expected: '5' },
      ],
      wsContext(),
    );

    expect(summary.allPassed).toBe(true);
  });

  it('asserts on how many messages arrived', () => {
    const summary = runAssertions(
      [{ source: 'messageCount', operator: 'equals', expected: '3' }],
      wsContext({ count: 3 }),
    );
    expect(summary.allPassed).toBe(true);
  });

  it('asserts on connection state', () => {
    expect(
      runAssertions([{ source: 'connection', operator: 'equals', expected: 'open' }], wsContext()).allPassed,
    ).toBe(true);
  });

  it('asserts on the close code and reason', () => {
    // Testing "the server rejected us with 4001" is often *the* auth test.
    const context = wsContext({
      connection: { state: 'closed', closeCode: 4001, closeReason: 'Unauthorized' },
    });

    const summary = runAssertions(
      [
        { source: 'connection', operator: 'equals', expected: 'closed' },
        { source: 'closeCode', operator: 'equals', expected: '4001' },
        { source: 'closeReason', operator: 'contains', expected: 'Unauthorized' },
      ],
      context,
    );

    expect(summary.allPassed).toBe(true);
  });

  it('reports actual alongside expected on failure, like every other assertion', () => {
    const summary = runAssertions(
      [{ source: 'messageType', operator: 'equals', expected: 'text' }],
      wsContext(),
    );

    expect(summary.allPassed).toBe(false);
    expect(summary.results[0].actual).toBe('json');
  });

  it('an empty assertion list is still not a pass', () => {
    expect(runAssertions([], wsContext()).allPassed).toBe(false);
  });
});

describe('WebSocket captures through the shared engine', () => {
  it('captures a JSONPath value from a received message', () => {
    const [capture] = runCaptures(
      [{ source: 'json', path: '$.data.id', variableName: 'userId' }],
      wsContext(),
    );

    expect(capture.variableName).toBe('userId');
    expect(capture.value).toBe(7);
  });

  it('captures the whole message text', () => {
    const [capture] = runCaptures(
      [{ source: 'message', variableName: 'raw' }],
      wsContext({ payload: 'pong', type: 'text' }),
    );
    expect(capture.value).toBe('pong');
  });

  it('reports a miss rather than capturing undefined', () => {
    const [capture] = runCaptures([{ source: 'json', path: '$.nope', variableName: 'x' }], wsContext());
    expect(capture.error).toBe('Value not found.');
  });
});

describe('WebSocket assertion validation', () => {
  it('accepts the WebSocket sources', () => {
    expect(
      validateWsAssertions([
        { source: 'message', operator: 'contains', expected: 'x' },
        { source: 'json', path: '$.a', operator: 'equals', expected: '1' },
        { source: 'closeCode', operator: 'equals', expected: '1000' },
      ]),
    ).toEqual([]);
  });

  it('rejects HTTP-only sources — a message has no status code', () => {
    expect(validateWsAssertions([{ source: 'status', operator: 'equals', expected: '200' }]).join(' ')).toMatch(
      /source must be one of/,
    );
    expect(validateWsAssertions([{ source: 'header', operator: 'exists', expected: '' }]).join(' ')).toMatch(
      /source must be one of/,
    );
  });

  it('rejects an operator that makes no sense for the source', () => {
    expect(validateWsAssertions([{ source: 'messageType', operator: 'greaterThan', expected: 'x' }]).join(' ')).toMatch(
      /operator must be one of/,
    );
  });

  it('requires a path for json assertions', () => {
    expect(validateWsAssertions([{ source: 'json', operator: 'exists', expected: '' }]).join(' ')).toMatch(/path is required/);
  });
});

describe('wait condition validation', () => {
  it('accepts valid conditions', () => {
    expect(validateWaitCondition({ strategy: 'next' })).toEqual([]);
    expect(validateWaitCondition({ strategy: 'contains', value: 'x' })).toEqual([]);
    expect(validateWaitCondition({ strategy: 'jsonPath', path: '$.type', value: 'ready' })).toEqual([]);
    expect(validateWaitCondition({ strategy: 'silence' })).toEqual([]);
    expect(validateWaitCondition(undefined)).toEqual([]);
  });

  it('requires the fields each strategy needs', () => {
    expect(validateWaitCondition({ strategy: 'jsonPath' }).join(' ')).toMatch(/path is required/);
    expect(validateWaitCondition({ strategy: 'contains' }).join(' ')).toMatch(/value is required/);
    expect(validateWaitCondition({ strategy: 'sequence' }).join(' ')).toMatch(/non-empty array/);
  });

  it('rejects an unknown strategy', () => {
    expect(validateWaitCondition({ strategy: 'telepathy' }).join(' ')).toMatch(/strategy must be one of/);
  });

  it('refuses a timeout that would let a run hang', () => {
    expect(validateWaitCondition({ strategy: 'next', timeoutMs: 10 * 60 * 1000 }).join(' ')).toMatch(/may not exceed/);
    expect(validateWaitCondition({ strategy: 'next', timeoutMs: -1 }).join(' ')).toMatch(/positive number/);
  });
});
