import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { User } from '../../models/User.js';
import { PendingSignup } from '../../models/PendingSignup.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { createToken, hashToken, tokenMatches, isExpired, VERIFY_TTL_MS, RESET_TTL_MS } from './tokens.js';
import { sendVerificationEmail, sendResetConfirmationEmail } from './mailer.js';
import { describeDevice, formatRequestTime } from './deviceLabel.js';
import { ValidationError } from '../../utils/errors.js';

/**
 * Account lifecycle: sign up, verify the address, sign in, reset a password.
 *
 * An account exists only once its address is verified. Signing up — with a password or
 * with Google — stores a PendingSignup and emails a link; clicking the link creates the
 * User. Until then there is no account: signing in says so, and signing up again simply
 * sends a fresh link. The users collection never holds an unverified address.
 *
 * Password checks always run, account or not, so a failed sign-in takes as long either way.
 */

const MAX_NAME_LENGTH = 80;

const NO_ACCOUNT = 'No account exists with this email.';
const WRONG_PASSWORD = 'Incorrect password. Try again.';
const GOOGLE_ONLY = 'This account signs in with Google. Use “Sign In with Google”.';
const EMAIL_TAKEN = 'An account with this email already exists.';
// An emailed link pressed a second time, or one that never existed: the same short line.
const LINK_NO_LONGER_VALID = 'This link is no longer valid.';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * A display name worked out from the email address, for a caller that sends none.
 *
 *   ada.lovelace@example.com  -> "Ada Lovelace"
 *   grace_hopper+work@x.io    -> "Grace Hopper"
 *   jsmith42@example.com      -> "Jsmith"
 *
 * The +tag is dropped, separators become spaces, stray digits go, and each word is
 * capitalised. If nothing usable is left, the local part is used as it is.
 */
export function nameFromEmail(email) {
  const local = String(email || '').split('@')[0].split('+')[0];
  const words = local
    .split(/[._\-\s]+/)
    .map((w) => w.replace(/\d+/g, ''))
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return words.join(' ') || local;
}

function coded(message, code) {
  const error = new ValidationError(message);
  error.code = code;
  return error;
}

