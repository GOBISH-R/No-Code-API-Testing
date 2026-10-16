import crypto from 'node:crypto';
import * as accounts from '../services/accounts/accountService.js';
import * as google from '../services/accounts/googleAuth.js';
import * as settings from '../services/accounts/accountSettings.js';
import { regenerateSession, destroySession } from '../config/session.js';
import { ValidationError } from '../utils/errors.js';
import { hashToken } from '../services/accounts/tokens.js';

/**
 * Account endpoints.
 *
 * Sign-in, sign-up and password reset all say plainly whether an address has an account,
 * as Google and Microsoft do on sign-in — sign-up already reveals whether an address is
 * taken, so a vague message elsewhere would hide nothing and only confuse. The email
 * endpoints are rate-limited, which is what keeps them from being used at scale.
 */

// The session carries an id, never the user object — so a changed or disabled account
// takes effect on the next request rather than whenever the cookie happens to expire.
//
// `remember` is the "Stay signed in" box. Ticked (the default, as on Postman), the
// cookie lasts the full session lifetime. Unticked, it becomes a browser-session cookie
// with no expiry date, which the browser drops when it closes — right for a shared or
// borrowed machine. Only an explicit `false` unticks it.
async function signIn(req, user, { remember = true } = {}) {
  // regenerateSession carries the session's data across, and a finished verification
  // or reset must not come with it.
  req.session.pendingVerification = undefined;
  req.session.pendingReset = undefined;
  await regenerateSession(req);
  req.session.userId = user._id.toString();
  // When this session began — a later password change ends it (see sessionIsCurrent).
  req.session.authAt = Date.now();
  if (remember === false) req.session.cookie.maxAge = null;
}

/**
 * Remembers, in this browser's session, which sign-up it is waiting on.
 *
 * Only the pending sign-up's id, the hash of the link that was sent, and the "Stay
 * signed in" choice — never the raw link, which exists only in the email. The sign-up
 * page asks GET /pending until the link is clicked, and is let in when the hashes match.
 */
function rememberWaiting(req, pending, remember) {
  req.session.pendingVerification = {
    pendingId: pending._id.toString(),
    tokenHash: pending.$locals.verificationTokenHash,
    remember: remember !== false,
  };
}

function startWaiting(req, res, pending, remember) {
  rememberWaiting(req, pending, remember);
  return req.session.save(() =>
    res.status(202).json({ status: 'verification_sent', email: pending.email }),
  );
}

/**
 * Creating an account does not sign anyone in. Only someone who can open the email
 * gets in, so an address typed by somebody who does not own it goes nowhere.
 */
export async function register(req, res, next) {
  try {
    const { email, password, name, remember } = req.body || {};
    const pending = await accounts.registerWithPassword({ email, password, name });
    return startWaiting(req, res, pending, remember);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(err.code === 'EMAIL_TAKEN' ? 409 : 400);
    }
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password, remember } = req.body || {};
    // Only confirmed accounts get past this; an unconfirmed one reads as no account.
    const user = await accounts.loginWithPassword({ email, password });
    await signIn(req, user, { remember });
    return res.json({ user: user.toPublicJSON() });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(401);
    }
    next(err);
  }
}

