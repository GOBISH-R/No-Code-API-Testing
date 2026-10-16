import crypto from 'node:crypto';

// Holds the OAuth 2.0 Authorization Code handshake's server-side secrets (client
// secret, token URL) between "open the consent popup" and "the provider redirects
// back with a code" — an in-memory Map is enough since this is a single-process,
// short-lived (minutes), one-time-use handshake, not durable state.
const TTL_MS = 10 * 60 * 1000;
const pending = new Map();

export function createPendingAuthorization(data) {
  const state = crypto.randomBytes(24).toString('hex');
  pending.set(state, data);
  setTimeout(() => pending.delete(state), TTL_MS).unref?.();
  return state;
}

// One-time use: the state is consumed (and removed) the instant the callback arrives,
// so a leaked/replayed callback URL can't be exchanged twice.
export function consumePendingAuthorization(state) {
  if (!state) return null;
  const entry = pending.get(state);
  if (!entry) return null;
  pending.delete(state);
  return entry;
}
