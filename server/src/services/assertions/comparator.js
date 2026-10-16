function isNumeric(value) {
  if (value === null || value === undefined || value === '' || Array.isArray(value)) return false;
  if (typeof value === 'object') return false;
  return !Number.isNaN(Number(value));
}

function looseEquals(actual, expected) {
  if (actual === undefined || actual === null) return false;

  if (isNumeric(actual) && isNumeric(expected)) {
    return Number(actual) === Number(expected);
  }

  if (typeof actual === 'object') {
    try {
      return JSON.stringify(actual) === JSON.stringify(JSON.parse(expected));
    } catch {
      return JSON.stringify(actual) === expected;
    }
  }

  return String(actual) === String(expected);
}

function containsCheck(actual, expected) {
  if (actual === undefined || actual === null) return false;
  if (Array.isArray(actual)) return actual.some((item) => String(item) === String(expected));
  if (typeof actual === 'object') return JSON.stringify(actual).includes(String(expected));
  return String(actual).includes(String(expected));
}

// A regular expression is user-supplied, and JavaScript has no way to time one out
// mid-match, so a pathological pattern could spin on a large response body. Bounding
// both the pattern and the text keeps the worst case finite without pulling in a
// regex analyser; an invalid pattern simply fails the assertion instead of throwing.
const MAX_PATTERN_LENGTH = 1000;
const MAX_MATCH_LENGTH = 100_000;

function matchesCheck(actual, expected) {
  if (actual === undefined || actual === null) return false;
  if (typeof expected !== 'string' || !expected || expected.length > MAX_PATTERN_LENGTH) return false;

  const text = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
  if (text.length > MAX_MATCH_LENGTH) return false;

  try {
    return new RegExp(expected).test(text);
  } catch {
    return false;
  }
}

function isEmptyCheck(actual) {
  if (actual === undefined || actual === null) return true;
  if (typeof actual === 'string') return actual.trim() === '';
  if (Array.isArray(actual)) return actual.length === 0;
  if (typeof actual === 'object') return Object.keys(actual).length === 0;
  return false;
}

// Pure actual/operator/expected -> boolean. No knowledge of HTTP, JSONPath, or the request executor.
export function compare(actual, operator, expected) {
  switch (operator) {
    case 'equals':
      return looseEquals(actual, expected);
    case 'notEquals':
      return !looseEquals(actual, expected);
    case 'greaterThan':
      return isNumeric(actual) && isNumeric(expected) && Number(actual) > Number(expected);
    case 'lessThan':
      return isNumeric(actual) && isNumeric(expected) && Number(actual) < Number(expected);
    case 'greaterThanOrEqual':
      return isNumeric(actual) && isNumeric(expected) && Number(actual) >= Number(expected);
    case 'lessThanOrEqual':
      return isNumeric(actual) && isNumeric(expected) && Number(actual) <= Number(expected);
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'notExists':
      return actual === undefined || actual === null;
    case 'contains':
      return containsCheck(actual, expected);
    case 'notContains':
      return !containsCheck(actual, expected);
    case 'startsWith':
      return actual !== undefined && actual !== null && String(actual).startsWith(String(expected));
    case 'endsWith':
      return actual !== undefined && actual !== null && String(actual).endsWith(String(expected));
    case 'matches':
      return matchesCheck(actual, expected);
    case 'isEmpty':
      return isEmptyCheck(actual);
    case 'isNotEmpty':
      return !isEmptyCheck(actual);
    default:
      return false;
  }
}
