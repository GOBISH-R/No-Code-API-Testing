import { describe, it, expect } from 'vitest';
import { runCaptures } from '../../src/services/variables/captureEngine.js';

const context = {
  status: 201,
  time: 120,
  headers: { 'x-request-id': 'req_9' },
  body: { token: 'tok_42', user: { id: 7 } },
};

describe('runCaptures', () => {
  it('captures a JSONPath value as a named variable', () => {
    const [capture] = runCaptures([{ source: 'json', path: '$.token', variableName: 'token' }], context);

    expect(capture.variableName).toBe('token');
    expect(capture.value).toBe('tok_42');
    expect(capture.error).toBe(null);
  });

  it('captures from status, time and headers too', () => {
    const results = runCaptures(
      [
        { source: 'status', variableName: 'lastStatus' },
        { source: 'time', variableName: 'lastTime' },
        { source: 'header', headerName: 'X-Request-Id', variableName: 'requestId' },
      ],
      context,
    );

    expect(results.map((r) => r.value)).toEqual([201, 120, 'req_9']);
  });

  it('trims the variable name and skips unnamed rows', () => {
    const results = runCaptures(
      [
        { source: 'json', path: '$.token', variableName: '  token  ' },
        { source: 'json', path: '$.token', variableName: '   ' },
        { source: 'json', path: '$.token' },
      ],
      context,
    );

    expect(results).toHaveLength(1);
    expect(results[0].variableName).toBe('token');
  });

  it('reports a miss rather than capturing undefined', () => {
    // Capturing "nothing" silently would surface later as a confusing unresolved
    // {{variable}} in the next request instead of here, where the cause is obvious.
    const [capture] = runCaptures([{ source: 'json', path: '$.nope', variableName: 'x' }], context);

    expect(capture.value).toBe(undefined);
    expect(capture.error).toBe('Value not found.');
  });

  it('handles an empty or missing capture list', () => {
    expect(runCaptures([], context)).toEqual([]);
    expect(runCaptures(undefined, context)).toEqual([]);
  });
});
