// Kept in sync with the client's OPERATORS_BY_SOURCE (hooks/useAssertions.js), which
// drives the dropdown. Operators are offered per source because most only make sense
// for some: ordering on a status code or a response time, regex on text, emptiness on
// a JSON value or header.
const OPERATORS_BY_SOURCE = {
  status: ['equals', 'notEquals', 'greaterThan', 'lessThan', 'greaterThanOrEqual', 'lessThanOrEqual'],
  json: [
    'exists',
    'notExists',
    'equals',
    'notEquals',
    'contains',
    'notContains',
    'startsWith',
    'endsWith',
    'matches',
    'isEmpty',
    'isNotEmpty',
    'greaterThan',
    'lessThan',
    'greaterThanOrEqual',
    'lessThanOrEqual',
  ],
  header: [
    'exists',
    'notExists',
    'equals',
    'notEquals',
    'contains',
    'notContains',
    'startsWith',
    'endsWith',
    'matches',
  ],
  time: ['lessThan', 'greaterThan', 'lessThanOrEqual', 'greaterThanOrEqual'],
};

const ALLOWED_SOURCES = Object.keys(OPERATORS_BY_SOURCE);

// Validates the shape of the visual assertions coming from the Tests tab.
// Returns a list of human-readable error strings; empty list means valid.
export function validateAssertions(assertions) {
  if (assertions === undefined) return [];
  if (!Array.isArray(assertions)) return ['assertions must be an array.'];

  const errors = [];

  assertions.forEach((assertion, index) => {
    const prefix = `assertions[${index}]`;

    if (!assertion || typeof assertion !== 'object') {
      errors.push(`${prefix} must be an object.`);
      return;
    }

    const { source, operator, path, headerName } = assertion;

    if (!ALLOWED_SOURCES.includes(source)) {
      errors.push(`${prefix}.source must be one of: ${ALLOWED_SOURCES.join(', ')}.`);
      return;
    }

    if (!OPERATORS_BY_SOURCE[source].includes(operator)) {
      errors.push(
        `${prefix}.operator must be one of: ${OPERATORS_BY_SOURCE[source].join(', ')} for source "${source}".`,
      );
    }

    if (source === 'json' && (typeof path !== 'string' || !path.trim())) {
      errors.push(`${prefix}.path is required for source "json".`);
    }

    if (source === 'header' && (typeof headerName !== 'string' || !headerName.trim())) {
      errors.push(`${prefix}.headerName is required for source "header".`);
    }
  });

  return errors;
}
