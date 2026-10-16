import nodemailer from 'nodemailer';
import { setMailTransport } from './mailer.js';
import { buildGmailTransport, isGmailApiConfigured } from './gmailTransport.js';

/**
 * The real mail transport.
 *
 * Kept apart from mailer.js so that module stays free of any provider: the tests
 * substitute their own capture function through the same seam, and development runs
 * with no transport at all, printing links to the terminal.
 *
 * This file is the only thing that knows nodemailer exists.
 */

export function isMailConfigured(env = process.env) {
  return isGmailApiConfigured(env) || Boolean(env.SMTP_URL?.trim() && env.MAIL_FROM?.trim());
}

/**
 * Builds a transport from SMTP_URL.
 *
 * A URL rather than a dozen separate variables because every provider documents one,
 * and it keeps host, port, credentials and TLS choice in a single value that is hard
 * to half-configure:
 *
 *   smtps://user:pass@smtp.example.com:465   implicit TLS
 *   smtp://user:pass@smtp.example.com:587    STARTTLS
 */
export function buildTransport(env = process.env) {
  const url = new URL(env.SMTP_URL.trim());

  // Implicit TLS on 465, STARTTLS on 587 — the two arrangements every provider offers.
  const secure = url.protocol === 'smtps:';
  const port = Number(url.port) || (secure ? 465 : 587);

  return nodemailer.createTransport({
    host: url.hostname,
    port,
    secure,
    // Decoded because a password containing @ : / # must be percent-encoded to sit in
    // a URL at all, and passing it through still encoded fails authentication with a
    // message that blames the credentials rather than the encoding.
    auth: url.username
      ? {
          user: decodeURIComponent(url.username),
          pass: decodeURIComponent(url.password),
        }
      : undefined,

    /**
     * Timeouts.
     *
     * Built from a parsed URL rather than passed alongside a URL string: given a
     * string, nodemailer treats the second argument as *message* defaults and drops
     * transport options silently. These were being ignored, which meant a hung SMTP
     * server could hold a signup request open until the HTTP client gave up.
     */
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/**
 * Wires the transport in, and checks it actually works.
 *
 * `verify()` opens a connection and authenticates, so a wrong password is discovered
 * at startup rather than by the first person who tries to sign up.
 *
 * A verification failure is logged loudly but does **not** stop the server. The
 * reasoning: mail being down breaks signup and password reset, while everything else —
 * running collections, the whole point of the tool — keeps working for people already
 * signed in. Refusing to boot would turn a transient SMTP outage into a total one.
 * The log line is written to be impossible to miss in a deploy.
 */
export async function installMailTransport(env = process.env, { createTransport } = {}) {
  if (!isMailConfigured(env)) {
    if (env.NODE_ENV === 'production') {
      // Unreachable in practice — checkConfig refuses to start first — but a second
      // line of defence costs nothing and this is the failure that hides itself.
      console.error(
        '[mail] Neither the Gmail API (GMAIL_REFRESH_TOKEN) nor SMTP_URL is set, with MAIL_FROM. ' +
          'Verification and password-reset emails will NOT be sent.',
      );
    }
    return { installed: false, verified: false };
  }

  /**
   * `createTransport` is a test seam, matching connectionManager's `createSocket`.
   *
   * verify() opens a real connection, which is right in production and wrong in a
   * suite that is deliberately offline — left to itself it does a DNS lookup and then
   * waits out the connect timeout, turning two unit tests into a 20-second hang.
   */
  // The Gmail API when it is set up — it works on hosts that block SMTP (Render's free
  // plan does) — and SMTP otherwise.
  const viaGmailApi = !createTransport && isGmailApiConfigured(env);
  const kind = viaGmailApi ? 'Gmail API' : 'SMTP';
  const transport = viaGmailApi ? buildGmailTransport(env) : (createTransport ?? buildTransport)(env);
  const from = env.MAIL_FROM.trim();

  setMailTransport(({ to, subject, text, html }) =>
    transport.sendMail({ from, to, subject, text, html }),
  );

  try {
    await transport.verify();
    console.log(`[mail] ${kind} ready, sending as ${from}`);
    return { installed: true, verified: true };
  } catch (err) {
    console.error(
      `[mail] ${kind} is configured but the connection failed: ${err.message}\n` +
        '[mail] Sign-up confirmation and password reset will fail until this is fixed.',
    );
    return { installed: true, verified: false };
  }
}
