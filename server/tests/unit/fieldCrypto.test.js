import { describe, it, expect } from 'vitest';
import {
  encryptField,
  decryptField,
  isEncrypted,
  encryptAuth,
  decryptAuth,
  encryptRequestSecrets,
  decryptRequestSecrets,
  ENCRYPTED_AUTH_PATHS,
} from '../../src/services/security/fieldCrypto.js';
import { Request as SavedRequest } from '../../src/models/Request.js';

describe('encrypting a single value', () => {
  it('round-trips', () => {
    expect(decryptField(encryptField('sk-live-SECRET'))).toBe('sk-live-SECRET');
  });

  it('does not leave the plaintext anywhere in the stored value', () => {
    const stored = encryptField('sk-live-SECRET');
    expect(stored).not.toContain('sk-live-SECRET');
    expect(isEncrypted(stored)).toBe(true);
  });

  it('produces different ciphertext each time, so equal secrets are not equal at rest', () => {
    // A deterministic scheme would let anyone reading the database see which accounts
    // share a token — and reusing a GCM nonce is how AES-GCM fails catastrophically.
    const a = encryptField('same-secret');
    const b = encryptField('same-secret');
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe('same-secret');
    expect(decryptField(b)).toBe('same-secret');
  });

  it('is idempotent, so re-saving does not double-encrypt', () => {
    const once = encryptField('token');
    expect(encryptField(once)).toBe(once);
    expect(decryptField(encryptField(once))).toBe('token');
  });

  it('leaves empty values and non-strings alone', () => {
    expect(encryptField('')).toBe('');
    expect(encryptField(undefined)).toBeUndefined();
    expect(encryptField(null)).toBeNull();
    expect(encryptField(42)).toBe(42);
  });

  it('handles unicode and long values', () => {
    const value = '🔑 ключ '.repeat(200);
    expect(decryptField(encryptField(value))).toBe(value);
  });
});

