import crypto from 'node:crypto';
import axios from 'axios';
import { User } from '../../models/User.js';
import { ValidationError } from '../../utils/errors.js';
import { nameFromEmail } from './accountService.js';


/**
 * Signing in with Google.
 *
 * Note what this is *not*: the OAuth 2.0 support in services/execution/oauth2Client.js
 * exists so a saved request can authenticate against somebody else's API. This decides
 * who is using this app. Same protocol, opposite trust direction — they share no code,
 * no routes and no vocabulary, deliberately.
 *
 * Endpoints are fixed constants rather than configuration. Nothing user-supplied ever
 * becomes a URL here, which is what keeps the SSRF guard irrelevant to this file
 * instead of merely bypassed.
 */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

const TIMEOUT_MS = 10_000;

export function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** The callback Google redirects to. Must match the Cloud console exactly. */
export function redirectUri() {
  const base = (process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');
  return `${base}/api/accounts/google/callback`;
}

/**
 * Begins the flow.
 *
 * `state` is the CSRF defence: it is remembered in the session and must come back
 * unchanged, so a callback someone else triggers cannot complete a sign-in in this
 * browser. PKCE covers the other half — an intercepted code is useless without the
 * verifier, which never leaves this server.
 */
export function buildAuthorizationUrl() {
  if (!isGoogleConfigured()) {
    throw new ValidationError('Google sign-in is not configured on this server.');
  }

  const state = crypto.randomBytes(24).toString('base64url');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // Ask Google to pick an account rather than silently reusing the last one.
  url.searchParams.set('prompt', 'select_account');

  return { url: url.toString(), state, codeVerifier };
}

/**
 * Exchanges the code and reads the profile.
 *
 * The response is trusted because it arrives over TLS directly from Google's token
 * endpoint — that channel is what authenticates it. The id_token's signature is not
 * re-verified here for the same reason: nothing untrusted sits between us.
 */
export async function exchangeCodeForProfile({ code, codeVerifier }) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });

  let tokenResponse;
  try {
    tokenResponse = await axios.post(GOOGLE_TOKEN_URL, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: TIMEOUT_MS,
    });
  } catch {
    // Google's own error text can name the client id; keep it out of the response.
    throw new ValidationError('Google refused the sign-in. Try again.');
  }

  const accessToken = tokenResponse.data?.access_token;
  if (!accessToken) throw new ValidationError('Google did not return an access token.');

  let profile;
  try {
    const res = await axios.get(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: TIMEOUT_MS,
    });
    profile = res.data;
  } catch {
    throw new ValidationError('Could not read your Google profile. Try again.');
  }

  return {
    googleId: profile?.sub,
    email: String(profile?.email || '').trim().toLowerCase(),
    emailVerified: profile?.email_verified === true,
    name: profile?.name || '',
    avatarUrl: profile?.picture || '',
  };
}

/**
 * Finds the account a Google profile belongs to, linking it when that is safe.
 *
 *  1. Google must say the address is verified — an unverified Google address proves
 *     nothing, and accepting it would let someone attach an address they do not own.
 *  2. A matching googleId is the same person returning: signed straight in.
 *  3. A matching address links Google to that (verified) account and signs in.
 *  4. Anything else is a new sign-up: no account is made here. It is confirmed by email
 *     like every other sign-up (registerWithGoogle), and returned as `{ user: null }`.
 */
export async function findOrCreateFromGoogle(profile) {
  if (!profile.googleId) throw new ValidationError('Google did not identify the account.');
  if (!profile.email) throw new ValidationError('Google did not share an email address.');
  if (!profile.emailVerified) {
    const error = new ValidationError(
      'Your Google account has an unverified email address. Verify it with Google first.',
    );
    // Tagged so the callback can redirect with a reason a person can act on, rather
    // than the generic failure.
    error.code = 'EMAIL_UNVERIFIED_AT_GOOGLE';
    throw error;
  }

  const byGoogleId = await User.findOne({ googleId: profile.googleId });
  if (byGoogleId) {
    byGoogleId.lastLoginAt = new Date();
    await byGoogleId.save();
    return { user: byGoogleId, linked: false };
  }

  const byEmail = await User.findOne({ email: profile.email, emailVerified: true });
  if (byEmail) {
    byEmail.googleId = profile.googleId;
    // A name worked out from the email address is only a guess; Google's is real.
    const nameIsGuess = !byEmail.name || byEmail.name === nameFromEmail(byEmail.email);
    if (nameIsGuess && profile.name) byEmail.name = profile.name;
    if (!byEmail.avatarUrl) byEmail.avatarUrl = profile.avatarUrl;
    byEmail.lastLoginAt = new Date();
    await byEmail.save();
    return { user: byEmail, linked: true };
  }

  return { user: null, linked: false };
}
