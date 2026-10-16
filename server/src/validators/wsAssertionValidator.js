import { STRATEGIES, MAX_TIMEOUT_MS } from '../services/websocket/waitEngine.js';

/**
 * Which assertion sources make sense for a WebSocket step.
 *
 * Deliberately *not* the HTTP set: a message has no status code and no response
 * headers, so offering those would invite tests that can never pass. `json` is shared
 * with HTTP because JSONPath over a parsed payload means the same thing in both.
 */
export const WS_OPERATORS_BY_SOURCE = {
  message: ['equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith', 'matches', 'isEmpty', 'isNotEmpty'],
  json: [
    'exists',
    'notExists',
    'equals',
    'notEquals',
    'contains',
    'notContains',
    'matches',
    'isEmpty',
    'isNotEmpty',
    'greaterThan',
    'lessThan',
    'greaterThanOrEqual',
    'lessThanOrEqual',
  ],
  messageType: ['equals', 'notEquals'],
  messageSize: ['equals', 'greaterThan', 'lessThan', 'greaterThanOrEqual', 'lessThanOrEqual'],
  messageCount: ['equals', 'notEquals', 'greaterThan', 'lessThan', 'greaterThanOrEqual', 'lessThanOrEqual'],
  connection: ['equals', 'notEquals'],
  closeCode: ['equals', 'notEquals', 'greaterThanOrEqual', 'lessThanOrEqual'],
  closeReason: ['equals', 'contains', 'matches', 'isEmpty', 'isNotEmpty'],
};

const WS_SOURCES = Object.keys(WS_OPERATORS_BY_SOURCE);

const ALLOWED_STRATEGIES = Object.values(STRATEGIES);

export function validateWsAssertions(assertions) {
  if (assertions === undefined) return [];
  if (!Array.isArray(assertions)) return ['assertions must be an array.'];

  const errors = [];

  assertions.forEach((assertion, index) => {
    const prefix = `assertions[${index}]`;

    if (!assertion || typeof assertion !== 'object') {
      errors.push(`${prefix} must be an object.`);
      return;
    }

    const { source, operator, path } = assertion;

    if (!WS_SOURCES.includes(source)) {
      errors.push(`${prefix}.source must be one of: ${WS_SOURCES.join(', ')}.`);
      return;
    }

    if (!WS_OPERATORS_BY_SOURCE[source].includes(operator)) {
      errors.push(
        `${prefix}.operator must be one of: ${WS_OPERATORS_BY_SOURCE[source].join(', ')} for source "${source}".`,
      );
    }

    if (source === 'json' && (typeof path !== 'string' || !path.trim())) {
      errors.push(`${prefix}.path is required for source "json".`);
    }
  });

  return errors;
}

export function validateWaitCondition(condition) {
  if (condition === undefined || condition === null) return [];
  if (typeof condition !== 'object') return ['waitFor must be an object.'];

  const errors = [];
  const strategy = condition.strategy || STRATEGIES.NEXT;

  if (!ALLOWED_STRATEGIES.includes(strategy)) {
    errors.push(`waitFor.strategy must be one of: ${ALLOWED_STRATEGIES.join(', ')}.`);
    return errors;
  }

  if (strategy === STRATEGIES.JSON_PATH && (typeof condition.path !== 'string' || !condition.path.trim())) {
    errors.push('waitFor.path is required for the jsonPath strategy.');
  }

  if (
    (strategy === STRATEGIES.CONTAINS || strategy === STRATEGIES.EQUALS || strategy === STRATEGIES.TYPE) &&
    (condition.value === undefined || condition.value === '')
  ) {
    errors.push(`waitFor.value is required for the ${strategy} strategy.`);
  }

  if (strategy === STRATEGIES.SEQUENCE) {
    if (!Array.isArray(condition.sequence) || condition.sequence.length === 0) {
      errors.push('waitFor.sequence must be a non-empty array for the sequence strategy.');
    }
  }

  if (condition.timeoutMs !== undefined) {
    const value = Number(condition.timeoutMs);
    if (!Number.isFinite(value) || value <= 0) {
      errors.push('waitFor.timeoutMs must be a positive number of milliseconds.');
    } else if (value > MAX_TIMEOUT_MS) {
      errors.push(`waitFor.timeoutMs may not exceed ${MAX_TIMEOUT_MS}ms.`);
    }
  }

  return errors;
}
