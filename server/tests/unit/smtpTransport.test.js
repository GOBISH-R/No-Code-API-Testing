import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isMailConfigured,
  buildTransport,
  installMailTransport,
} from '../../src/services/accounts/smtpTransport.js';
import { setMailTransport, sendVerificationEmail } from '../../src/services/accounts/mailer.js';

// Where an email ends up: { logged: true } with no transport, the transport's answer with one.
const sendOne = () => sendVerificationEmail({ to: 'ada@example.test', name: 'Ada', token: 'tok' });

/**
 * Wiring the real transport.
 *
 * The gap this closes: SMTP_URL and MAIL_FROM were required at startup but nothing
 * read them, so a production server booted, passed its own config check, and then
 * logged verification emails to stdout instead of sending them. Nobody could confirm
 * an address or recover a password, and nothing said so.
 */

const CONFIGURED = {
  SMTP_URL: 'smtps://user:pass@smtp.example.com:465',
  MAIL_FROM: 'ApIForge <noreply@example.com>',
};

beforeEach(() => {
  setMailTransport(null);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setMailTransport(null);
  vi.restoreAllMocks();
});

describe('detecting configuration', () => {
  it('needs both a URL and a from address', () => {
    expect(isMailConfigured(CONFIGURED)).toBe(true);
    expect(isMailConfigured({ SMTP_URL: CONFIGURED.SMTP_URL })).toBe(false);
    expect(isMailConfigured({ MAIL_FROM: CONFIGURED.MAIL_FROM })).toBe(false);
    expect(isMailConfigured({})).toBe(false);
  });

  it('treats blank values as absent', () => {
    expect(isMailConfigured({ SMTP_URL: '   ', MAIL_FROM: '  ' })).toBe(false);
  });
});

describe('building the transport', () => {
  it('parses an SMTP URL into host, port and credentials', () => {
    const transport = buildTransport(CONFIGURED);
    expect(transport.options.host).toBe('smtp.example.com');
    expect(transport.options.port).toBe(465);
    expect(transport.options.secure).toBe(true);
    expect(transport.options.auth.user).toBe('user');
  });

  it('uses STARTTLS for an smtp:// URL on 587', () => {
    const transport = buildTransport({
      ...CONFIGURED,
      SMTP_URL: 'smtp://user:pass@smtp.example.com:587',
    });
    expect(transport.options.port).toBe(587);
    expect(transport.options.secure).toBe(false);
  });

  it('sets timeouts, so a hung SMTP server cannot hold a signup open', () => {
    const transport = buildTransport(CONFIGURED);
    expect(transport.options.connectionTimeout).toBeGreaterThan(0);
    expect(transport.options.socketTimeout).toBeGreaterThan(0);
  });
});

describe('installing it', () => {
  it('does nothing when unconfigured, leaving the log-to-terminal path in place', async () => {
    const result = await installMailTransport({ NODE_ENV: 'development' });

    expect(result.installed).toBe(false);
    expect(await sendOne()).toEqual({ logged: true });
  });

  it('warns loudly if production somehow reaches here unconfigured', async () => {
    // checkConfig refuses to start first; this is the second line of defence, because
    // silently-not-sending is the failure that hides itself.
    await installMailTransport({ NODE_ENV: 'production' });

    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/will NOT be sent/));
  });

  /**
   * A stand-in transport.
   *
   * The real one's verify() opens a socket, which belongs in production and not in a
   * suite that is deliberately offline — unmocked these two cases did a DNS lookup and
   * then sat out the connect timeout. The live path is covered separately, against a
   * throwaway SMTP server.
   */
  const fakeTransport = (verifyResult) => () => ({
    verify: () => verifyResult,
    sendMail: async (message) => ({ accepted: [message.to] }),
  });

  it('installs a transport when configured', async () => {
    const result = await installMailTransport(CONFIGURED, {
      createTransport: fakeTransport(Promise.resolve(true)),
    });

    expect(result).toEqual({ installed: true, verified: true });
    expect(await sendOne()).toEqual({ accepted: ['ada@example.test'] });
  });

  it('reports a failed connection without refusing to start', async () => {
    // Mail being down breaks signup and reset; everything else keeps working for
    // people already signed in. Refusing to boot would turn a transient SMTP outage
    // into a total one.
    const result = await installMailTransport(CONFIGURED, {
      createTransport: fakeTransport(Promise.reject(new Error('ECONNREFUSED'))),
    });

    expect(result.installed).toBe(true);
    expect(result.verified).toBe(false);
    // Still installed, so a later send is attempted rather than silently skipped.
    expect(await sendOne()).toEqual({ accepted: ['ada@example.test'] });
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/SMTP is configured but/));
  });
});

describe('a send that fails is not reported as a success', () => {
  it('rethrows rather than resolving quietly', async () => {
    // "Check your email" for a message that never left is the worst outcome here.
    setMailTransport(async () => {
      throw new Error('550 mailbox unavailable');
    });

    await expect(
      sendVerificationEmail({ to: 'ada@example.com', name: 'Ada', token: 'tok' }),
    ).rejects.toThrow(/could not send email.*mailbox unavailable/i);
  });

  it('passes the message through to the transport when it works', async () => {
    const sent = [];
    setMailTransport(async (message) => {
      sent.push(message);
      return { ok: true };
    });

    await sendVerificationEmail({ to: 'ada@example.com', name: 'Ada', token: 'tok-123' });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ada@example.com');
    expect(sent[0].subject).toMatch(/confirm/i);
    expect(sent[0].text).toContain('tok-123');
    // Sent as HTML with a plain-text copy, both carrying the link.
    expect(sent[0].html).toContain('tok-123');
    expect(sent[0].html).toContain('Verify my email');
    // The transport owns `from`; the message must not try to set it.
    expect(sent[0].from).toBeUndefined();
  });
});

describe('credentials with awkward characters', () => {
  it('decodes a percent-encoded password', () => {
    // A password containing @ : / # must be percent-encoded to sit in a URL at all.
    // Passing it through still-encoded fails auth with an error that blames the
    // credentials rather than the encoding.
    const transport = buildTransport({
      MAIL_FROM: 'a@b.c',
      SMTP_URL: 'smtps://api%40example.com:p%40ss%3Aword@smtp.example.com:465',
    });

    expect(transport.options.auth.user).toBe('api@example.com');
    expect(transport.options.auth.pass).toBe('p@ss:word');
  });

  it('defaults the port by scheme when the URL omits it', () => {
    expect(
      buildTransport({ MAIL_FROM: 'a@b.c', SMTP_URL: 'smtps://u:p@smtp.example.com' }).options.port,
    ).toBe(465);
    expect(
      buildTransport({ MAIL_FROM: 'a@b.c', SMTP_URL: 'smtp://u:p@smtp.example.com' }).options.port,
    ).toBe(587);
  });

  it('allows a relay that needs no authentication', () => {
    const transport = buildTransport({ MAIL_FROM: 'a@b.c', SMTP_URL: 'smtp://localhost:25' });
    expect(transport.options.auth).toBeUndefined();
  });
});
