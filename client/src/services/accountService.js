import api, { apiOrigin } from './api.js';

/**
 * Talking to the account endpoints.
 *
 * Errors are unwrapped into plain messages here rather than in each component: the
 * server already writes them for a person to read, and every caller wants the same
 * thing from a failure.
 */

const OFFLINE_MESSAGE = "Couldn't reach ApIForge. Check your connection and try again.";

// No response at all means the request never got an answer — offline, server down,
// blocked. That is worth saying plainly instead of showing the library's "Network Error".
function isNetworkFailure(err) {
  return Boolean(err?.isAxiosError || err?.request) && !err?.response;
}

function messageFrom(err, fallback) {
  if (isNetworkFailure(err)) return OFFLINE_MESSAGE;
  return err?.response?.data?.message || err?.message || fallback;
}

/** Which sign-in methods this deployment actually offers. */
export async function getSignInMethods() {
  try {
    const { data } = await api.get('/accounts/methods');
    return data;
  } catch {
    // If this cannot be reached the page still renders with the password form, which
    // is the method that always exists.
    return { password: true, google: false };
  }
}

/**
 * The current account, or null.
 *
 * A 401 is the ordinary "not signed in" answer, not a failure — the app calls this on
 * every load to choose between the workspace and the sign-in page.
 */
export async function getCurrentUser() {
  try {
    const { data } = await api.get('/accounts/me');
    return data.user;
  } catch (err) {
    if (err?.response?.status === 401) return null;
    throw err;
  }
}

/**
 * Creates the account. It does not sign in: the server emails a link and answers
 * `{ status: 'verification_sent', email }`, and the page waits for that link to be
 * clicked (see waitForVerification below).
 */
export async function register({ email, password, name, remember = true }) {
  try {
    const { data } = await api.post('/accounts/register', { email, password, name, remember });
    return data;
  } catch (err) {
    throw new Error(messageFrom(err, 'Could not create the account.'));
  }
}

/**
 * Signs in. Answers `{ user }`; only a confirmed account can sign in, and the server's
 * message says why not otherwise ("No account exists…", "Incorrect password…").
 */
export async function login({ email, password, remember = true }) {
  try {
    const { data } = await api.post('/accounts/login', { email, password, remember });
    return data;
  } catch (err) {
    throw new Error(messageFrom(err, 'Could not sign in.'));
  }
}

/**
 * Where this browser's wait for the email link stands: 'none', 'waiting', 'verified'
 * (with the signed-in `user`), 'signin' (verified by some other link — sign in
 * normally) or 'gone'.
 */
export async function getVerificationStatus() {
  const { data } = await api.get('/accounts/pending');
  return data;
}

/** "Use a different email": this browser stops waiting, so a reload does not resume it. */
export async function cancelVerificationWait() {
  try {
    await api.delete('/accounts/pending');
  } catch {
    // Only the reload would bring the box back; nothing else depends on this.
  }
}

/** Sends a new link for the wait in progress; the previous link stops working. */
export async function resendVerificationLink() {
  try {
    const { data } = await api.post('/accounts/pending/resend');
    return data;
  } catch (err) {
    throw new Error(messageFrom(err, 'Could not send a new link. Try again in a moment.'));
  }
}

export async function logout() {
  await api.post('/accounts/logout');
}

/**
 * The emailed "Verify my email" link. Answers `{ verified, sameBrowser, user? }`: only the
 * browser that signed up is signed in (and gets `user`); anywhere else the address is
 * verified and nothing more.
 */
export async function verifyEmail(token) {
  try {
    const { data } = await api.post('/accounts/verify-email', { token });
    return data;
  } catch (err) {
    const error = new Error(messageFrom(err, 'This link is no longer valid.'));
    // A dropped connection says nothing about the link, which is still good to use.
    error.offline = isNetworkFailure(err);
    // e.g. ALREADY_VERIFIED: the link was opened before.
    error.code = err?.response?.data?.code;
    throw error;
  }
}

