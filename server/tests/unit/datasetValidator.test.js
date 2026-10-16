import { describe, it, expect } from 'vitest';
import { validateDataset, describeRow, DATASET_LIMITS } from '../../src/validators/datasetValidator.js';
import { ValidationError } from '../../src/utils/errors.js';

describe('validateDataset', () => {
  it('treats no dataset as an ordinary run', () => {
    expect(validateDataset(undefined)).toBeNull();
    expect(validateDataset(null)).toBeNull();
    expect(validateDataset([])).toBeNull();
  });

  it('normalizes every value to a string', () => {
    // Variables substitute into text, so a number column must not arrive as a number.
    expect(validateDataset([{ id: 1, active: true, note: null }])).toEqual([
      { id: '1', active: 'true', note: '' },
    ]);
  });

  it('trims column names', () => {
    expect(validateDataset([{ '  id  ': 'x' }])).toEqual([{ id: 'x' }]);
  });

  it('rejects a non-array', () => {
    expect(() => validateDataset({ id: 1 })).toThrow(ValidationError);
  });

  it('rejects a row that is not an object', () => {
    expect(() => validateDataset([1])).toThrow(/row 1 must be an object/i);
    expect(() => validateDataset([['a']])).toThrow(/row 1 must be an object/i);
  });

  it('names the offending row', () => {
    expect(() => validateDataset([{ a: '1' }, { a: '2' }, 'nope'])).toThrow(/row 3/);
  });

  it('rejects more rows than a run can serve', () => {
    const rows = Array.from({ length: DATASET_LIMITS.MAX_ROWS + 1 }, (_, i) => ({ i: String(i) }));
    expect(() => validateDataset(rows)).toThrow(/at most 100 rows/i);
  });

  it('rejects too many columns', () => {
    const row = {};
    for (let i = 0; i <= DATASET_LIMITS.MAX_COLUMNS; i += 1) row[`c${i}`] = 'v';
    expect(() => validateDataset([row])).toThrow(/limit is 50/i);
  });

  it('rejects an oversized cell', () => {
    const row = { big: 'a'.repeat(DATASET_LIMITS.MAX_CELL_LENGTH + 1) };
    expect(() => validateDataset([row])).toThrow(/exceeds/i);
  });

  it('rejects a nested value rather than stringifying it silently', () => {
    // The client serialises these before sending; a raw object here means something
    // else built the request, and guessing at an encoding would be worse than refusing.
    expect(() => validateDataset([{ body: { a: 1 } }])).toThrow(/must be a scalar/i);
  });

  it('drops keys that would reach the Object prototype', () => {
    const [row] = validateDataset([{ __proto__: 'x', id: '1' }]);
    expect(row.id).toBe('1');
    expect({}.x).toBeUndefined();
  });

  it('returns rows with no prototype, so a later lookup cannot hit Object.prototype', () => {
    const [row] = validateDataset([{ id: '1' }]);
    expect(Object.getPrototypeOf(row)).toBeNull();
    // Without this, a request referencing {{toString}} would resolve to a function.
    expect(row.toString).toBeUndefined();
  });
});

describe('describeRow', () => {
  it('labels a row by its first column', () => {
    expect(describeRow({ email: 'ada@example.com' }, 0)).toBe('email=ada@example.com');
  });

  it('falls back to the position when there is nothing to show', () => {
    expect(describeRow({}, 2)).toBe('Iteration 3');
    expect(describeRow(null, 0)).toBe('Iteration 1');
    expect(describeRow({ a: '' }, 1)).toBe('Iteration 2');
  });

  it('truncates a long value', () => {
    const label = describeRow({ token: 'x'.repeat(100) }, 0);
    expect(label.length).toBeLessThan(50);
    expect(label).toMatch(/…$/);
  });
});
