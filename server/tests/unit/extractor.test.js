import { describe, it, expect } from 'vitest';
import { extractActualValue } from '../../src/services/assertions/extractor.js';

const context = {
  status: 200,
  time: 243,
  headers: { 'content-type': 'application/json', 'x-request-id': 'abc123' },
  body: { id: 1, name: 'John', data: { token: 'tok_42' }, tags: ['a', 'b'] },
};

describe('extractActualValue — status and time', () => {
  it('reads the status code and response time straight from the context', () => {
    expect(extractActualValue({ source: 'status' }, context)).toEqual({ value: 200 });
    expect(extractActualValue({ source: 'time' }, context)).toEqual({ value: 243 });
  });
});

describe('extractActualValue — headers', () => {
  it('looks headers up case-insensitively', () => {
    // HTTP header names are case-insensitive, and users type them however they like.
    expect(extractActualValue({ source: 'header', headerName: 'Content-Type' }, context).value).toBe(
      'application/json',
    );
    expect(extractActualValue({ source: 'header', headerName: 'content-type' }, context).value).toBe(
      'application/json',
    );
  });

  it('returns undefined for a header that was not sent', () => {
    expect(extractActualValue({ source: 'header', headerName: 'x-missing' }, context).value).toBe(
      undefined,
    );
  });
});

describe('extractActualValue — JSONPath', () => {
  it('extracts top-level and nested values', () => {
    expect(extractActualValue({ source: 'json', path: '$.id' }, context).value).toBe(1);
    expect(extractActualValue({ source: 'json', path: '$.data.token' }, context).value).toBe('tok_42');
  });

  it('extracts array members', () => {
    expect(extractActualValue({ source: 'json', path: '$.tags[0]' }, context).value).toBe('a');
  });

  it('returns undefined when the path matches nothing', () => {
    expect(extractActualValue({ source: 'json', path: '$.nope' }, context).value).toBe(undefined);
  });

  it('never throws on a malformed path — the whole request must not fail', () => {
    expect(() => extractActualValue({ source: 'json', path: '$[[[' }, context)).not.toThrow();
  });

  it('survives a non-object body', () => {
    const textContext = { ...context, body: 'plain text response' };
    expect(() => extractActualValue({ source: 'json', path: '$.id' }, textContext)).not.toThrow();
  });
});

describe('extractActualValue — unknown source', () => {
  it('returns undefined instead of throwing', () => {
    expect(extractActualValue({ source: 'nonsense' }, context)).toEqual({ value: undefined });
  });
});
