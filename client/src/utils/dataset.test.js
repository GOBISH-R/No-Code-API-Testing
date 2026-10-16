import { describe, it, expect } from 'vitest';
import { parseCsv, parseDataset, datasetColumns, LIMITS } from './dataset.js';

describe('parseCsv', () => {
  it('splits a simple table', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps commas inside quoted fields', () => {
    // The failure a naive split(',') produces, and the reason this parser exists.
    expect(parseCsv('name,note\n"Doe, Jane",hi')).toEqual([
      ['name', 'note'],
      ['Doe, Jane', 'hi'],
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('q\n"she said ""no"""')).toEqual([['q'], ['she said "no"']]);
  });

  it('keeps newlines inside quoted fields', () => {
    expect(parseCsv('a\n"line1\nline2"')).toEqual([['a'], ['line1\nline2']]);
  });

  it('handles CRLF endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('strips a UTF-8 BOM', () => {
    // Excel writes one; without this the first column name is invisibly corrupted.
    expect(parseCsv('﻿id\n1')).toEqual([['id'], ['1']]);
  });

  it('skips blank lines', () => {
    expect(parseCsv('a\n\n1\n')).toEqual([['a'], ['1']]);
  });

  it('preserves empty fields', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([['a', 'b', 'c'], ['1', '', '3']]);
  });
});

describe('parseDataset — CSV', () => {
  it('maps a header row onto values', () => {
    const { rows, format, errors } = parseDataset('id,name\n1,Ada\n2,Grace', 'users.csv');
    expect(format).toBe('csv');
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { id: '1', name: 'Ada' },
      { id: '2', name: 'Grace' },
    ]);
  });

  it('fills missing trailing columns with empty strings', () => {
    const { rows } = parseDataset('id,name\n1', 'x.csv');
    expect(rows).toEqual([{ id: '1', name: '' }]);
  });

  it('reports a file with a header but no rows', () => {
    const { rows, errors } = parseDataset('id,name', 'x.csv');
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/no values/i);
  });

  it('reports an empty file', () => {
    expect(parseDataset('', 'x.csv').errors[0]).toMatch(/empty/i);
  });

  it('ignores a duplicate column rather than letting it overwrite', () => {
    const { rows, errors } = parseDataset('id,id\n1,2', 'x.csv');
    expect(rows).toEqual([{ id: '1' }]);
    expect(errors[0]).toMatch(/duplicate/i);
  });
});

describe('parseDataset — JSON', () => {
  it('reads an array of objects', () => {
    const { rows, format } = parseDataset('[{"id":1},{"id":2}]', 'users.json');
    expect(format).toBe('json');
    expect(rows).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('detects JSON from the content when the name does not say so', () => {
    expect(parseDataset('[{"id":1}]', 'data.txt').format).toBe('json');
  });

  it('serialises a nested value instead of dropping it', () => {
    // A column holding a request body is a real use case.
    const { rows } = parseDataset('[{"body":{"a":1}}]', 'x.json');
    expect(rows).toEqual([{ body: '{"a":1}' }]);
  });

  it('turns null into an empty string', () => {
    expect(parseDataset('[{"a":null}]', 'x.json').rows).toEqual([{ a: '' }]);
  });

  it('rejects a bare object', () => {
    expect(parseDataset('{"id":1}', 'x.json').errors[0]).toMatch(/array of objects/i);
  });

  it('rejects an entry that is not an object', () => {
    expect(parseDataset('[1,2]', 'x.json').errors[0]).toMatch(/not an object/i);
  });

  it('reports invalid JSON with its reason', () => {
    expect(parseDataset('[{', 'x.json').errors[0]).toMatch(/not valid JSON/i);
  });
});

describe('parseDataset — limits and safety', () => {
  it('refuses a file with more rows than the run budget can serve', () => {
    const csv = ['id', ...Array.from({ length: LIMITS.MAX_ROWS + 1 }, (_, i) => String(i))].join('\n');
    const { rows, errors } = parseDataset(csv, 'big.csv');
    expect(rows).toEqual([]);
    expect(errors.some((e) => /limit is/.test(e))).toBe(true);
  });

  it('drops a column that would reach the Object prototype', () => {
    // Rows are spread into the variable map, so these names must never survive.
    const { rows, errors } = parseDataset('__proto__,id\nx,1', 'x.csv');
    expect(rows).toEqual([{ id: '1' }]);
    expect(errors[0]).toMatch(/reserved/i);
    expect({}.polluted).toBeUndefined();
  });

  it('refuses an oversized cell', () => {
    const big = 'a'.repeat(LIMITS.MAX_CELL_LENGTH + 1);
    const { rows, errors } = parseDataset(`v\n${big}`, 'x.csv');
    expect(rows).toEqual([]);
    expect(errors.some((e) => /exceeds/.test(e))).toBe(true);
  });
});

describe('datasetColumns', () => {
  it('collects every column in first-seen order', () => {
    expect(datasetColumns([{ a: '1' }, { b: '2' }, { a: '3' }])).toEqual(['a', 'b']);
  });

  it('is empty for no rows', () => {
    expect(datasetColumns([])).toEqual([]);
  });
});
