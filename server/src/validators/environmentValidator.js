import { isValidVariableRows } from './variableRowsValidator.js';

export function validateEnvironment(payload) {
  if (!payload || typeof payload !== 'object') return ['An environment is required.'];

  const errors = [];

  if (typeof payload.name !== 'string' || !payload.name.trim()) {
    errors.push('name is required.');
  }

  if (payload.variables !== undefined && !isValidVariableRows(payload.variables)) {
    errors.push('variables must be an array of { key, value, enabled } rows.');
  }

  return errors;
}
