import crypto from 'node:crypto';

/**
 * Single-use tokens for email verification and password reset.
 *
 * Two properties matter and both are easy to get wrong:
 *
 *  - The token is only ever *stored* hashed. A reset token in the database is a
 *    password-equivalent secret; anyone who can read the collection could otherwise
 *    take over every account in it.
 *  - Comparison is constant-time. A plain `===` on a secret leaks it to anyone patient
 *    enough to time the responses.
 */

// 32 bytes from the CSPRNG. Not Math.random, which is predictable from its output.
const TOKEN_BYTES = 32;

// Ten minutes: someone is sitting on the sign-up page waiting for this email, so a
// link that lives for hours only widens the window for a forwarded or leaked one.
export const VERIFY_TTL_MS = 10 * 60 * 1000;
// Fifteen minutes to answer "Is this you?" and choose the new password: the person
// asked from the sign-in page and is waiting on the email, like a sign-up.
export const RESET_TTL_MS = 15 * 60 * 1000;

/**
 * Mints a token. Returns the raw value (emailed, never stored) and its hash (stored,
 * never emailed).
 */
export function createToken(ttlMs) {
  const raw = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  return {
    raw,
    hash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttlMs),
  };
}

// SHA-256 rather than bcrypt: these are already 256 bits of full-entropy randomness,
// so there is nothing to brute-force and no reason to pay bcrypt's cost on every
// verification attempt.
export function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

/** Constant-time comparison of a presented token against a stored hash. */
export function tokenMatches(raw, storedHash) {
  if (!raw || !storedHash) return false;

  const candidate = Buffer.from(hashToken(raw), 'hex');
  const stored = Buffer.from(String(storedHash), 'hex');

  // timingSafeEqual throws on a length mismatch, which would itself be a signal.
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

export function isExpired(expiresAt) {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() < Date.now();
}
