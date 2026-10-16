import { describe, it, expect } from 'vitest';
import { buildHandshake } from '../../src/services/websocket/handshake.js';
import { applyAuth, basicAuthHeader } from '../../src/services/auth/applyAuth.js';

const base = { url: 'wss://example.com/socket' };

describe('applyAuth — one set of rules for both protocols', () => {
  it('returns nothing for no auth', () => {
    expect(applyAuth({ type: 'none' })).toEqual({ headers: {}, params: {}, basic: null });
    expect(applyAuth(undefined)).toEqual({ headers: {}, params: {}, basic: null });
  });

  it('puts a bearer token in the Authorization header', () => {
    expect(applyAuth({ type: 'bearer', bearer: { token: 't' } }).headers.Authorization).toBe('Bearer t');
  });

  it('omits an empty bearer token rather than sending "Bearer "', () => {
    expect(applyAuth({ type: 'bearer', bearer: { token: '' } }).headers).toEqual({});
  });

  it('places an API key in a header or the query, as configured', () => {
    expect(applyAuth({ type: 'apiKey', apiKey: { key: 'X-Key', value: 'v', addTo: 'header' } }).headers['X-Key']).toBe('v');
    expect(applyAuth({ type: 'apiKey', apiKey: { key: 'k', value: 'v', addTo: 'query' } }).params.k).toBe('v');
  });

  it('ignores an API key with no key name', () => {
    expect(applyAuth({ type: 'apiKey', apiKey: { key: '  ', value: 'v', addTo: 'header' } }).headers).toEqual({});
  });

  it('returns basic credentials separately so HTTP can use axios native handling', () => {
    expect(applyAuth({ type: 'basic', basic: { username: 'u', password: 'p' } }).basic).toEqual({
      username: 'u',
      password: 'p',
    });
  });

  it('encodes basic auth as a header for callers without native support', () => {
    expect(basicAuthHeader({ username: 'user', password: 'pass' })).toBe('Basic dXNlcjpwYXNz');
  });

  it('attaches an OAuth token as a bearer, and nothing without one', () => {
    expect(applyAuth({ type: 'oauth2' }, 'tok').headers.Authorization).toBe('Bearer tok');
    expect(applyAuth({ type: 'oauth2' }, undefined).headers).toEqual({});
  });
});

describe('buildHandshake — URL and query parameters', () => {
  it('requires a URL', async () => {
    await expect(buildHandshake({})).rejects.toThrow(/URL is required/i);
  });

  it('folds enabled query parameters into the URL', async () => {
    const hs = await buildHandshake({
      ...base,
      params: [
        { key: 'room', value: 'general', enabled: true },
        { key: 'skip', value: 'no', enabled: false },
      ],
    });

    const url = new URL(hs.url);
    expect(url.searchParams.get('room')).toBe('general');
    expect(url.searchParams.get('skip')).toBe(null);
  });

  it('keeps query parameters already present in the URL', async () => {
    const hs = await buildHandshake({
      url: 'wss://example.com/socket?existing=1',
      params: [{ key: 'added', value: '2', enabled: true }],
    });

    const url = new URL(hs.url);
    expect(url.searchParams.get('existing')).toBe('1');
    expect(url.searchParams.get('added')).toBe('2');
  });

  it('rejects a malformed URL', async () => {
    await expect(buildHandshake({ url: 'not a url' })).rejects.toThrow(/Invalid WebSocket URL/i);
  });
});

