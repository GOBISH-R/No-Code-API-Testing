import axios from 'axios';
import { User } from '../../models/User.js';
import { Workspace } from '../../models/Workspace.js';
import { sendMonitorAlertEmail } from '../accounts/mailer.js';
import { decryptField } from '../security/fieldCrypto.js';
import { assertPublicUrl } from '../execution/urlValidator.js';
import { membership } from '../workspaces/workspaceService.js';

const WEBHOOK_TIMEOUT_MS = 10 * 1000;
const MAX_FAILURES_LISTED = 5;

function shortValue(value) {
  if (value === undefined) return 'nothing';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

// "Status Code equals 200, got 500" — what was expected and what came back.
function describeFailedAssertion(a) {
  if (a.error) return `${a.label}: ${a.error}`;
  const operator = String(a.operator || '').replace(/([A-Z])/g, ' $1').toLowerCase();
  const expectsValue = !/exists|empty/.test(operator);
  return `${a.label} ${operator}${expectsValue ? ` ${shortValue(a.expected)}` : ''}, got ${shortValue(a.actual)}`;
}

/** Short "Request — reason" lines for the requests that did not pass. */
export function summariseFailures(run) {
  const lines = [];
  for (const step of run?.results ?? []) {
    let reason = null;
    if (!step.success) {
      reason = step.error || 'the request failed';
    } else if (step.assertions && !step.assertions.allPassed) {
      const failed = step.assertions.results.find((r) => !r.pass);
      reason = failed ? describeFailedAssertion(failed) : 'a test failed';
    }
    if (reason) {
      const label = `${step.method && step.method !== '—' ? `${step.method} ` : ''}${step.requestName}`;
      lines.push(`${label}${step.iterationLabel ? ` [${step.iterationLabel}]` : ''} — ${reason}`);
    }
  }
  if (lines.length > MAX_FAILURES_LISTED) {
    const more = lines.length - MAX_FAILURES_LISTED;
    return [...lines.slice(0, MAX_FAILURES_LISTED), `…and ${more} more`];
  }
  return lines;
}

/**
 * Who the email goes to: whoever made the monitor, as long as they can still see it.
 * Someone removed from a workspace must stop hearing about it; then — and for monitors
 * made before alerts existed — it goes to the owner of the space the monitor lives in.
 */
async function recipientFor(monitor) {
  const scope = monitor.userId;
  const workspace = await Workspace.findById(scope).select('userId name').lean();

  let userId = null;
  if (monitor.createdBy) {
    const stillIn = workspace
      ? await membership(monitor.createdBy, scope)
      : String(monitor.createdBy) === String(scope);
    if (stillIn) userId = monitor.createdBy;
  }
  userId ??= workspace ? workspace.userId : scope;

  const user = await User.findById(userId).select('email name emailVerified').lean();
  return { user: user?.emailVerified ? user : null, workspaceName: workspace?.name ?? null };
}

function webhookPayload({ event, monitor, collectionName, workspaceName, run, failures }) {
  const verb = { failed: 'is failing', recovered: 'has recovered', test: 'test alert' }[event];
  const headline = `ApIForge monitor "${monitor.name}" ${verb}${workspaceName ? ` (${workspaceName})` : ''}`;
  const text = [headline, ...failures.map((f) => `• ${f}`)].join('\n');
  return {
    event: `monitor.${event}`,
    monitor: { id: String(monitor._id), name: monitor.name },
    collection: collectionName,
    workspace: workspaceName,
    status: run?.status ?? null,
    runId: run?._id ? String(run._id) : null,
    failures,
    at: new Date().toISOString(),
    // The field names Slack (text) and Discord (content) read, so the same URL works
    // pasted straight from either.
    text,
    content: text,
  };
}

/**
 * Posts to the monitor's webhook. The URL was typed by a user, so it goes through the
 * same SSRF guard as every request this server sends, and redirects are not followed —
 * a redirect is how a public URL would reach an internal one.
 */
export async function postWebhook(url, payload) {
  const target = await assertPublicUrl(url);
  const res = await axios.post(target.toString(), payload, {
    timeout: WEBHOOK_TIMEOUT_MS,
    maxRedirects: 0,
    validateStatus: () => true,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'ApIForge-Monitor/1.0' },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`the webhook answered ${res.status}`);
  }
  return res.status;
}

/**
 * Sends one alert by every channel the monitor has turned on. Never throws: an alert that
 * cannot be delivered is logged — without its URL or address — and the monitor carries on.
 *
 * @returns {Promise<{ email: string, webhook: string }>} what happened per channel, so
 *   "Send a test alert" can tell the person whether their setup works.
 */
export async function sendMonitorAlert({ monitor, event, run = null, collectionName = '' }) {
  const result = { email: 'off', webhook: 'off' };
  const failures = event === 'recovered' ? [] : summariseFailures(run);
  let workspaceName = null;

  if (monitor.alertEmail) {
    try {
      const recipient = await recipientFor(monitor);
      workspaceName = recipient.workspaceName;
      if (!recipient.user) {
        result.email = 'no recipient';
      } else {
        await sendMonitorAlertEmail({
          to: recipient.user.email,
          name: recipient.user.name,
          event,
          monitorName: monitor.name,
          collectionName: collectionName || run?.collectionName || 'its collection',
          workspaceName,
          failures,
        });
        result.email = 'sent';
      }
    } catch (err) {
      result.email = 'failed';
      console.warn(`[monitors] Alert email not sent: ${err.message}`);
    }
  }

  if (monitor.alertWebhookUrl) {
    try {
      if (workspaceName === null) workspaceName = (await Workspace.findById(monitor.userId).select('name').lean())?.name ?? null;
      const url = decryptField(monitor.alertWebhookUrl);
      await postWebhook(url, webhookPayload({ event, monitor, collectionName: collectionName || run?.collectionName || '', workspaceName, run, failures }));
      result.webhook = 'sent';
    } catch (err) {
      result.webhook = `failed: ${err.message}`;
      console.warn(`[monitors] Alert webhook not delivered: ${err.message}`);
    }
  }

  return result;
}
