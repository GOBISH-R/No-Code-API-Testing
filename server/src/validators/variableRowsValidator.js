// Shared shape check for { key, value, enabled } variable rows — used by anything that
// stores a flat variable list (environments, globals).
export function isValidVariableRows(rows) {
  return (
    Array.isArray(rows) &&
    rows.every(
      (row) =>
        row &&
        typeof row.key === 'string' &&
        typeof row.value === 'string' &&
        typeof row.enabled === 'boolean',
    )
  );
}
