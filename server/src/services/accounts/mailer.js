import { checkConfig } from '../../config/validateConfig.js';
import { renderActionEmail, APP_NAME } from './emailTemplate.js';

/**
 * Sending the app's emails: verify your address, confirm a password reset, workspace
 * invitations and monitor alerts.
 *
 * Deliberately not tied to a provider. In development there is no SMTP account and
 * should not need to be one, so the message is written to the log and the link is
 * printed — you click it from the terminal and the whole flow is testable offline.
 *
 * In production a real transport is required, and its absence is a startup error
 * rather than a silent no-op: an account system whose reset emails quietly vanish is
 * worse than one that refuses to boot.
 */

let transport = null;

/**
 * Registers the real transport. Called once at startup when configured.
 *
 * The function receives { to, subject, text, html } and is responsible for the `from`
 * address — that belongs to the transport's configuration, not to the message.
 * smtpTransport.js is the only implementation; tests pass a capture function.
 */
export function setMailTransport(fn) {
  transport = typeof fn === 'function' ? fn : null;
}

async function deliver(message) {
  if (transport) {
    try {
      return await transport(message);
    } catch (err) {
      /**
       * Rethrown with the recipient stripped and the provider's text kept.
       *
       * The caller decides what to do — registration surfaces it, the
       * already-registered path swallows it — but a send that fails must never look
       * like one that succeeded. "Check your email" for a mail that never left is the
       * worst outcome here.
       */
      throw new Error(`Could not send email: ${err.message}`);
    }
  }

  // No transport: log it. Production never reaches here — checkConfig refuses to start
  // without one — so this is the developer path, where the link in the log is the point.
  console.log(
    [
      '',
      '──────── email (no transport configured; logged instead) ────────',
      `  to:      ${message.to}`,
      `  subject: ${message.subject}`,
      '',
      message.text.split('\n').map((l) => `  ${l}`).join('\n'),
      '─────────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
  return { logged: true };
}

function appUrl() {
  return (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

// Served by the client from public/brand/. Only visible once the site is on a public
// address: an inbox cannot fetch an image from localhost, so in development the email
// shows the name alone.
function logoUrl() {
  return `${appUrl()}/brand/apiforge-mark.png`;
}

/**
 * Every email goes out as HTML with a plain-text copy alongside. The HTML is what
 * people see; the text is for mail apps that show no HTML, for spam filters (which
 * trust a message with both more than one with only HTML), and for the dev log.
 */
export async function sendVerificationEmail({ to, name, token }) {
  const link = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  const greeting = `Hi${name ? ` ${name}` : ''},`;
  const intro = `Please confirm that you want to use this as your ${APP_NAME} account email address. Once it's done you'll be signed in and can start testing.`;
  const note =
    "This link expires in 10 minutes. If you didn't create an account, you can ignore this email — an unconfirmed account is deleted after 24 hours.";

  return deliver({
    to,
    subject: `Confirm your email address for ${APP_NAME}`,
    text: [greeting, '', intro, '', link, '', note].join('\n'),
    html: renderActionEmail({
      logoUrl: logoUrl(),
      heading: 'Verify your email address',
      greeting,
      intro,
      buttonLabel: 'Verify my email',
      link,
      note,
    }),
  });
}

/**
 * "Is this you resetting your password?" — sent when Forgot password is pressed on the
 * sign-in page. Two buttons, Google-style: Yes lets that sign-in page ask for the new
 * password; No cancels the request. The tab a button opens records the answer and goes
 * straight to the sign-in page.
 */
export async function sendResetConfirmationEmail({ to, name, token, device, requestedAt }) {
  const base = `${appUrl()}/reset-confirm?token=${encodeURIComponent(token)}`;
  const yes = `${base}&answer=yes`;
  const no = `${base}&answer=no`;
  const greeting = `Hi${name ? ` ${name}` : ''},`;
  const intro = `Someone is trying to reset the password for your ${APP_NAME} account (${to}).`;
  const details = [`Device: ${device}`, `Time: ${requestedAt}`];
  const note =
    "If this wasn't you, choose No — your password stays the same. The request expires in 15 minutes.";

  return deliver({
    to,
    subject: `Is this you resetting your ${APP_NAME} password?`,
    text: [
      greeting,
      '',
      intro,
      '',
      ...details,
      '',
      `Yes, it's me: ${yes}`,
      '',
      `No, it wasn't me: ${no}`,
      '',
      note,
    ].join('\n'),
    html: renderActionEmail({
      logoUrl: logoUrl(),
      heading: 'Is this you?',
      greeting,
      intro,
      details,
      buttonLabel: "Yes, it's me",
      link: yes,
      secondary: { label: "No, it wasn't me", link: no },
      note,
    }),
  });
}

/**
 * Tells someone they were invited to a workspace. Carries no token: accepting happens
 * inside the app, signed in as this address, which is what proves it is theirs.
 */
export async function sendWorkspaceInviteEmail({ to, inviterName, workspaceName, role }) {
  const link = `${appUrl()}/app`;
  const intro = `${inviterName} invited you to the workspace "${workspaceName}" on ${APP_NAME} as ${
    role === 'editor' ? 'an editor' : 'a viewer'
  }. Sign in with this email address and accept the invitation under Workspaces.`;
  const note = "The invitation is open for 7 days. If you weren't expecting it, you can ignore this email.";

  return deliver({
    to,
    subject: `${inviterName} invited you to "${workspaceName}" on ${APP_NAME}`,
    text: ['Hi,', '', intro, '', link, '', note].join('\n'),
    html: renderActionEmail({
      logoUrl: logoUrl(),
      heading: 'You have been invited to a workspace',
      greeting: 'Hi,',
      intro,
      buttonLabel: `Open ${APP_NAME}`,
      link,
      note,
    }),
  });
}

/**
 * A monitor changed state: it started failing, it recovered, or someone pressed "Send a
 * test alert". `failures` are short "Request — reason" lines.
 */
export async function sendMonitorAlertEmail({ to, name, event, monitorName, collectionName, workspaceName, failures = [] }) {
  const link = `${appUrl()}/app`;
  const where = `${collectionName}${workspaceName ? ` in ${workspaceName}` : ''}`;
  const copy = {
    failed: {
      subject: `Monitor failing: ${monitorName}`,
      heading: 'A monitor is failing',
      intro: `The monitor "${monitorName}" ran ${where} and did not pass. You will hear again when it recovers — not on every failed run.`,
    },
    recovered: {
      subject: `Monitor recovered: ${monitorName}`,
      heading: 'A monitor has recovered',
      intro: `The monitor "${monitorName}" is passing again (${where}).`,
    },
    test: {
      subject: `Test alert: ${monitorName}`,
      heading: 'Alerts are working',
      intro: `This is a test alert for the monitor "${monitorName}" (${where}). Real alerts look like this when it starts failing or recovers.`,
    },
  }[event];
  const greeting = `Hi${name ? ` ${name}` : ''},`;
  const note = 'You get this because alerts are on for this monitor. Turn them off under Monitors → Edit.';

  return deliver({
    to,
    subject: copy.subject,
    text: [greeting, '', copy.intro, '', ...failures.map((f) => `• ${f}`), failures.length ? '' : null, link, '', note]
      .filter((line) => line !== null)
      .join('\n'),
    html: renderActionEmail({
      logoUrl: logoUrl(),
      heading: copy.heading,
      greeting,
      intro: copy.intro,
      details: failures,
      buttonLabel: 'Open the run',
      link,
      note,
    }),
  });
}

// Re-exported so config validation and the mailer agree on what "configured" means.
export { checkConfig };
