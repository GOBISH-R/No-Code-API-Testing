import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildGmailTransport, isGmailApiConfigured } from '../../src/services/accounts/gmailTransport.js';
import { installMailTransport } from '../../src/services/accounts/smtpTransport.js';
import { setMailTransport, sendVerificationEmail } from '../../src/services/accounts/mailer.js';

const ENV = {
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GMAIL_REFRESH_TOKEN: 'refresh-token',
  MAIL_FROM: 'ApIForge <apiforge@example.test>',
};

/** A stand-in for Google: answers the token endpoint and the send endpoint. */
function fakeGoogle({ tokenStatus = 200, sendStatus = 200 } = {}) {
  const calls = [];
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return tokenStatus === 200
        ? json(200, { access_token: 'access-1', expires_in: 3600 })
        : json(tokenStatus, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    }
    return sendStatus === 200 ? json(200, { id: 'msg-1' }) : json(sendStatus, { error: { message: 'Insufficient Permission' } });
  });
  return { fetch, calls };
}

afterEach(() => {
  setMailTransport(null);
  vi.unstubAllGlobals();
});

describe('isGmailApiConfigured', () => {
  it('needs the Google client, the refresh token and a sender', () => {
    expect(isGmailApiConfigured(ENV)).toBe(true);
    for (const key of Object.keys(ENV)) expect(isGmailApiConfigured({ ...ENV, [key]: '' }), key).toBe(false);
  });
});

describe('sending through the Gmail API', () => {
  it('posts the message to Gmail with a fresh access token, as a complete email', async () => {
    const google = fakeGoogle();
    const transport = buildGmailTransport(ENV, { fetch: google.fetch });
    const result = await transport.sendMail({ to: 'ada@example.com', subject: 'Confirm your email', text: 'Hi Ada', html: '<p>Hi Ada</p>' });

    expect(result).toEqual({ messageId: 'msg-1' });
    const [token, send] = google.calls;
    expect(token.url).toContain('oauth2.googleapis.com/token');
    expect(String(token.init.body)).toContain('grant_type=refresh_token');
    expect(send.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(send.init.headers.Authorization).toBe('Bearer access-1');

    const raw = Buffer.from(JSON.parse(send.init.body).raw, 'base64url').toString('utf8');
    expect(raw).toMatch(/^From: ApIForge <apiforge@example\.test>$/m);
    expect(raw).toMatch(/^To: ada@example\.com$/m);
    expect(raw).toMatch(/^Subject: Confirm your email$/m);
    expect(raw).toContain('text/html');
  });

  it('reuses the access token until it is about to expire', async () => {
    const google = fakeGoogle();
    const transport = buildGmailTransport(ENV, { fetch: google.fetch });
    await transport.sendMail({ to: 'a@example.com', subject: 's', text: 't', html: '<p>t</p>' });
    await transport.sendMail({ to: 'b@example.com', subject: 's', text: 't', html: '<p>t</p>' });
    expect(google.calls.filter((c) => c.url.includes('/token'))).toHaveLength(1);
  });

  it('reports a revoked authorisation or a refused send plainly', async () => {
    const revoked = buildGmailTransport(ENV, { fetch: fakeGoogle({ tokenStatus: 400 }).fetch });
    await expect(revoked.sendMail({ to: 'a@example.com', subject: 's', text: 't' })).rejects.toThrow(
      /Gmail authorisation failed: 400 Token has been expired or revoked/,
    );
    const refused = buildGmailTransport(ENV, { fetch: fakeGoogle({ sendStatus: 403 }).fetch });
    await expect(refused.sendMail({ to: 'a@example.com', subject: 's', text: 't' })).rejects.toThrow(
      /Gmail API 403 Insufficient Permission/,
    );
  });
});

describe('choosing the transport', () => {
  it('uses the Gmail API when it is set up, so mail works where SMTP is blocked', async () => {
    const google = fakeGoogle();
    vi.stubGlobal('fetch', google.fetch);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await installMailTransport({ ...ENV, SMTP_URL: 'smtps://u:p@smtp.example.com' });
    expect(result).toEqual({ installed: true, verified: true });
    expect(console.log).toHaveBeenCalledWith('[mail] Gmail API ready, sending as ApIForge <apiforge@example.test>');

    await sendVerificationEmail({ to: 'ada@example.com', name: 'Ada', token: 'tok' });
    expect(google.calls.some((c) => c.url.endsWith('/messages/send'))).toBe(true);
  });
});