describe('buildHandshake — variables', () => {
  const variables = { wsBase: 'wss://example.com', token: 'abc123', room: 'lobby' };

  it('substitutes in the URL, query parameters and headers', async () => {
    const hs = await buildHandshake(
      {
        url: '{{wsBase}}/socket',
        params: [{ key: 'room', value: '{{room}}', enabled: true }],
        headers: [{ key: 'X-Token', value: '{{token}}', enabled: true }],
      },
      variables,
    );

    expect(hs.url).toContain('wss://example.com/socket');
    expect(new URL(hs.url).searchParams.get('room')).toBe('lobby');
    expect(hs.headers['X-Token']).toBe('abc123');
  });

  it('substitutes inside auth values', async () => {
    const hs = await buildHandshake(
      { ...base, auth: { type: 'bearer', bearer: { token: '{{token}}' } } },
      variables,
    );

    expect(hs.headers.Authorization).toBe('Bearer abc123');
  });

  it('reports an unresolved variable instead of connecting to a broken URL', async () => {
    await expect(buildHandshake({ url: '{{missing}}/socket' }, {})).rejects.toThrow(/missing/);
  });

  it('ignores unresolved variables in disabled rows', async () => {
    const hs = await buildHandshake(
      { ...base, params: [{ key: 'x', value: '{{nope}}', enabled: false }] },
      {},
    );
    expect(hs.url).toBe('wss://example.com/socket');
  });

  it('ignores unresolved variables in an inactive auth type', async () => {
    // Leftover Basic credentials after switching to Bearer must not block a connect.
    const hs = await buildHandshake(
      {
        ...base,
        auth: {
          type: 'bearer',
          bearer: { token: '{{token}}' },
          basic: { username: '{{staleUser}}', password: '{{stalePass}}' },
        },
      },
      variables,
    );
    expect(hs.headers.Authorization).toBe('Bearer abc123');
  });
});

describe('buildHandshake — authentication', () => {
  it('sends an API key as a header', async () => {
    const hs = await buildHandshake({
      ...base,
      auth: { type: 'apiKey', apiKey: { key: 'X-Api-Key', value: 'k', addTo: 'header' } },
    });
    expect(hs.headers['X-Api-Key']).toBe('k');
  });

  it('sends an API key in the query string when configured', async () => {
    const hs = await buildHandshake({
      ...base,
      auth: { type: 'apiKey', apiKey: { key: 'access_token', value: 'k', addTo: 'query' } },
    });
    expect(new URL(hs.url).searchParams.get('access_token')).toBe('k');
  });

  it('encodes basic auth into a handshake header', async () => {
    // A handshake has no separate credentials channel, so Basic must become a header.
    const hs = await buildHandshake({
      ...base,
      auth: { type: 'basic', basic: { username: 'user', password: 'pass' } },
    });
    expect(hs.headers.Authorization).toBe('Basic dXNlcjpwYXNz');
  });

  it('uses a stored OAuth 2.0 Authorization Code token', async () => {
    const hs = await buildHandshake({
      ...base,
      auth: { type: 'oauth2', oauth2: { grantType: 'authorizationCode', accessToken: 'stored' } },
    });
    expect(hs.headers.Authorization).toBe('Bearer stored');
  });

  it('refuses Authorization Code with no token yet, naming the fix', async () => {
    await expect(
      buildHandshake({ ...base, auth: { type: 'oauth2', oauth2: { grantType: 'authorizationCode' } } }),
    ).rejects.toThrow(/Auth tab/i);
  });

  it('lets auth win a header collision with a user row', async () => {
    const hs = await buildHandshake({
      ...base,
      headers: [{ key: 'Authorization', value: 'USER', enabled: true }],
      auth: { type: 'bearer', bearer: { token: 'AUTH' } },
    });
    expect(hs.headers.Authorization).toBe('Bearer AUTH');
  });
});

describe('buildHandshake — subprotocols', () => {
  it('passes requested subprotocols through', async () => {
    const hs = await buildHandshake({ ...base, subprotocols: ['graphql-ws', 'json'] });
    expect(hs.subprotocols).toEqual(['graphql-ws', 'json']);
  });

  it('trims and drops empty entries', async () => {
    const hs = await buildHandshake({ ...base, subprotocols: ['  graphql-ws  ', '', '   '] });
    expect(hs.subprotocols).toEqual(['graphql-ws']);
  });

  it('defaults to none', async () => {
    expect((await buildHandshake(base)).subprotocols).toEqual([]);
  });
});
