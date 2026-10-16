import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  assertPasswordAcceptable,
  MIN_LENGTH,
} from '../../src/services/accounts/passwords.js';
import {
  createToken,
  hashToken,
  tokenMatches,
  isExpired,
  VERIFY_TTL_MS,
  RESET_TTL_MS,
} from '../../src/services/accounts/tokens.js';
import { ValidationError } from '../../src/utils/errors.js';

describe('password hashing', () => {
  it('produces a bcrypt hash that verifies', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
  });

  it('never stores the password itself', async () => {
    const password = 'correct horse battery';
    expect(await hashPassword(password)).not.toContain(password);
  });

  it('salts, so the same password hashes differently every time', async () => {
    // Without a per-password salt, identical passwords share a hash and one rainbow
    // table cracks every account at once.
    const [a, b] = await Promise.all([hashPassword('same password here'), hashPassword('same password here')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password here', a)).toBe(true);
    expect(await verifyPassword('same password here', b)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('incorrect horse battery', hash)).toBe(false);
  });

  it('returns false rather than throwing for an account with no password', async () => {
    // A Google-only account has no hash; signing in with a password must simply fail.
    expect(await verifyPassword('anything at all', null)).toBe(false);
    expect(await verifyPassword('anything at all', undefined)).toBe(false);
  });

  it('rejects empty input without consulting the hash', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('', hash)).toBe(false);
    expect(await verifyPassword(null, hash)).toBe(false);
  });
});

describe('password rules', () => {
  it('requires a minimum length', () => {
    expect(() => assertPasswordAcceptable('a'.repeat(MIN_LENGTH - 1))).toThrow(ValidationError);
    expect(assertPasswordAcceptable('a'.repeat(MIN_LENGTH + 5))).toBe(true);
  });

  it('refuses a password bcrypt would silently truncate', () => {
    // Past 72 bytes bcrypt ignores the rest, so the tail of a long passphrase would
    // count for nothing — and the user would never know.
    expect(() => assertPasswordAcceptable('a'.repeat(73))).toThrow(/too long/i);
    // Multi-byte characters hit the limit sooner; the check is on bytes, not length.
    expect(() => assertPasswordAcceptable('é'.repeat(37))).toThrow(/too long/i);
  });

  it('refuses the handful of universally common passwords', () => {
    expect(() => assertPasswordAcceptable('password123')).toThrow(/commonly used/i);
    expect(() => assertPasswordAcceptable('PASSWORD123')).toThrow(/commonly used/i);
  });

  it('requires something to be supplied at all', () => {
    expect(() => assertPasswordAcceptable('')).toThrow(ValidationError);
    expect(() => assertPasswordAcceptable(undefined)).toThrow(ValidationError);
  });
});

describe('single-use tokens', () => {
  it('returns a raw token and a hash that are not the same value', () => {
    // The raw token is emailed; only the hash is stored. If they matched, reading the
    // database would be enough to reset anyone's password.
    const { raw, hash } = createToken(RESET_TTL_MS);
    expect(raw).toBeTruthy();
    expect(hash).toBeTruthy();
    expect(hash).not.toBe(raw);
  });

  it('is unguessable and unique per call', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createToken(RESET_TTL_MS).raw));
    expect(tokens.size).toBe(200);
    expect([...tokens][0].length).toBeGreaterThanOrEqual(40);
  });

  it('matches a token against its stored hash', () => {
    const { raw, hash } = createToken(VERIFY_TTL_MS);
    expect(tokenMatches(raw, hash)).toBe(true);
  });

  it('rejects a token that was not the one issued', () => {
    const { hash } = createToken(VERIFY_TTL_MS);
    const other = createToken(VERIFY_TTL_MS);
    expect(tokenMatches(other.raw, hash)).toBe(false);
  });

  it('rejects missing values instead of treating them as a match', () => {
    const { raw, hash } = createToken(VERIFY_TTL_MS);
    expect(tokenMatches(null, hash)).toBe(false);
    expect(tokenMatches(raw, null)).toBe(false);
    expect(tokenMatches(undefined, undefined)).toBe(false);
  });

  it('does not throw on a malformed token of the wrong length', () => {
    // timingSafeEqual throws when the buffers differ in length, which would turn a
    // junk token into a 500 — and the length difference into a signal.
    const { hash } = createToken(VERIFY_TTL_MS);
    expect(tokenMatches('short', hash)).toBe(false);
    expect(tokenMatches('x'.repeat(500), hash)).toBe(false);
  });

  it('hashes deterministically, so a stored hash keeps matching', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('treats a past expiry as expired, and a missing one as expired too', () => {
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isExpired(new Date(Date.now() + 60_000))).toBe(false);
    // A null expiry must not read as "never expires".
    expect(isExpired(null)).toBe(true);
    expect(isExpired(undefined)).toBe(true);
  });

  it('keeps both links short-lived', () => {
    // Verification: someone is waiting on the sign-up page, so ten minutes is plenty.
    expect(VERIFY_TTL_MS).toBe(10 * 60 * 1000);
    // Reset: an hour, since the email may take a while to be noticed — and never more.
    expect(RESET_TTL_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});
