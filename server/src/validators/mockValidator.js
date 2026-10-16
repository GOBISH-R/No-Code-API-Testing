import { isValidVariableRows } from './variableRowsValidator.js';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const MAX_DELAY_MS = 10000;

export function validateMock(payload) {
  if (!payload || typeof payload !== 'object') return ['A mock configuration is required.'];

  const errors = [];
  const { method, path, statusCode, headers, body, delayMs } = payload;

  if (!ALLOWED_METHODS.includes(method)) {
    errors.push(`method must be one of: ${ALLOWED_METHODS.join(', ')}.`);
  }

  if (typeof path !== 'string' || !path.trim().startsWith('/')) {
    errors.push('path is required and must start with "/", e.g. /users/:id.');
  }

  if (statusCode !== undefined) {
    if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
      errors.push('statusCode must be an integer between 100 and 599.');
    }
  }

  if (headers !== undefined && !isValidVariableRows(headers)) {
    errors.push('headers must be an array of { key, value, enabled } rows.');
  }

  if (body !== undefined && typeof body !== 'string') {
    errors.push('body must be a string.');
  }

  if (delayMs !== undefined) {
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) {
      errors.push(`delayMs must be an integer between 0 and ${MAX_DELAY_MS}.`);
    }
  }

  return errors;
}
