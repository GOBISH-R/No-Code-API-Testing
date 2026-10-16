import { isValidVariableRows } from './variableRowsValidator.js';

export function validateGlobals(payload) {
  if (!payload || typeof payload !== 'object') return ['A globals payload is required.'];

  if (payload.variables !== undefined && !isValidVariableRows(payload.variables)) {
    return ['variables must be an array of { key, value, enabled } rows.'];
  }

  return [];
}
