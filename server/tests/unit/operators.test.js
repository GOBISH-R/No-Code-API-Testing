import { describe, it, expect } from 'vitest';
import { compare } from '../../src/services/assertions/comparator.js';
import { validateAssertions } from '../../src/validators/assertionValidator.js';

describe('operators — inclusive ordering', () => {
  it('greaterThanOrEqual / lessThanOrEqual include the boundary', () => {
    expect(compare(200, 'greaterThanOrEqual', '200')).toBe(true);
    expect(compare(201, 'greaterThanOrEqual', '200')).toBe(true);
    expect(compare(199, 'greaterThanOrEqual', '200')).toBe(false);

    expect(compare(200, 'lessThanOrEqual', '200')).toBe(true);
    expect(compare(199, 'lessThanOrEqual', '200')).toBe(true);
    expect(compare(201, 'lessThanOrEqual', '200')).toBe(false);
  });

  it('is what makes "any 2xx" expressible without knowing the exact code', () => {
    expect(compare(204, 'greaterThanOrEqual', '200')).toBe(true);
    expect(compare(204, 'lessThanOrEqual', '299')).toBe(true);
  });

  it('still refuses non-numeric input', () => {
    expect(compare('abc', 'greaterThanOrEqual', '200')).toBe(false);
  });
});

describe('operators — notContains', () => {
  it('inverts contains', () => {
    expect(compare('application/json', 'notContains', 'xml')).toBe(true);
    expect(compare('application/json', 'notContains', 'json')).toBe(false);
  });
});

describe('operators — matches (regex)', () => {
  it('matches a pattern against a string', () => {
    expect(compare('abc123', 'matches', '^[a-z]+[0-9]+$')).toBe(true);
    expect(compare('abc123', 'matches', '^[0-9]+$')).toBe(false);
  });

  it('coerces numbers and serializes objects before matching', () => {
    expect(compare(200, 'matches', '^2[0-9]{2}$')).toBe(true);
    expect(compare({ name: 'John' }, 'matches', 'John')).toBe(true);
  });

  it('matches a realistic id / email shape', () => {
    expect(compare('user@example.com', 'matches', '^[^@]+@[^@]+\\.[a-z]+$')).toBe(true);
    expect(compare('507f1f77bcf86cd799439011', 'matches', '^[a-f0-9]{24}$')).toBe(true);
  });

  it('fails the assertion instead of throwing on an invalid pattern', () => {
    // A half-typed regex must never take down the request.
    expect(() => compare('abc', 'matches', '([')).not.toThrow();
    expect(compare('abc', 'matches', '([')).toBe(false);
  });

  it('refuses an over-long pattern rather than risking catastrophic backtracking', () => {
    expect(compare('aaa', 'matches', 'a'.repeat(1001))).toBe(false);
  });

  it('does not pass on a missing value', () => {
    expect(compare(undefined, 'matches', '.*')).toBe(false);
  });
});

describe('operators — startsWith / endsWith are offered to HTTP too', () => {
  it('are accepted on json and header sources', () => {
    // Added for WebSocket text assertions; offering them on only one protocol while
    // the shared comparator supports them would be an arbitrary asymmetry.
    expect(
      validateAssertions([
        { source: 'json', path: '$.url', operator: 'startsWith', expected: 'https://' },
        { source: 'header', headerName: 'Content-Type', operator: 'endsWith', expected: 'json' },
      ]),
    ).toEqual([]);
  });

  it('are still refused where they make no sense', () => {
    expect(validateAssertions([{ source: 'status', operator: 'startsWith', expected: '2' }]).join(' ')).toMatch(
      /operator/,
    );
  });
});

describe('operators — emptiness', () => {
  it('treats empty strings, arrays, objects, null and undefined as empty', () => {
    expect(compare('', 'isEmpty', '')).toBe(true);
    expect(compare('   ', 'isEmpty', '')).toBe(true);
    expect(compare([], 'isEmpty', '')).toBe(true);
    expect(compare({}, 'isEmpty', '')).toBe(true);
    expect(compare(null, 'isEmpty', '')).toBe(true);
    expect(compare(undefined, 'isEmpty', '')).toBe(true);
  });

  it('treats populated values as not empty', () => {
    expect(compare('x', 'isEmpty', '')).toBe(false);
    expect(compare([1], 'isEmpty', '')).toBe(false);
    expect(compare({ a: 1 }, 'isEmpty', '')).toBe(false);
    expect(compare([1], 'isNotEmpty', '')).toBe(true);
  });

  it('does not treat 0 or false as empty', () => {
    // 0 is a legitimate value — only absence and empty containers count as empty.
    expect(compare(0, 'isEmpty', '')).toBe(false);
    expect(compare(false, 'isEmpty', '')).toBe(false);
  });
});

describe('operators — validator agrees with the comparator', () => {
  it('accepts the new operators on the sources that offer them', () => {
    expect(
      validateAssertions([
        { source: 'status', operator: 'greaterThanOrEqual', expected: '200' },
        { source: 'time', operator: 'lessThanOrEqual', expected: '1000' },
        { source: 'json', path: '$.email', operator: 'matches', expected: '.+@.+' },
        { source: 'json', path: '$.items', operator: 'isNotEmpty', expected: '' },
        { source: 'header', headerName: 'X-Id', operator: 'notContains', expected: 'test' },
      ]),
    ).toEqual([]);
  });

  it('still rejects an operator that makes no sense for the source', () => {
    // Emptiness on a status code is meaningless — the dropdown never offers it and
    // the server must not accept it either.
    const errors = validateAssertions([{ source: 'status', operator: 'isEmpty', expected: '' }]);
    expect(errors.join(' ')).toMatch(/operator/);
  });

  it('rejects an entirely unknown operator', () => {
    const errors = validateAssertions([{ source: 'status', operator: 'sortOf', expected: '200' }]);
    expect(errors.join(' ')).toMatch(/operator/);
  });
});
