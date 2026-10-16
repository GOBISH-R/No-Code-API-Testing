import nodemailer from 'nodemailer';

/**
 * Sending through the Gmail API (HTTPS) instead of SMTP.
 *
 * Some hosts block outbound SMTP — Render's free plan blocks ports 25, 465 and 587 — so
 * a Gmail account that works over SMTP on a laptop silently stops working once deployed.
 * The Gmail API is ordinary HTTPS on port 443, which every host allows, and the mail
 * still comes from the same Gmail address, so inbox delivery is unchanged.
 *
 * Authorised once with a refresh token for the sending account (scope gmail.send, see
 * scripts/gmail-authorize.js); the short-lived access token is fetched and reused here.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TIMEOUT_MS = 15_000;

export function isGmailApiConfigured(env = process.env) {
  return Boolean(
    env.GMAIL_REFRESH_TOKEN?.trim() &&
      env.GOOGLE_CLIENT_ID?.trim() &&
      env.GOOGLE_CLIENT_SECRET?.trim() &&
      env.MAIL_FROM?.trim(),
  );
}

// Google's error bodies say what went wrong ("invalid_grant", "insufficientPermissions")
// without echoing any secret; anything else is reduced to the status.
async function describeFailure(res) {
  try {
    const body = await res.json();
    const detail = body.error_description || body.error?.message || body.error;
    return `${res.status}${detail ? ` ${detail}` : ''}`;
  } catch {
    return String(res.status);
  }
}

/**
 * @param {object} env  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, MAIL_FROM
 * @param {object} [deps]  `fetch` — a test seam; the real one otherwise.
 */
export function buildGmailTransport(env = process.env, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const from = env.MAIL_FROM.trim();
  // Builds the raw message (headers, HTML and text parts, encodings) without sending it.
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  let cached = null; // { token, expiresAt }

  async function accessToken() {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID.trim(),
        client_secret: env.GOOGLE_CLIENT_SECRET.trim(),
        refresh_token: env.GMAIL_REFRESH_TOKEN.trim(),
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Gmail authorisation failed: ${await describeFailure(res)}`);
    const body = await res.json();
    cached = { token: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
    return cached.token;
  }

  async function call(path, init = {}) {
    const res = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Gmail API ${await describeFailure(res)}`);
    return res.json();
  }

  return {
    from,

    /** Sends one message; resolves with Gmail's message id. */
    async sendMail({ to, subject, text, html }) {
      const { message } = await composer.sendMail({ from, to, subject, text, html });
      const raw = Buffer.from(message).toString('base64url');
      const sent = await call('/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
      return { messageId: sent.id };
    },

    /**
     * Checks the authorisation works, without sending anything: a token refresh (proves
     * the client and refresh token belong together) and the account's address.
     */
    async verify() {
      await accessToken();
      return true;
    },
  };
}