/**
 * "Forgot password?" on the sign-in page. Emails "Is this you?" and answers
 * `{ status: 'confirmation_sent', email }`; the page then waits on getResetStatus.
 * Throws "No account exists with this email." when there is none.
 */
export async function requestPasswordReset(email) {
  try {
    const { data } = await api.post('/accounts/forgot-password', { email });
    return data;
  } catch (err) {
    throw new Error(messageFrom(err, 'Could not send the email. Try again in a moment.'));
  }
}

/**
 * Where this browser's reset request stands: 'none', 'waiting', 'confirmed' (Yes was
 * pressed — the new password can be set), 'denied' (No), 'expired' or 'gone'.
 */
export async function getResetStatus() {
  const { data } = await api.get('/accounts/reset/pending');
  return data;
}

/** Sends the "Is this you?" email again; the old one's buttons stop working. */
export async function resendResetEmail() {
  try {
    const { data } = await api.post('/accounts/reset/pending/resend');
    return data;
  } catch (err) {
    throw new Error(messageFrom(err, 'Could not send the email again. Try again in a moment.'));
  }
}

/** "Back to sign in": this browser stops waiting on the reset. */
export async function cancelPasswordReset() {
  try {
    await api.delete('/accounts/reset/pending');
  } catch {
    // Nothing depends on it; the request lapses on its own after fifteen minutes.
  }
}

/** The email's "Yes, it's me" or "No, it wasn't me". Answers `{ answer, sameBrowser }`. */
export async function answerResetRequest(token, answer) {
  try {
    const { data } = await api.post('/accounts/reset/answer', { token, answer });
    return data;
  } catch (err) {
    const error = new Error(messageFrom(err, 'This link is no longer valid.'));
    error.offline = isNetworkFailure(err);
    throw error;
  }
}

/** Sets the new password after "Yes, it's me" and signs this browser in. */
export async function completePasswordReset({ password, remember = true }) {
  try {
    const { data } = await api.post('/accounts/reset/complete', { password, remember });
    return data.user;
  } catch (err) {
    throw new Error(messageFrom(err, 'Could not set the password. Try again.'));
  }
}

/**
 * Google sign-in is a full-page redirect, not a fetch.
 *
 * It has to be: the browser must visit Google, and the session cookie the callback
 * sets can only be stored by a real navigation. An XHR here would be blocked by
 * Google's framing rules and would never establish the session.
 */
export function googleSignInUrl({ remember = true } = {}) {
  // Only the unticked case is spelled out; the server treats anything else as ticked.
  return `${apiOrigin}/api/accounts/google${remember ? '' : '?remember=0'}`;
}

/** Finishes the one-time welcome step. */
export async function completeWelcome() {
  try {
    const { data } = await api.post('/accounts/welcome');
    return data.user;
  } catch (err) {
    throw new Error(messageFrom(err, 'Could not save that. Try again.'));
  }
}

// ---- Account settings (signed in) ---------------------------------------------------

/** Changes the name. Answers the updated user. */
export async function updateProfile({ name }) {
  try {
    const { data } = await api.patch('/accounts/me', { name });
    return data.user;
  } catch (err) {
    throw new Error(messageFrom(err, 'Could not save your name. Try again.'));
  }
}

/**
 * Changes the password, or sets one for an account that signs in only with Google
 * (`currentPassword` left out). Other devices are signed out; this one stays.
 */
export async function changePassword({ currentPassword, newPassword }) {
  try {
    const { data } = await api.post('/accounts/password', { currentPassword, newPassword });
    return data.user;
  } catch (err) {
    throw new Error(messageFrom(err, 'Could not change the password. Try again.'));
  }
}

/** What deleting the account would take with it: `{ ownedWorkspaces, memberOfWorkspaces }`. */
export async function getDeletionSummary() {
  const { data } = await api.get('/accounts/me/deletion');
  return data;
}

/** Deletes the account. Confirmed with the password, or the email for a Google-only account. */
export async function deleteAccount({ password, email }) {
  try {
    await api.delete('/accounts/me', { data: { password, email } });
  } catch (err) {
    throw new Error(messageFrom(err, 'Could not delete the account. Try again.'));
  }
}