describe('decrypting', () => {
  it('passes through plaintext written before encryption existed', () => {
    // Rows already in the database have no marker. Refusing them would break every
    // request saved so far; they re-encrypt on the next write.
    expect(decryptField('plain-old-token')).toBe('plain-old-token');
    expect(decryptField('')).toBe('');
    expect(decryptField(undefined)).toBeUndefined();
  });

  it('throws on a tampered value rather than returning something plausible', () => {
    // GCM authenticates the ciphertext. Silently returning '' would look like "no
    // token configured" and send an unauthenticated request instead.
    const stored = encryptField('sk-live-SECRET');
    const [prefix, iv, tag, data] = [
      stored.slice(0, 7),
      ...stored.slice(7).split(':'),
    ];
    const flipped = data.slice(0, -4) + (data.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');

    expect(() => decryptField(`${prefix}${iv}:${tag}:${flipped}`)).toThrow(/could not be decrypted/i);
  });

  it('throws on a malformed marked value', () => {
    expect(() => decryptField('enc:v1:not-enough-parts')).toThrow(/malformed|could not be decrypted/i);
  });
});

describe('the auth block', () => {
  const fullAuth = () => ({
    type: 'oauth2',
    basic: { username: 'ada', password: 'hunter2-and-more' },
    bearer: { token: 'sk-live-BEARER' },
    apiKey: { key: 'X-Api-Key', value: 'sk-live-APIKEY', addTo: 'header' },
    oauth2: {
      grantType: 'clientCredentials',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'public-client-id',
      clientSecret: 'sk-live-CLIENTSECRET',
      accessToken: 'sk-live-ACCESS',
      refreshToken: 'sk-live-REFRESH',
    },
  });

  it('round-trips every secret', () => {
    expect(decryptAuth(encryptAuth(fullAuth()))).toEqual(fullAuth());
  });

  it('encrypts every secret-bearing field', () => {
    const encrypted = encryptAuth(fullAuth());
    for (const [group, field] of ENCRYPTED_AUTH_PATHS) {
      expect(isEncrypted(encrypted[group][field]), `${group}.${field} was left in plaintext`).toBe(true);
    }
  });

  it('leaves the non-secret fields readable', () => {
    // Encrypting these would protect nothing and make the data unreadable to debug.
    const encrypted = encryptAuth(fullAuth());
    expect(encrypted.type).toBe('oauth2');
    expect(encrypted.basic.username).toBe('ada');
    expect(encrypted.apiKey.key).toBe('X-Api-Key');
    expect(encrypted.apiKey.addTo).toBe('header');
    expect(encrypted.oauth2.clientId).toBe('public-client-id');
    expect(encrypted.oauth2.tokenUrl).toBe('https://auth.example.com/token');
  });

  it('does not mutate the object it was given', () => {
    // These are sometimes request bodies and sometimes Mongoose documents.
    const original = fullAuth();
    encryptAuth(original);
    expect(original.bearer.token).toBe('sk-live-BEARER');
  });

  it('survives a partial or absent auth block', () => {
    expect(encryptAuth(undefined)).toBeUndefined();
    expect(encryptAuth(null)).toBeNull();
    expect(encryptAuth({ type: 'none' })).toEqual({ type: 'none' });
    expect(decryptAuth(encryptAuth({ type: 'bearer', bearer: { token: 't' } }))).toEqual({
      type: 'bearer',
      bearer: { token: 't' },
    });
  });
});

describe('a whole saved request', () => {
  it('encrypts only the auth block, leaving the request usable', () => {
    const request = {
      name: 'Get me',
      url: 'https://api.example.com/me',
      method: 'GET',
      auth: { type: 'bearer', bearer: { token: 'sk-live-SECRET' } },
    };

    const stored = encryptRequestSecrets(request);
    expect(stored.name).toBe('Get me');
    expect(stored.url).toBe('https://api.example.com/me');
    expect(JSON.stringify(stored)).not.toContain('sk-live-SECRET');

    expect(decryptRequestSecrets(stored)).toEqual(request);
  });

  it('survives a request with no auth at all', () => {
    expect(encryptRequestSecrets({ name: 'x' })).toEqual({ name: 'x', auth: undefined });
    expect(decryptRequestSecrets(null)).toBeNull();
  });
});

describe('no secret-bearing field is left uncovered', () => {
  /**
   * `auth` is a subdocument, so the parent schema exposes it as the single path
   * 'auth' — never 'auth.bearer.token'. Reading it from SavedRequest.schema.paths
   * and filtering for 'auth.' therefore matches nothing, and the check silently
   * passes no matter what is added to the model.
   *
   * That is exactly what this test did when it was written, which makes it a decent
   * warning: a guard that cannot fail is worse than no guard, because it is believed.
   * The nested paths live on the subdocument's own schema.
   */
  const authPaths = () => Object.keys(SavedRequest.schema.path('auth').schema.paths);

  it('reads the nested auth paths at all', () => {
    // Guards the guard. If this list ever comes back empty the check below becomes
    // vacuous again, and would report success while covering nothing.
    const paths = authPaths();
    expect(paths.length).toBeGreaterThan(5);
    expect(paths).toContain('bearer.token');
    expect(paths).toContain('oauth2.clientSecret');
  });

  it('covers every field in the schema whose name suggests a secret', () => {
    // Adding `auth.oauth2.idToken` to the model without adding it to
    // ENCRYPTED_AUTH_PATHS would otherwise store it in plaintext, silently.
    const SECRET_NAMES = /password|token|secret|value/i;
    // An address is not a credential, and `tokenUrl` contains "token". Excluded by
    // suffix rather than by name so `introspectionUrl` or any future endpoint is
    // covered too.
    const IS_ADDRESS = /(url|uri)$/i;
    const covered = new Set(ENCRYPTED_AUTH_PATHS.map(([g, f]) => `${g}.${f}`));

    const uncovered = authPaths()
      .map((p) => ({ path: p, leaf: p.split('.').pop() }))
      .filter(({ leaf }) => SECRET_NAMES.test(leaf) && !IS_ADDRESS.test(leaf))
      .map(({ path }) => path)
      .filter((p) => !covered.has(p))
      // apiKey.key is a header *name*, not a credential.
      .filter((p) => p !== 'apiKey.key');

    expect(
      uncovered,
      `These auth fields look like secrets but are stored in plaintext:\n  ${uncovered.join('\n  ')}`,
    ).toEqual([]);
  });
});
