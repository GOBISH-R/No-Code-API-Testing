/**
 * Turning a CSV or JSON file into rows of variables for a data-driven run.
 *
 * Parsing happens in the browser so the user sees a preview of exactly what will run
 * before anything is sent, and so the backend never has to accept a file upload. The
 * server re-validates the rows it receives regardless — this is a convenience, not a
 * trust boundary.
 */

// A run is sequential and shares one 5-minute budget, so a large file would mostly
// produce iterations that never execute. Better to refuse it than to truncate silently.
export const LIMITS = {
  MAX_ROWS: 100,
  MAX_COLUMNS: 50,
  MAX_CELL_LENGTH: 10_000,
  MAX_FILE_BYTES: 1024 * 1024,
};

// Assigning these would reach the Object prototype rather than the variable map.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Splits CSV text into records of raw fields.
 *
 * Hand-written rather than split(',') because quoted fields containing commas, escaped
 * quotes and newlines are exactly what a realistic test dataset contains — a naive
 * split corrupts them silently, which is the worst possible failure for test input.
 */
export function parseCsv(text) {
  const clean = String(text).replace(/^﻿/, '');
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  let sawField = false;

  const endField = () => {
    record.push(field);
    field = '';
    sawField = true;
  };

  const endRecord = () => {
    endField();
    // A trailing newline, or a blank line between records, is not a row of data.
    if (record.length > 1 || record[0] !== '') records.push(record);
    record = [];
    sawField = false;
  };

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];

    if (inQuotes) {
      if (char === '"') {
        // "" inside a quoted field is a literal quote, not the end of the field.
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      endField();
      continue;
    }
    if (char === '\n') {
      endRecord();
      continue;
    }
    // Part of CRLF; a lone CR is treated the same way rather than joining two rows.
    if (char === '\r') {
      if (clean[i + 1] === '\n') i += 1;
      endRecord();
      continue;
    }
    field += char;
  }

  if (field !== '' || sawField || record.length > 0) endRecord();

  return records;
}

// Variables substitute into text, so every value becomes a string. Objects and arrays
// are serialised rather than rejected: a column holding a JSON body is a real use case.
function toVariableValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function checkRowShape(row, index, errors) {
  const keys = Object.keys(row);
  if (keys.length > LIMITS.MAX_COLUMNS) {
    errors.push(`Row ${index + 1} has ${keys.length} columns (limit ${LIMITS.MAX_COLUMNS}).`);
    return false;
  }
  for (const key of keys) {
    if (row[key].length > LIMITS.MAX_CELL_LENGTH) {
      errors.push(`Row ${index + 1}, column "${key}" exceeds ${LIMITS.MAX_CELL_LENGTH} characters.`);
      return false;
    }
  }
  return true;
}

/**
 * Filters a header row down to usable variable names.
 *
 * Each kept name carries the column it came from: a dropped column must not shift the
 * ones after it, or the remaining headers silently read their neighbour's values.
 */
function normalizeKeys(rawKeys, errors) {
  const keys = [];
  const seen = new Set();

  rawKeys.forEach((raw, index) => {
    const key = String(raw).trim();
    if (!key) return;
    if (UNSAFE_KEYS.has(key)) {
      errors.push(`Column "${key}" is a reserved name and was ignored.`);
      return;
    }
    if (seen.has(key)) {
      errors.push(`Duplicate column "${key}" — only the first is used.`);
      return;
    }
    seen.add(key);
    keys.push({ key, index });
  });

  return keys;
}

function fromCsv(text, errors) {
  const records = parseCsv(text);
  if (records.length === 0) {
    errors.push('The file is empty.');
    return [];
  }

  const headers = normalizeKeys(records[0], errors);
  if (headers.length === 0) {
    errors.push('The first row must name the variables (a header row).');
    return [];
  }

  const rows = [];
  for (const record of records.slice(1)) {
    const row = {};
    for (const { key, index } of headers) row[key] = toVariableValue(record[index]);
    rows.push(row);
  }
  return rows;
}

function fromJson(text, errors) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    errors.push(`That is not valid JSON: ${err.message}`);
    return [];
  }

  if (!Array.isArray(parsed)) {
    errors.push('A JSON dataset must be an array of objects, one per iteration.');
    return [];
  }

  const rows = [];
  for (const [index, entry] of parsed.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`Entry ${index + 1} is not an object.`);
      return [];
    }

    const row = {};
    for (const { key } of normalizeKeys(Object.keys(entry), errors)) {
      row[key] = toVariableValue(entry[key]);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Parses file text into iteration rows.
 *
 * Returns errors rather than throwing: a dataset can be partly wrong in several ways at
 * once, and showing all of them beats fixing one problem per attempt.
 */
export function parseDataset(text, filename = '') {
  const errors = [];
  const source = String(text ?? '');

  if (source.length > LIMITS.MAX_FILE_BYTES) {
    return { rows: [], errors: [`The file is larger than ${LIMITS.MAX_FILE_BYTES / 1024}KB.`], format: null };
  }

  const looksJson = /\.json$/i.test(filename) || source.trim().startsWith('[');
  const format = looksJson ? 'json' : 'csv';
  const rows = looksJson ? fromJson(source, errors) : fromCsv(source, errors);

  if (rows.length > LIMITS.MAX_ROWS) {
    errors.push(`${rows.length} rows found; the limit is ${LIMITS.MAX_ROWS}.`);
    return { rows: [], errors, format };
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push('No data rows found — the file has a header but no values.');
  }

  const valid = rows.every((row, index) => checkRowShape(row, index, errors));

  return { rows: valid ? rows : [], errors, format };
}

// The column names a dataset provides, for showing which variables a run will supply.
export function datasetColumns(rows) {
  const columns = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return columns;
}
