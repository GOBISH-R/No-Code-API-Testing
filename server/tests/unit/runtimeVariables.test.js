import { describe, it, expect } from 'vitest';
import { validateRuntimeVariables, RUNTIME_VARIABLE_LIMITS } from '../../src/validators/requestValidator.js';

describe('validateRuntimeVariables', () => {
  it('accepts nothing, or a map of names to strings', () => {
    expect(validateRuntimeVariables(undefined)).toEqual([]);
    expect(validateRuntimeVariables(null)).toEqual([]);
    expect(validateRuntimeVariables({ token: 'abc', userId: '42' })).toEqual([]);
  });

  it('refuses a string or an array, which would spread into one variable per character or index', () => {
    expect(validateRuntimeVariables('abc')).toHaveLength(1);
    expect(validateRuntimeVariables(['a', 'b'])).toHaveLength(1);
  });

  it('refuses values that are not strings', () => {
    expect(validateRuntimeVariables({ n: 1 })).toHaveLength(1);
    expect(validateRuntimeVariables({ o: { nested: true } })).toHaveLength(1);
  });

  it('caps how many variables, and how big, one request may send', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: RUNTIME_VARIABLE_LIMITS.MAX_COUNT + 1 }, (_, i) => [`v${i}`, 'x']),
    );
    expect(validateRuntimeVariables(tooMany)).toHaveLength(1);
    expect(validateRuntimeVariables({ big: 'x'.repeat(RUNTIME_VARIABLE_LIMITS.MAX_VALUE + 1) })).toHaveLength(1);
    expect(validateRuntimeVariables({ ['n'.repeat(RUNTIME_VARIABLE_LIMITS.MAX_NAME + 1)]: 'x' })).toHaveLength(1);
  });
});
