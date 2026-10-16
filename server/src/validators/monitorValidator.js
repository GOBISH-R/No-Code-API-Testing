import { MONITOR_INTERVALS } from '../models/Monitor.js';
import { isValidId } from '../utils/objectId.js';

const MAX_NAME_LENGTH = 100;
const MAX_WEBHOOK_LENGTH = 500;

/**
 * A webhook must be an absolute http(s) URL. Whether it points somewhere public is
 * checked again when it is used — DNS can change — by the same guard requests go through.
 */
function isWebhookUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_WEBHOOK_LENGTH) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Checks a monitor payload. On create every field is required; on update only the
 * fields present are checked, so a pause is just `{ enabled: false }`.
 */
export function validateMonitor(payload, { partial = false } = {}) {
  if (!payload || typeof payload !== 'object') return ['A monitor is required.'];
  const errors = [];
  const { name, collectionId, environmentId, intervalMinutes, enabled, alertEmail, alertWebhookUrl } = payload;
  const needs = (value) => !partial || value !== undefined;

  if (needs(name) && (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_NAME_LENGTH)) {
    errors.push(`name is required and must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  if (needs(collectionId) && !isValidId(collectionId)) {
    errors.push('collectionId must be a valid id.');
  }
  if (environmentId !== undefined && environmentId !== null && environmentId !== '' && !isValidId(environmentId)) {
    errors.push('environmentId must be a valid id or empty.');
  }
  if (needs(intervalMinutes) && !MONITOR_INTERVALS.includes(intervalMinutes)) {
    errors.push(`intervalMinutes must be one of: ${MONITOR_INTERVALS.join(', ')}.`);
  }
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    errors.push('enabled must be true or false.');
  }
  if (alertEmail !== undefined && typeof alertEmail !== 'boolean') {
    errors.push('alertEmail must be true or false.');
  }
  if (alertWebhookUrl !== undefined && alertWebhookUrl !== '' && !isWebhookUrl(alertWebhookUrl)) {
    errors.push(`alertWebhookUrl must be an http(s) URL of up to ${MAX_WEBHOOK_LENGTH} characters, without a username or password.`);
  }
  return errors;
}
