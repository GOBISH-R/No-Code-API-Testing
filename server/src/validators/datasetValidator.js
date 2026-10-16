import { ValidationError } from '../utils/errors.js';

/**
 * Validates the iteration rows a data-driven run was given.
 *
 * The browser parses the file and previews it, but that is a convenience for the user,
 * not a guarantee to this process: these rows arrive as ordinary request JSON and are
 * spread into the variable map every request is resolved against, so they are checked
 * here on their own terms.
 */

// Kept in step with the client's limits; a run is sequential and shares one 5-minute
// budget, so more rows than this would mostly produce iterations that never execute.
export const DATASET_LIMITS = {
  MAX_ROWS: 100,
  MAX_COLUMNS: 50,
  MAX_CELL_LENGTH: 10_000,
};

// Assigning these would reach the Object prototype rather than the variable map.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Returns normalized rows, or throws with the first concrete problem.
 *
 * Rows are rebuilt from scratch with a null prototype rather than filtered in place, so
 * nothing from the request body survives into the variable map unexamined.
 */
export function validateDataset(dataset) {
  if (dataset === undefined || dataset === null) return null;

  if (!Array.isArray(dataset)) {
    throw new ValidationError('A dataset must be an array of rows.');
  }
  if (dataset.length === 0) return null;
  if (dataset.length > DATASET_LIMITS.MAX_ROWS) {
    throw new ValidationError(
      `A dataset may have at most ${DATASET_LIMITS.MAX_ROWS} rows; this one has ${dataset.length}.`,
    );
  }

  return dataset.map((row, index) => {
    const position = index + 1;

    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new ValidationError(`Dataset row ${position} must be an object.`);
    }

    const keys = Object.keys(row);
    if (keys.length > DATASET_LIMITS.MAX_COLUMNS) {
      throw new ValidationError(
        `Dataset row ${position} has ${keys.length} columns; the limit is ${DATASET_LIMITS.MAX_COLUMNS}.`,
      );
    }

    const clean = Object.create(null);
    for (const key of keys) {
      const name = String(key).trim();
      if (!name || UNSAFE_KEYS.has(name)) continue;

      const value = row[key];
      if (value !== null && value !== undefined && typeof value === 'object') {
        throw new ValidationError(
          `Dataset row ${position}, column "${name}" must be a scalar — serialise nested data before sending it.`,
        );
      }

      const text = value === null || value === undefined ? '' : String(value);
      if (text.length > DATASET_LIMITS.MAX_CELL_LENGTH) {
        throw new ValidationError(
          `Dataset row ${position}, column "${name}" exceeds ${DATASET_LIMITS.MAX_CELL_LENGTH} characters.`,
        );
      }
      clean[name] = text;
    }

    return clean;
  });
}

/**
 * A short human label for one iteration, used in results so a failure names the row it
 * came from rather than just its number.
 */
export function describeRow(row, index) {
  const fallback = `Iteration ${index + 1}`;
  if (!row) return fallback;

  const first = Object.keys(row)[0];
  if (!first) return fallback;

  const value = row[first];
  if (!value) return fallback;

  const trimmed = value.length > 40 ? `${value.slice(0, 40)}…` : value;
  return `${first}=${trimmed}`;
}
