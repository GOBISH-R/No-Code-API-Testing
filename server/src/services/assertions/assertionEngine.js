import { extractActualValue } from './extractor.js';
import { compare } from './comparator.js';
import { resolveTextValue } from '../variables/variableResolver.js';

function describeAssertion(assertion) {
  switch (assertion.source) {
    case 'status':
      return 'Status Code';
    case 'time':
      return 'Response Time';
    case 'header':
      return `Header "${assertion.headerName}"`;
    case 'json':
      return `JSON ${assertion.path}`;
    default:
      return assertion.source;
  }
}

/**
 * Substitutes variables into what an assertion expects.
 *
 * Without this an expected value can only ever be a constant, which makes a
 * data-driven run unable to check the thing that varies: "for row `ada`, the response
 * should say `ada`". An unresolved placeholder becomes an error rather than a silent
 * mismatch, because comparing against the literal text `{{username}}` would report a
 * failing assertion and hide the real cause.
 */
function resolveExpected(expected, variables) {
  if (expected === undefined || expected === null) return { expected, error: null };
  if (!variables || Object.keys(variables).length === 0) return { expected, error: null };

  const { text, missing } = resolveTextValue(String(expected), variables);
  if (missing.length > 0) {
    return {
      expected,
      error: `Unresolved variable${missing.length > 1 ? 's' : ''} in the expected value: ${missing
        .map((m) => `{{${m}}}`)
        .join(', ')}.`,
    };
  }
  return { expected: text, error: null };
}

// API Response -> Extractor -> Actual Value -> Comparator -> Expected Value -> PASS/FAIL.
// Deliberately has no knowledge of how the request was executed.
export function runAssertions(assertions, context, variables = {}) {
  const results = assertions.map((assertion) => {
    const { value: actual, error: extractError } = extractActualValue(assertion, context);
    const { expected, error: expectedError } = resolveExpected(assertion.expected, variables);

    const error = extractError || expectedError || null;
    const pass = !error && compare(actual, assertion.operator, expected);

    return {
      source: assertion.source,
      path: assertion.path,
      headerName: assertion.headerName,
      operator: assertion.operator,
      // The resolved value, so a report shows what was actually compared rather than
      // the placeholder that was written.
      expected,
      actual,
      pass,
      label: describeAssertion(assertion),
      error,
    };
  });

  const passedCount = results.filter((r) => r.pass).length;

  return {
    results,
    passedCount,
    totalCount: results.length,
    allPassed: results.length > 0 && passedCount === results.length,
  };
}
