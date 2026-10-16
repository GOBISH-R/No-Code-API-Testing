import { operatorLabel } from '../hooks/useAssertions.js';

// The dropdown labels are written to read well as "Status Code | equals | 200", which
// is not the same grammar as "Expected 404 to …". Only the operators whose label does
// not fit that sentence need an override; everything else falls back to the label.
const SENTENCE_PHRASING = {
  exists: 'exist',
  notExists: 'not exist',
  isEmpty: 'be empty',
  isNotEmpty: 'not be empty',
  matches: 'match regex',
  equals: 'equal',
  notEquals: 'not equal',
  contains: 'contain',
  notContains: 'not contain',
  startsWith: 'start with',
  endsWith: 'end with',
};

function formatValue(value) {
  if (value === undefined) return 'undefined';
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

export function failureReason(result) {
  if (result.error) return result.error;

  const phrase = SENTENCE_PHRASING[result.operator] || operatorLabel(result.source, result.operator);

  return `Expected ${formatValue(result.actual)} to ${phrase}${
    result.expected ? ` ${result.expected}` : ''
  }.`;
}
