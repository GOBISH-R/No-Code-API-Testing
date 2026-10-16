import { describe, it, expect } from 'vitest';
import { runAssertions } from '../../src/services/assertions/assertionEngine.js';

const context = {
  status: 200,
  time: 243,
  headers: { 'content-type': 'application/json' },
  body: { id: 1, name: 'John' },
};

describe('runAssertions — PASS/FAIL calculation', () => {
  it('passes when every assertion passes', () => {
    const summary = runAssertions(
      [
        { source: 'status', operator: 'equals', expected: '200' },
        { source: 'time', operator: 'lessThan', expected: '1000' },
        { source: 'json', path: '$.id', operator: 'equals', expected: '1' },
      ],
      context,
    );

    expect(summary.passedCount).toBe(3);
    expect(summary.totalCount).toBe(3);
    expect(summary.allPassed).toBe(true);
  });

  it('fails the whole run when a single assertion fails', () => {
    const summary = runAssertions(
      [
        { source: 'status', operator: 'equals', expected: '200' },
        { source: 'json', path: '$.id', operator: 'equals', expected: '999' },
      ],
      context,
    );

    expect(summary.passedCount).toBe(1);
    expect(summary.totalCount).toBe(2);
    expect(summary.allPassed).toBe(false);
  });

  it('is not "passed" with no assertions at all', () => {
    // An empty set must not report a green PASS — there was nothing to verify.
    const summary = runAssertions([], context);
    expect(summary.allPassed).toBe(false);
    expect(summary.totalCount).toBe(0);
  });
});

describe('runAssertions — result detail', () => {
  it('reports actual alongside expected so a failure is explainable', () => {
    const summary = runAssertions(
      [{ source: 'status', operator: 'equals', expected: '404' }],
      context,
    );

    const [result] = summary.results;
    expect(result.actual).toBe(200);
    expect(result.expected).toBe('404');
    expect(result.operator).toBe('equals');
    expect(result.pass).toBe(false);
  });

  it('labels each assertion for display', () => {
    const summary = runAssertions(
      [
        { source: 'status', operator: 'equals', expected: '200' },
        { source: 'time', operator: 'lessThan', expected: '1000' },
        { source: 'header', headerName: 'Content-Type', operator: 'exists', expected: '' },
        { source: 'json', path: '$.id', operator: 'exists', expected: '' },
      ],
      context,
    );

    expect(summary.results.map((r) => r.label)).toEqual([
      'Status Code',
      'Response Time',
      'Header "Content-Type"',
      'JSON $.id',
    ]);
  });

  it('marks an assertion failed (not crashed) when extraction errors', () => {
    const summary = runAssertions(
      [{ source: 'json', path: '$[[[', operator: 'equals', expected: '1' }],
      context,
    );

    expect(summary.results[0].pass).toBe(false);
    expect(summary.allPassed).toBe(false);
  });
});

describe('runAssertions — variables in the expected value', () => {
  it('resolves a placeholder before comparing', () => {
    // The data-driven case: for the row {name: John}, the response should say John.
    const summary = runAssertions(
      [{ source: 'json', path: '$.name', operator: 'equals', expected: '{{expectedName}}' }],
      context,
      { expectedName: 'John' },
    );

    expect(summary.allPassed).toBe(true);
    // Reported as what was actually compared, not as the placeholder that was written.
    expect(summary.results[0].expected).toBe('John');
  });

  it('fails when the resolved value does not match', () => {
    const summary = runAssertions(
      [{ source: 'json', path: '$.name', operator: 'equals', expected: '{{expectedName}}' }],
      context,
      { expectedName: 'Grace' },
    );

    expect(summary.allPassed).toBe(false);
    expect(summary.results[0].expected).toBe('Grace');
  });

  it('errors on an unresolved placeholder rather than comparing the literal text', () => {
    // Comparing against the raw "{{missing}}" would report a mismatch and hide the
    // actual problem, which is that the variable was never defined.
    const summary = runAssertions(
      [{ source: 'json', path: '$.name', operator: 'equals', expected: '{{missing}}' }],
      context,
      { other: 'x' },
    );

    expect(summary.results[0].pass).toBe(false);
    expect(summary.results[0].error).toMatch(/unresolved variable.*missing/i);
  });

  it('leaves assertions untouched when no variables are supplied', () => {
    // Every pre-existing caller passes nothing; behaviour there must be identical.
    const summary = runAssertions(
      [{ source: 'status', operator: 'equals', expected: '200' }],
      context,
    );

    expect(summary.allPassed).toBe(true);
    expect(summary.results[0].expected).toBe('200');
  });

  it('does not disturb an operator that takes no expected value', () => {
    const summary = runAssertions(
      [{ source: 'json', path: '$.id', operator: 'exists' }],
      context,
      { anything: '1' },
    );

    expect(summary.results[0].pass).toBe(true);
    expect(summary.results[0].error).toBeNull();
  });
});