function sameHash(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Records (or replaces) the sign-up for an address and emails its link.
 *
 * One pending sign-up per address: a second attempt — after closing the tab, or "Use a
 * different email" and back — takes over with a new link and the old one stops working.
 * The returned document carries the link's hash in $locals for the controller to put in
 * this browser's session; the raw link exists only in the email.
 */
async function startPendingSignup({ email, name, passwordHash = null, googleId = null, avatarUrl = '' }) {
  const verification = createToken(VERIFY_TTL_MS);
  const pending = await PendingSignup.findOneAndUpdate(
    { email },
    {
      $set: {
        name,
        passwordHash,
        googleId,
        avatarUrl,
        tokenHash: verification.hash,
        tokenExpiresAt: verification.expiresAt,
        createdAt: new Date(),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  // Waited for, not sent in the background: if the mail server refuses, the person must
  // be told now rather than left watching "Verifying…" for an email that never left.
  // The sign-up stays stored, so trying again simply sends a fresh link.
  await sendVerificationEmail({ to: email, name: pending.name, token: verification.raw });

  pending.$locals.verificationTokenHash = verification.hash;
  return pending;
}

/** Sign-up with email and password: emails a link; the account is made when it is clicked. */
export async function registerWithPassword({ email, password, name }) {
  const normalized = normalizeEmail(email);
  if (!normalized.includes('@')) throw new ValidationError('Enter a valid email address.');
  const typedName = String(name ?? '').trim();
  if (typedName.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`Keep the name under ${MAX_NAME_LENGTH} characters.`);
  }
  // It goes into email subjects ("Ada invited you to …"): no line breaks or other
  // control characters.
  if (/\p{Cc}/u.test(typedName)) throw new ValidationError('Use letters, numbers and spaces in your name.');

  // Checked before anything is written, so a taken address never gets a link.
  const passwordHash = await hashPassword(password);
  if (await User.exists({ email: normalized })) throw coded(EMAIL_TAKEN, 'EMAIL_TAKEN');

  return startPendingSignup({
    email: normalized,
    name: typedName || nameFromEmail(normalized),
    passwordHash,
  });
}

/**
 * Sign-up with Google for an address that has no account yet. Google has vouched for the
 * address, but it is confirmed by email all the same, exactly like a password sign-up,
 * so every new account starts the same way.
 */
export async function registerWithGoogle(profile) {
  return startPendingSignup({
    email: normalizeEmail(profile.email),
    name: profile.name || nameFromEmail(profile.email),
    googleId: profile.googleId,
    avatarUrl: profile.avatarUrl || '',
  });
}

/**
 * Resend on the waiting page: a new link for the same sign-up, which retires the old one.
 * Returns the new link's hash for this browser's session, or null if the sign-up is gone.
 */
export async function sendNewVerificationLink(pendingId) {
  if (!mongoose.isValidObjectId(pendingId)) return null;
  // tokenHash is not loaded by default; it is needed to put the current link back if
  // the new email cannot be sent.
  const pending = await PendingSignup.findById(pendingId).select('+tokenHash');
  if (!pending) return null;

  const previous = { tokenHash: pending.tokenHash, tokenExpiresAt: pending.tokenExpiresAt };
  const verification = createToken(VERIFY_TTL_MS);
  pending.tokenHash = verification.hash;
  pending.tokenExpiresAt = verification.expiresAt;
  await pending.save();
  try {
    await sendVerificationEmail({ to: pending.email, name: pending.name, token: verification.raw });
  } catch (err) {
    // Nothing was sent, so nothing may change: the link already in the inbox keeps
    // working, and this browser keeps waiting on it.
    await PendingSignup.updateOne({ _id: pending._id }, { $set: previous });
    throw err;
  }
  return verification.hash;
}

/**
 * Where this browser's wait for its link stands.
 *
 *  - 'waiting'  — not clicked yet.
 *  - 'expired'  — not clicked, and the link has run out; Resend sends a new one.
 *  - 'verified' — this browser's link was clicked and the account exists: let it in.
 *  - 'gone'     — nothing to wait for any more: signed up again since (a newer link), or
 *                 the sign-up was forgotten after 24 hours.
 */
export async function pendingVerificationStatus({ pendingId, tokenHash }) {
  const pending = mongoose.isValidObjectId(pendingId)
    ? await PendingSignup.findById(pendingId).select('+tokenHash')
    : null;
  if (pending) {
    if (!sameHash(pending.tokenHash, tokenHash)) return { status: 'gone' };
    return { status: isExpired(pending.tokenExpiresAt) ? 'expired' : 'waiting', email: pending.email };
  }
  const user = tokenHash ? await User.findOne({ verifiedWithTokenHash: tokenHash }) : null;
  return user ? { status: 'verified', user } : { status: 'gone' };
}

/** Signs in with a password. Only a verified account exists to sign in to. */
export async function loginWithPassword({ email, password }) {
  const normalized = normalizeEmail(email);
  const user = await User.findOne({ email: normalized }).select('+passwordHash');

  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !user.emailVerified) throw new ValidationError(NO_ACCOUNT);
  if (!user.passwordHash) throw new ValidationError(GOOGLE_ONLY);
  if (!ok) throw new ValidationError(WRONG_PASSWORD);

  user.lastLoginAt = new Date();
  await user.save();
  return user;
}

/**
 * The emailed link: creates the account from the pending sign-up.
 *
 * Single use — the pending sign-up is consumed. Opening the link again finds the account
 * it made (by the link's hash) and says the link is no longer valid (ALREADY_VERIFIED).
 */
export async function verifyEmail(rawToken) {
  if (!rawToken) throw new ValidationError(LINK_NO_LONGER_VALID);
  const hash = hashToken(rawToken);

  const pending = await PendingSignup.findOne({ tokenHash: hash }).select('+tokenHash +passwordHash');
  if (!pending || !tokenMatches(rawToken, pending.tokenHash)) {
    if (await User.exists({ verifiedWithTokenHash: hash })) {
      throw coded(LINK_NO_LONGER_VALID, 'ALREADY_VERIFIED');
    }
    throw new ValidationError(LINK_NO_LONGER_VALID);
  }
  if (isExpired(pending.tokenExpiresAt)) {
    throw coded('That link has expired. Sign up again to get a new one.', 'VERIFY_EXPIRED');
  }

  const existing = await User.findOne({ email: pending.email });
  if (existing) {
    // An account was made for this address while the link waited — signed in with
    // Google from elsewhere, say. A Google sign-up joins it; a password one does not
    // get to replace somebody's password.
    await PendingSignup.deleteOne({ _id: pending._id });
    if (!pending.googleId) throw coded(EMAIL_TAKEN, 'EMAIL_TAKEN');
    if (!existing.googleId) existing.googleId = pending.googleId;
    existing.verifiedWithTokenHash = hash;
    await existing.save();
    return existing;
  }

  let user;
  try {
    user = await User.create({
      email: pending.email,
      name: pending.name,
      passwordHash: pending.passwordHash,
      passwordSetAt: pending.passwordHash ? new Date() : null,
      googleId: pending.googleId,
      avatarUrl: pending.avatarUrl,
      emailVerified: true,
      verifiedWithTokenHash: hash,
      lastLoginAt: new Date(),
      // The welcome step is for email sign-ups; Google already gave the real name.
      needsWelcome: !pending.googleId,
    });
  } catch (err) {
    // The same link opened twice at once: the second finds the account the first made.
    if (err?.code === 11000) throw coded(LINK_NO_LONGER_VALID, 'ALREADY_VERIFIED');
    throw err;
  }
  await PendingSignup.deleteOne({ _id: pending._id });
  return user;
}

/**
 * Password reset, Google-style: "Forgot password?" on the sign-in page emails "Is this
 * you?" with Yes and No. Yes lets *that* sign-in page — the browser that asked, which
 * holds the request's hash in its session — set the new password; No cancels it.
 *
 * Only the newest email works: a new one (Forgot pressed again, or Resend) retires the
 * buttons in every earlier one.
 *
 * The emailed link alone never sets a password: someone who forwards or leaks the
 * email gives away at most a yes/no, and only to a request somebody is waiting on.
 */
const RESET_FIELDS = '+resetTokenHash +resetTokenExpiresAt +resetAnswer +resetRequestedFrom +resetRequestedAt';
const RESET_LINK_INVALID = LINK_NO_LONGER_VALID;

async function sendResetConfirmation(user, userAgent) {
  const previous = {
    resetTokenHash: user.resetTokenHash,
    resetTokenExpiresAt: user.resetTokenExpiresAt,
    resetAnswer: user.resetAnswer,
    resetRequestedFrom: user.resetRequestedFrom,
    resetRequestedAt: user.resetRequestedAt,
  };
  const reset = createToken(RESET_TTL_MS);
  user.resetTokenHash = reset.hash;
  user.resetTokenExpiresAt = reset.expiresAt;
  user.resetAnswer = null;
  user.resetRequestedFrom = describeDevice(userAgent);
  user.resetRequestedAt = new Date();
  await user.save();

  try {
    await sendResetConfirmationEmail({
      to: user.email,
      name: user.name,
      token: reset.raw,
      device: user.resetRequestedFrom,
      requestedAt: formatRequestTime(user.resetRequestedAt),
    });
  } catch (err) {
    // Nothing was sent, so nothing may change: a request already waiting keeps its link.
    Object.assign(user, previous);
    await user.save();
    throw err;
  }
  return reset.hash;
}

/**
 * Forgot password pressed for `email`. Says plainly when there is no account, exactly as
 * sign-in does. Returns what the browser's session keeps: the account id and the hash of
 * the request just emailed (the raw link exists only in the email).
 */
export async function requestPasswordReset({ email, userAgent }) {
  const user = await User.findOne({ email: normalizeEmail(email) }).select(RESET_FIELDS);
  if (!user || !user.emailVerified) throw coded(NO_ACCOUNT, 'NO_ACCOUNT');
  const tokenHash = await sendResetConfirmation(user, userAgent);
  return { userId: user._id.toString(), tokenHash, email: user.email };
}

/** "Resend" while waiting: a new email, which retires the old one's buttons. */
export async function resendPasswordReset({ userId, userAgent }) {
  if (!mongoose.isValidObjectId(userId)) return null;
  const user = await User.findById(userId).select(RESET_FIELDS);
  if (!user) return null;
  return sendResetConfirmation(user, userAgent);
}

async function userForResetRequest({ userId, tokenHash }) {
  if (!mongoose.isValidObjectId(userId)) return null;
  const user = await User.findById(userId).select(RESET_FIELDS);
  return user && sameHash(user.resetTokenHash, tokenHash) ? user : null;
}

/**
 * Where this browser's reset request stands:
 *  - 'waiting'   — no answer yet
 *  - 'confirmed' — "Yes, it's me": this page may now set the new password
 *  - 'denied'    — "No, it wasn't me": cancelled, the password is unchanged
 *  - 'expired'   — fifteen minutes passed; Resend starts again
 *  - 'gone'      — replaced by a newer request, or already used
 */
export async function passwordResetStatus(request) {
  const user = await userForResetRequest(request);
  if (!user) return { status: 'gone' };
  if (user.resetAnswer === 'no') return { status: 'denied', email: user.email };
  if (isExpired(user.resetTokenExpiresAt)) return { status: 'expired', email: user.email };
  return { status: user.resetAnswer === 'yes' ? 'confirmed' : 'waiting', email: user.email };
}

async function userForResetLink(rawToken) {
  if (!rawToken) return null;
  const user = await User.findOne({ resetTokenHash: hashToken(rawToken) }).select(RESET_FIELDS);
  return user && tokenMatches(rawToken, user.resetTokenHash) ? user : null;
}

/**
 * The email's Yes or No. One press, then the email is spent: its other button — or the
 * same one again — says the link is no longer valid. The answer stands; the sign-in page
 * that asked carries on from it (or, after No, can simply ask again).
 */
export async function answerPasswordReset({ token, answer }) {
  if (answer !== 'yes' && answer !== 'no') throw new ValidationError('Answer yes or no.');
  const user = await userForResetLink(token);
  if (!user || user.resetAnswer) throw coded(RESET_LINK_INVALID, 'RESET_LINK_INVALID');
  if (isExpired(user.resetTokenExpiresAt)) {
    throw coded('This request has expired. Press “Forgot password?” again to start over.', 'RESET_EXPIRED');
  }
  user.resetAnswer = answer;
  await user.save();
  return { answer, tokenHash: user.resetTokenHash };
}

/**
 * Sets the new password, from the browser that asked and only after "Yes, it's me".
 * Single use: the request is cleared, and the new passwordSetAt ends every other session.
 */
export async function completePasswordReset({ userId, tokenHash, password }) {
  const user = await userForResetRequest({ userId, tokenHash });
  if (!user) throw coded('This reset request is no longer valid. Press “Forgot password?” again.', 'RESET_GONE');
  if (user.resetAnswer === 'no') throw coded('This reset request was cancelled.', 'RESET_CANCELLED');
  if (isExpired(user.resetTokenExpiresAt)) {
    throw coded('This request has expired. Press “Forgot password?” again to start over.', 'RESET_EXPIRED');
  }
  if (user.resetAnswer !== 'yes') {
    throw coded('Confirm it’s you from the email first.', 'RESET_NOT_CONFIRMED');
  }

  user.passwordHash = await hashPassword(password);
  user.passwordSetAt = new Date();
  user.resetTokenHash = null;
  user.resetTokenExpiresAt = null;
  user.resetAnswer = null;
  user.lastLoginAt = new Date();
  await user.save();
  return user;
}

export async function findById(id) {
  return User.findById(id);
}

/**
 * Finishes the welcome step shown once after an email sign-up.
 *
 * The name was typed on the sign-up form and is shown here read-only, so this only
 * marks the step done — it never changes the name.
 */
export async function completeWelcome(user) {
  user.needsWelcome = false;
  await user.save();
  return user;
}
