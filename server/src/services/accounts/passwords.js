import bcrypt from 'bcryptjs';
import { ValidationError } from '../../utils/errors.js';

/**
 * Password hashing and the rules a password must meet.
 *
 * Kept tiny and in one place: every path that sets a password (signup, reset, adding a
 * password to a Google-only account) must apply the same rules, and the way that goes
 * wrong is a second, laxer copy somewhere else.
 */

// bcrypt's cost is deliberately slow. 12 is the common floor in 2026 — roughly a
// quarter-second per hash, which is nothing on a login and expensive in bulk.
const COST = 12;

// bcrypt silently truncates beyond 72 *bytes*, so a longer passphrase would have its
// tail ignored — a real surprise for someone using a password manager.
const MAX_BYTES = 72;

export const MIN_LENGTH = 10;

/**
 * Checks a candidate password, throwing with a reason a person can act on.
 *
 * Length is the only hard rule. Composition rules ("one capital, one symbol") push
 * people toward `Password1!` and measurably weaken the result, so the floor is length
 * plus a refusal of the handful of passwords that are genuinely universal.
 */
const OBVIOUS = new Set([
  'password', 'password1', 'password123', '1234567890', '12345678910',
  'qwertyuiop', 'letmein123', 'iloveyou12', 'adminadmin', 'welcome123',
]);

export function assertPasswordAcceptable(password) {
  if (typeof password !== 'string' || !password) {
    throw new ValidationError('A password is required.');
  }
  if (password.length < MIN_LENGTH) {
    throw new ValidationError(`Use at least ${MIN_LENGTH} characters.`);
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_BYTES) {
    throw new ValidationError(
      `That password is too long — bcrypt ignores anything past ${MAX_BYTES} bytes, so it would not all count.`,
    );
  }
  if (OBVIOUS.has(password.toLowerCase())) {
    throw new ValidationError('That password is one of the most commonly used ones. Pick another.');
  }
  return true;
}

export async function hashPassword(password) {
  assertPasswordAcceptable(password);
  return bcrypt.hash(password, COST);
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing when the account has no password at all (a
 * Google-only account), and still runs a comparison against a dummy hash in that case
 * so the response time does not reveal which accounts exist.
 */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-placeholder', COST);

export async function verifyPassword(password, hash) {
  if (typeof password !== 'string' || !password) return false;
  if (!hash) {
    // Burn the same time as a real check: without this, "no such user" and "wrong
    // password" are distinguishable by a stopwatch.
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(password, hash);
}
