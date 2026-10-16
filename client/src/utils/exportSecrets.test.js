import { describe, it, expect } from 'vitest';
import { summarizeSecrets, describeSecrets } from './exportSecrets.js';

function doc(requests) {
  return { collection: { name: 'C', requests } };
}

// Every exported request carries the full auth shape, mostly blank.
function auth(overrides = {}) {
  return {
    type: 'none',
    basic: { username: '', password: '' },
    bearer: { token: '' },
    apiKey: { key: '', value: '', addTo: 'header' },
    oauth2: { clientSecret: '', accessToken: '', refreshToken: '' },
    ...overrides,
  };
}

describe('summarizeSecrets', () => {
  it('finds nothing in a collection with no credentials', () => {
    const summary = summarizeSecrets(doc([{ name: 'A', auth: auth() }]));
    expect(summary.total).toBe(0);
    expect(summary.parts).toEqual([]);
  });

  it('ignores blank and whitespace-only values', () => {
    // Otherwise every export would warn, and the warning would stop meaning anything.
    const summary = summarizeSecrets(
      doc([{ name: 'A', auth: auth({ bearer: { token: '   ' } }) }]),
    );
    expect(summary.total).toBe(0);
  });

  it('counts a bearer token', () => {
    const summary = summarizeSecrets(
      doc([{ name: 'A', auth: auth({ bearer: { token: 'sk-live-x' } }) }]),
    );
    expect(summary.total).toBe(1);
    expect(summary.parts).toEqual(['1 bearer token']);
    expect(summary.requestNames).toEqual(['A']);
  });

  it('counts each kind separately and pluralises', () => {
    const summary = summarizeSecrets(
      doc([
        { name: 'A', auth: auth({ bearer: { token: 't1' } }) },
        { name: 'B', auth: auth({ oauth2: { clientSecret: 's1', accessToken: 'a1' } }) },
        { name: 'C', auth: auth({ oauth2: { clientSecret: 's2' } }) },
      ]),
    );

    expect(summary.total).toBe(4);
    expect(summary.parts).toEqual([
      '1 bearer token',
      '2 OAuth client secrets',
      '1 OAuth access token',
    ]);
  });

  it('counts a request once in requestNames even with several credentials', () => {
    const summary = summarizeSecrets(
      doc([{ name: 'A', auth: auth({ basic: { password: 'p' }, bearer: { token: 't' } }) }]),
    );
    expect(summary.total).toBe(2);
    expect(summary.requestCount).toBe(1);
  });

  it('names an untitled request rather than showing undefined', () => {
    const summary = summarizeSecrets(doc([{ auth: auth({ bearer: { token: 't' } }) }]));
    expect(summary.requestNames).toEqual(['Untitled request']);
  });

  it('survives a malformed or empty document', () => {
    expect(summarizeSecrets(undefined).total).toBe(0);
    expect(summarizeSecrets({}).total).toBe(0);
    expect(summarizeSecrets(doc([{ name: 'A' }])).total).toBe(0);
  });
});

describe('describeSecrets', () => {
  it('is empty when there is nothing to describe', () => {
    expect(describeSecrets({ parts: [] })).toBe('');
  });

  it('reads as a sentence', () => {
    expect(describeSecrets({ parts: ['1 bearer token'] })).toBe('1 bearer token');
    expect(describeSecrets({ parts: ['1 bearer token', '2 OAuth client secrets'] })).toBe(
      '1 bearer token and 2 OAuth client secrets',
    );
    expect(describeSecrets({ parts: ['1 password', '2 API keys', '1 bearer token'] })).toBe(
      '1 password, 2 API keys and 1 bearer token',
    );
  });
});
