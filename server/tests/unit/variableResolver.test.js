import { describe, it, expect } from 'vitest';
import { toVariableMap, resolveRequestConfig } from '../../src/services/variables/variableResolver.js';

const variables = { baseUrl: 'https://api.example.com', token: 'tok_42', userId: '7' };

function baseConfig(overrides = {}) {
  return {
    protocol: 'rest',
    method: 'GET',
    url: '{{baseUrl}}/users',
    params: [],
    headers: [],
    body: { mode: 'none', raw: '' },
    auth: { type: 'none' },
    ...overrides,
  };
}

describe('toVariableMap', () => {
  it('turns rows into a lookup, skipping blank keys and disabled rows', () => {
    const map = toVariableMap([
      { key: 'a', value: '1', enabled: true },
      { key: '  ', value: 'ignored', enabled: true },
      { key: 'b', value: '2', enabled: false },
      { key: 'c', value: '3' },
    ]);

    expect(map).toEqual({ a: '1', c: '3' });
  });

  it('handles a missing/undefined list', () => {
    expect(toVariableMap(undefined)).toEqual({});
  });
});

describe('resolveRequestConfig — substitution', () => {
  it('substitutes in the URL', () => {
    const { config, missing } = resolveRequestConfig(baseConfig(), variables);
    expect(config.url).toBe('https://api.example.com/users');
    expect(missing).toEqual([]);
  });

  it('reports unknown variables instead of sending a broken request', () => {
    const { config, missing } = resolveRequestConfig(
      baseConfig({ url: '{{baseUrl}}/{{nope}}' }),
      variables,
    );
    expect(missing).toEqual(['nope']);
    // The unresolved placeholder is left as-is so the caller can name it.
    expect(config.url).toContain('{{nope}}');
  });

  it('substitutes in enabled params and headers', () => {
    const { config } = resolveRequestConfig(
      baseConfig({
        params: [{ key: 'user', value: '{{userId}}', enabled: true }],
        headers: [{ key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
      }),
      variables,
    );

    expect(config.params[0].value).toBe('7');
    expect(config.headers[0].value).toBe('Bearer tok_42');
  });

  it('substitutes in a JSON body', () => {
    const { config } = resolveRequestConfig(
      baseConfig({ body: { mode: 'json', raw: '{"id":"{{userId}}"}' } }),
      variables,
    );
    expect(config.body.raw).toBe('{"id":"7"}');
  });
});

describe('resolveRequestConfig — disabled rows are not resolved (regression)', () => {
  it('ignores an unresolved variable sitting in a disabled row', () => {
    // Regression: a disabled row is never sent, so an unknown {{variable}} in one
    // must not block execution of the whole request.
    const { missing } = resolveRequestConfig(
      baseConfig({
        params: [{ key: 'stale', value: '{{doesNotExist}}', enabled: false }],
        headers: [{ key: 'X-Old', value: '{{alsoMissing}}', enabled: false }],
      }),
      variables,
    );

    expect(missing).toEqual([]);
  });
});

describe('resolveRequestConfig — inactive auth is not resolved (regression)', () => {
  it('ignores unresolved variables in an auth type that is not active', () => {
    // Regression: leftover Basic credentials after switching to Bearer must not
    // block execution, since only the active auth type is ever sent.
    const { missing } = resolveRequestConfig(
      baseConfig({
        auth: {
          type: 'bearer',
          basic: { username: '{{missingUser}}', password: '{{missingPass}}' },
          bearer: { token: '{{token}}' },
        },
      }),
      variables,
    );

    expect(missing).toEqual([]);
  });

  it('does resolve the active auth type', () => {
    const { config } = resolveRequestConfig(
      baseConfig({ auth: { type: 'bearer', bearer: { token: '{{token}}' } } }),
      variables,
    );
    expect(config.auth.bearer.token).toBe('tok_42');
  });

  it('resolves OAuth 2.0 fields and preserves the non-string grantType', () => {
    const { config } = resolveRequestConfig(
      baseConfig({
        auth: {
          type: 'oauth2',
          oauth2: {
            grantType: 'authorizationCode',
            clientId: '{{token}}',
            accessToken: '',
            expiresAt: 123,
          },
        },
      }),
      variables,
    );

    expect(config.auth.oauth2.clientId).toBe('tok_42');
    expect(config.auth.oauth2.grantType).toBe('authorizationCode');
    expect(config.auth.oauth2.expiresAt).toBe(123);
  });
});

describe('resolveRequestConfig — protocol-specific fields (regression)', () => {
  it('resolves graphql fields and leaves the unused body alone in graphql mode', () => {
    const { config, missing } = resolveRequestConfig(
      baseConfig({
        protocol: 'graphql',
        method: 'POST',
        body: { mode: 'json', raw: '{{neverSentInGraphQLMode}}' },
        graphql: { query: 'query { user(id: "{{userId}}") { id } }', variables: '', operationName: '' },
      }),
      variables,
    );

    expect(config.graphql.query).toContain('"7"');
    // The body is unused in GraphQL mode, so a stale placeholder there must not block.
    expect(missing).toEqual([]);
  });
});
