import { describe, it, expect } from 'vitest';
import { compare } from '../../src/services/assertions/comparator.js';

describe('compare — equals', () => {
  it('compares numbers and numeric strings by value', () => {
    // The Request Builder stores every expected value as a string, so 200 vs "200"
    // is the single most common assertion in the product.
    expect(compare(200, 'equals', '200')).toBe(true);
    expect(compare(200, 'equals', '404')).toBe(false);
  });

  it('compares plain strings', () => {
    expect(compare('ok', 'equals', 'ok')).toBe(true);
    expect(compare('ok', 'equals', 'OK')).toBe(false);
  });

  it('compares objects against JSON text', () => {
    expect(compare({ a: 1 }, 'equals', '{"a":1}')).toBe(true);
    expect(compare({ a: 1 }, 'equals', '{"a":2}')).toBe(false);
  });

  it('never passes when the value is missing', () => {
    expect(compare(undefined, 'equals', '200')).toBe(false);
    expect(compare(null, 'equals', '200')).toBe(false);
  });
});

describe('compare — notEquals', () => {
  it('inverts equals', () => {
    expect(compare(200, 'notEquals', '404')).toBe(true);
    expect(compare(200, 'notEquals', '200')).toBe(false);
  });
});

describe('compare — ordering', () => {
  it('handles greaterThan / lessThan numerically', () => {
    expect(compare(500, 'greaterThan', '200')).toBe(true);
    expect(compare(100, 'greaterThan', '200')).toBe(false);
    expect(compare(120, 'lessThan', '1000')).toBe(true);
    expect(compare(2000, 'lessThan', '1000')).toBe(false);
  });

  it('fails ordering on non-numeric input rather than coercing nonsense', () => {
    expect(compare('abc', 'greaterThan', '200')).toBe(false);
    expect(compare(200, 'lessThan', 'abc')).toBe(false);
  });
});

describe('compare — existence', () => {
  it('treats undefined and null as not existing', () => {
    expect(compare('value', 'exists', '')).toBe(true);
    expect(compare(0, 'exists', '')).toBe(true);
    expect(compare(undefined, 'exists', '')).toBe(false);
    expect(compare(null, 'exists', '')).toBe(false);

    expect(compare(undefined, 'notExists', '')).toBe(true);
    expect(compare('value', 'notExists', '')).toBe(false);
  });

  it('notExists is how a GraphQL in-band error check is written', () => {
    // GraphQL returns HTTP 200 with an `errors` array, so `$.errors notExists`
    // is the documented no-code way to catch it.
    expect(compare(undefined, 'notExists', '')).toBe(true);
    expect(compare([{ message: 'boom' }], 'notExists', '')).toBe(false);
  });
});

describe('compare — contains', () => {
  it('matches substrings, array members and serialized objects', () => {
    expect(compare('application/json', 'contains', 'json')).toBe(true);
    expect(compare('application/json', 'contains', 'xml')).toBe(false);
    expect(compare(['a', 'b'], 'contains', 'b')).toBe(true);
    expect(compare(['a', 'b'], 'contains', 'z')).toBe(false);
    expect(compare({ name: 'John' }, 'contains', 'John')).toBe(true);
  });

  it('does not pass on a missing value', () => {
    expect(compare(undefined, 'contains', 'x')).toBe(false);
  });
});

describe('compare — unknown operator', () => {
  it('fails closed rather than throwing', () => {
    expect(compare(200, 'definitelyNotAnOperator', '200')).toBe(false);
  });
});
