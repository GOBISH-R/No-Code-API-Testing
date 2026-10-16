import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Hours an unverified sign-up is kept before it is forgotten. */
const PENDING_SIGNUP_TTL_HOURS = 24;

/**
 * A sign-up waiting for its email link to be clicked.
 *
 * Kept apart from User on purpose: an account exists only once its address is verified,
 * so the users collection holds verified accounts and nothing else. Until then the sign-up
 * is just this — what was typed, and the link that was sent. Clicking the link turns it
 * into a User and deletes it; otherwise MongoDB removes it after 24 hours.
 *
 * One per address. Signing up again with the same address (typed again after closing
 * the tab, or "Use a different email" and back) replaces it with a fresh link, so the
 * newest email is always the one that works.
 */
const pendingSignupSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, default: '' },
  // Set for a password sign-up; never returned unless asked for.
  passwordHash: { type: String, default: null, select: false },
  // Set for a Google sign-up instead.
  googleId: { type: String, default: null },
  avatarUrl: { type: String, default: '' },
  // Only the hash of the emailed link is stored; the link itself exists only in the email.
  tokenHash: { type: String, required: true, index: true, select: false },
  tokenExpiresAt: { type: Date, required: true },
  // Reset on every sign-up attempt, so the 24 hours count from the latest one.
  createdAt: { type: Date, default: Date.now, expires: PENDING_SIGNUP_TTL_HOURS * 60 * 60 },
});

export const PendingSignup = mongoose.model('PendingSignup', pendingSignupSchema);
