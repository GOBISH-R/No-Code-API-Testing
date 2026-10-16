import { describe, it, expect } from 'vitest';
import { resolveRequestConfig } from '../../src/services/variables/variableResolver.js';
import { validateRequestConfig } from '../../src/validators/requestValidator.js';
import { toPortableRequest } from '../../src/importExport/collectionFormat.js';

const variables = { userId: '7', token: 'tok_42' };

function config(body, overrides = {}) {
  return {
    protocol: 'rest',
    method: 'POST',
    url: 'https://api.example.com/login',
    params: [],
    headers: [],
    body,
    auth: { type: 'none' },
    ...overrides,
  };
}

describe('body modes — validation', () => {
  it('accepts every supported mode', () => {
    for (const mode of ['none', 'json', 'urlencoded', 'text']) {
      expect(validateRequestConfig(config({ mode, raw: '', rows: [] }))).toEqual([]);
    }
  });

  it('rejects an unknown mode', () => {
    const errors = validateRequestConfig(config({ mode: 'multipart', raw: '' }));
    expect(errors.join(' ')).toMatch(/body.mode/);
  });

  it('still rejects malformed JSON in json mode', () => {
    const errors = validateRequestConfig(config({ mode: 'json', raw: '{broken' }));
    expect(errors.join(' ')).toMatch(/valid JSON/);
  });

  it('rejects malformed rows in urlencoded mode', () => {
    const errors = validateRequestConfig(config({ mode: 'urlencoded', rows: [{ key: 'a' }] }));
    expect(errors.join(' ')).toMatch(/body.rows/);
  });

  it('does not apply JSON validation to raw text mode', () => {
    // Raw text is deliberately unvalidated — XML, CSV and plain strings are all valid.
    expect(validateRequestConfig(config({ mode: 'text', raw: '<xml>not json</xml>' }))).toEqual([]);
  });
});

describe('body modes — variable resolution', () => {
  it('substitutes into urlencoded rows', () => {
    const { config: resolved } = resolveRequestConfig(
      config({ mode: 'urlencoded', rows: [{ key: 'user', value: '{{userId}}', enabled: true }] }),
      variables,
    );

    expect(resolved.body.rows[0].value).toBe('7');
  });

  it('substitutes into raw text', () => {
    const { config: resolved } = resolveRequestConfig(
      config({ mode: 'text', raw: 'token={{token}}' }),
      variables,
    );

    expect(resolved.body.raw).toBe('token=tok_42');
  });

  it('skips disabled urlencoded rows (same rule as params and headers)', () => {
    const { missing } = resolveRequestConfig(
      config({
        mode: 'urlencoded',
        rows: [
          { key: 'user', value: '{{userId}}', enabled: true },
          { key: 'stale', value: '{{doesNotExist}}', enabled: false },
        ],
      }),
      variables,
    );

    expect(missing).toEqual([]);
  });

  it('does not resolve the field belonging to an inactive mode', () => {
    // A leftover placeholder in `raw` must not block a urlencoded request, since
    // `raw` is never sent in that mode.
    const { missing } = resolveRequestConfig(
      config({
        mode: 'urlencoded',
        raw: '{{neverSentInUrlencodedMode}}',
        rows: [{ key: 'user', value: '{{userId}}', enabled: true }],
      }),
      variables,
    );

    expect(missing).toEqual([]);
  });

  it('does not resolve rows when the mode is json', () => {
    const { missing } = resolveRequestConfig(
      config({
        mode: 'json',
        raw: '{"id":"{{userId}}"}',
        rows: [{ key: 'stale', value: '{{doesNotExist}}', enabled: true }],
      }),
      variables,
    );

    expect(missing).toEqual([]);
  });
});

describe('body modes — export round-trip', () => {
  it('carries mode, raw and rows into the portable format', () => {
    // Regression: a new body field missing here would be silently dropped on every
    // export/import, exactly as happened once before with protocol/graphql.
    const portable = toPortableRequest({
      name: 'Login',
      method: 'POST',
      url: 'https://api.example.com/login',
      body: {
        mode: 'urlencoded',
        raw: '',
        rows: [{ key: 'username', value: 'admin', enabled: true }],
      },
    });

    expect(portable.body.mode).toBe('urlencoded');
    expect(portable.body.rows).toEqual([{ key: 'username', value: 'admin', enabled: true }]);
  });

  it('defaults cleanly for a request that has no body at all', () => {
    const portable = toPortableRequest({ name: 'Get', method: 'GET', url: 'https://x.com' });
    expect(portable.body).toEqual({ mode: 'none', raw: '', rows: [], form: [] });
  });
});