export async function logout(req, res, next) {
  try {
    await destroySession(req);
    res.clearCookie('vats.sid');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/** Who am I. The client calls this on load to decide between app and sign-in. */
export async function me(req, res) {
  if (!req.user) return res.status(401).json({ user: null });
  return res.json({ user: req.user.toPublicJSON() });
}

/**
 * The emailed "Verify my email" link. Creates the account; signs in only the browser
 * that signed up (its session holds this link's hash) — that is where the person is
 * waiting, and its sign-up page moves on into the app by itself.
 *
 * Opened anywhere else — the phone the email was read on — the address is verified and
 * nothing more: that device is not signed in, and its tab just closes. The browser that
 * signed up picks the new account up from GET /pending.
 */
export async function verifyEmail(req, res, next) {
  try {
    const token = req.body?.token;
    const user = await accounts.verifyEmail(token);
    const waiting = req.session?.pendingVerification;
    const sameBrowser = Boolean(waiting?.tokenHash && token && waiting.tokenHash === hashToken(token));
    if (!sameBrowser) return res.json({ verified: true, sameBrowser: false });

    await signIn(req, user, { remember: waiting.remember });
    return res.json({ verified: true, sameBrowser: true, user: user.toPublicJSON() });
  } catch (err) {
    if (err instanceof ValidationError) res.status(400);
    next(err);
  }
}

/** The waiting page asks this until the link is clicked. */
export async function pendingStatus(req, res, next) {
  // A live status: never answered from a cache, or "waiting" could outlive the click.
  res.set('Cache-Control', 'no-store');

  // The link was opened in this same browser (another tab): opening it signed this
  // browser in and ended the wait, so the waiting tab is simply done too.
  if (req.user?.emailVerified) return res.json({ status: 'verified', user: req.user.toPublicJSON() });

  const pending = req.session?.pendingVerification;
  if (!pending) return res.json({ status: 'none' });

  try {
    const { status, user, email } = await accounts.pendingVerificationStatus(pending);
    if (status === 'verified') {
      await signIn(req, user, { remember: pending.remember });
      return res.json({ status, user: user.toPublicJSON() });
    }
    // An expired link keeps the wait open, so Resend can start it again.
    const stillPending = status === 'waiting' || status === 'expired';
    if (!stillPending) req.session.pendingVerification = undefined;
    return res.json({ status, email: stillPending ? email : undefined });
  } catch (err) {
    return next(err);
  }
}

/**
 * "Use a different email": this browser stops waiting. Without it the wait came back on
 * the next reload. The unconfirmed sign-up itself is left alone — it is removed after
 * 24 hours, or replaced if that address signs up again.
 */
export async function cancelPending(req, res) {
  if (req.session?.pendingVerification) {
    req.session.pendingVerification = undefined;
    return req.session.save(() => res.status(204).end());
  }
  return res.status(204).end();
}

/** "Resend" on the waiting page: a new link, which retires the old one. */
export async function resendPending(req, res, next) {
  const pending = req.session?.pendingVerification;
  if (!pending) {
    res.status(400);
    return next(new ValidationError('Nothing is waiting for verification in this browser.'));
  }
  try {
    const { status, email } = await accounts.pendingVerificationStatus(pending);
    if (status !== 'waiting' && status !== 'expired') return res.json({ status });
    pending.tokenHash = await accounts.sendNewVerificationLink(pending.pendingId);
    return req.session.save(() => res.json({ status: 'waiting', email }));
  } catch (err) {
    return next(err);
  }
}

const MAIL_DOWN = 'We couldn’t send the email right now. Try again in a moment.';

function mailFailed(err) {
  return /Could not send email/.test(err?.message ?? '');
}

/**
 * "Forgot password?" on the sign-in page: emails "Is this you?" and remembers, in this
 * browser's session, which request it is waiting on — only the account id and the
 * request's hash, never the emailed link.
 */
export async function requestPasswordReset(req, res, next) {
  try {
    const request = await accounts.requestPasswordReset({
      email: req.body?.email,
      userAgent: req.get('user-agent'),
    });
    req.session.pendingReset = { userId: request.userId, tokenHash: request.tokenHash };
    return req.session.save(() => res.status(202).json({ status: 'confirmation_sent', email: request.email }));
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(err.code === 'NO_ACCOUNT' ? 404 : 400);
      return next(err);
    }
    // Said plainly — "check your email" for a mail that never left is the worst outcome.
    if (mailFailed(err)) return res.status(503).json({ status: 'error', message: MAIL_DOWN });
    return next(err);
  }
}

/** The sign-in page asks this until the email is answered. */
export async function passwordResetStatus(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const pending = req.session?.pendingReset;
  if (!pending) return res.json({ status: 'none' });
  try {
    const { status, email } = await accounts.passwordResetStatus(pending);
    if (status === 'gone' || status === 'denied') req.session.pendingReset = undefined;
    return res.json({ status, email });
  } catch (err) {
    return next(err);
  }
}

/** "Resend" while waiting: a new email; the previous one's buttons stop working. */
export async function resendPasswordReset(req, res, next) {
  const pending = req.session?.pendingReset;
  if (!pending) {
    res.status(400);
    return next(new ValidationError('No password reset is waiting in this browser.'));
  }
  try {
    const { status, email } = await accounts.passwordResetStatus(pending);
    if (status === 'gone') return res.json({ status });
    pending.tokenHash = await accounts.resendPasswordReset({
      userId: pending.userId,
      userAgent: req.get('user-agent'),
    });
    if (!pending.tokenHash) {
      req.session.pendingReset = undefined;
      return req.session.save(() => res.json({ status: 'gone' }));
    }
    return req.session.save(() => res.json({ status: 'waiting', email }));
  } catch (err) {
    if (mailFailed(err)) return res.status(503).json({ status: 'error', message: MAIL_DOWN });
    return next(err);
  }
}

/** "Back to sign in": this browser stops waiting. The emailed buttons simply lapse. */
export async function cancelPasswordReset(req, res) {
  if (req.session?.pendingReset) {
    req.session.pendingReset = undefined;
    return req.session.save(() => res.status(204).end());
  }
  return res.status(204).end();
}

/**
 * The email's Yes or No. `sameBrowser` says whether this is the browser waiting on the
 * sign-in page, so after Yes that tab can go straight to the new-password fields.
 */
export async function answerPasswordReset(req, res, next) {
  try {
    const { answer, tokenHash } = await accounts.answerPasswordReset({
      token: req.body?.token,
      answer: req.body?.answer,
    });
    const pending = req.session?.pendingReset;
    const sameBrowser = Boolean(pending && pending.tokenHash === tokenHash);
    return res.json({ answer, sameBrowser });
  } catch (err) {
    if (err instanceof ValidationError) res.status(400);
    return next(err);
  }
}

/** The new password, set on the sign-in page after "Yes, it's me". Signs this browser in. */
export async function completePasswordReset(req, res, next) {
  const pending = req.session?.pendingReset;
  if (!pending) {
    res.status(400);
    return next(new ValidationError('This reset request is no longer valid. Press “Forgot password?” again.'));
  }
  try {
    const user = await accounts.completePasswordReset({ ...pending, password: req.body?.password });
    await signIn(req, user, { remember: req.body?.remember });
    return res.json({ user: user.toPublicJSON() });
  } catch (err) {
    if (err instanceof ValidationError) res.status(400);
    return next(err);
  }
}

// ---- Account settings (signed in) ------------------------------------------------

function settingsFailed(err, res, next) {
  if (err instanceof ValidationError) res.status(400);
  return next(err);
}

/**
 * This browser carries on after a change that ends other sessions: its session is
 * stamped afresh, so only the others fall behind the cut-off.
 */
function keepThisSession(req) {
  req.session.authAt = Date.now();
  return new Promise((resolve) => req.session.save(() => resolve()));
}

/** PATCH /accounts/me — the name. */
export async function updateProfile(req, res, next) {
  try {
    const user = await settings.updateName(req.user, req.body?.name);
    return res.json({ user: user.toPublicJSON() });
  } catch (err) {
    return settingsFailed(err, res, next);
  }
}

/** POST /accounts/password — change it (or set one, for a Google-only account). */
export async function changePassword(req, res, next) {
  try {
    const user = await settings.changePassword(req.user, {
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword,
    });
    await keepThisSession(req);
    return res.json({ user: user.toPublicJSON() });
  } catch (err) {
    return settingsFailed(err, res, next);
  }
}

/** GET /accounts/me/deletion — what deleting the account would take with it. */
export async function deletionSummary(req, res, next) {
  try {
    return res.json(await settings.deletionSummary(req.user));
  } catch (err) {
    return next(err);
  }
}

/** DELETE /accounts/me — deletes the account, then signs this browser out. */
export async function deleteAccount(req, res, next) {
  try {
    await settings.deleteAccount(req.user, { password: req.body?.password, email: req.body?.email });
    await destroySession(req);
    res.clearCookie('vats.sid');
    return res.status(204).end();
  } catch (err) {
    return settingsFailed(err, res, next);
  }
}

/** Finishes the one-time welcome step for the signed-in account. The name is not editable here. */
export async function completeWelcome(req, res, next) {
  if (!req.user) return res.status(401).json({ status: 'error', message: 'Sign in first.' });
  try {
    const user = await accounts.completeWelcome(req.user);
    return res.json({ user: user.toPublicJSON() });
  } catch (err) {
    if (err instanceof ValidationError) res.status(400);
    return next(err);
  }
}

/** Which sign-in methods this deployment offers, so the UI shows only what works. */
export function methods(req, res) {
  res.json({ password: true, google: google.isGoogleConfigured() });
}

/**
 * Constant-time comparison of two short secrets.
 *
 * timingSafeEqual throws when the buffers differ in length, and the length difference
 * would itself be a signal — so unequal lengths return false rather than propagating.
 */
function sameSecret(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Where the client lands after Google sends the browser back. */
function clientUrl(path) {
  const base = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
  return `${base}${path}`;
}

/**
 * Step one: send the browser to Google.
 *
 * The state and PKCE verifier are kept in the session rather than in the URL, so
 * neither can be supplied by whoever triggers the callback.
 */
export function googleStart(req, res, next) {
  try {
    const { url, state, codeVerifier } = google.buildAuthorizationUrl();
    req.session.googleState = state;
    req.session.googleVerifier = codeVerifier;
    // The "Stay signed in" box travels as ?remember=0, the one thing a full-page
    // redirect can carry; it is only a preference, so the URL is a fine place for it.
    req.session.googleRemember = req.query?.remember !== '0';
    req.session.save(() => res.redirect(url));
  } catch (err) {
    if (err instanceof ValidationError) res.status(400);
    next(err);
  }
}

/**
 * Step two: Google sends the browser back here.
 *
 * Always redirects rather than returning JSON — a person is looking at this, not a
 * script. Failures carry a short reason code, never the underlying error, which can
 * name the client id.
 */
export async function googleCallback(req, res) {
  const { code, state, error } = req.query || {};

  const expectedState = req.session?.googleState;
  const codeVerifier = req.session?.googleVerifier;
  const remember = req.session?.googleRemember !== false;
  // Single use, whatever happens next.
  if (req.session) {
    req.session.googleState = undefined;
    req.session.googleVerifier = undefined;
    req.session.googleRemember = undefined;
  }

  if (error) return res.redirect(clientUrl('/login?error=google_denied'));
  if (!code || !state) return res.redirect(clientUrl('/login?error=google_incomplete'));

  // The CSRF check: a state that does not match this browser's session means the
  // callback was not started here. Compared in constant time, like every other secret
  // in this file — it costs nothing and removes the question.
  if (!expectedState || !sameSecret(String(state), expectedState)) {
    return res.redirect(clientUrl('/login?error=google_state'));
  }

  try {
    const profile = await google.exchangeCodeForProfile({ code, codeVerifier });
    const { user } = await google.findOrCreateFromGoogle(profile);
    if (user) {
      await signIn(req, user, { remember });
      return res.redirect(clientUrl('/app'));
    }
    // A new address: confirmed by email like any sign-up. The sign-up page picks the
    // wait up from this browser's session (?verify=sent says there is one to pick up).
    const pending = await accounts.registerWithGoogle(profile);
    rememberWaiting(req, pending, remember);
    return req.session.save(() => res.redirect(clientUrl('/signup?verify=sent')));
  } catch (err) {
    const reason = err?.code === 'EMAIL_UNVERIFIED_AT_GOOGLE' ? 'google_unverified' : 'google_failed';
    return res.redirect(clientUrl(`/login?error=${reason}`));
  }
}
