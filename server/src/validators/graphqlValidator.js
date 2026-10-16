const ALLOWED_AUTH_TYPES = ['none', 'basic', 'bearer', 'apiKey', 'oauth2'];

function isValidRowArray(rows) {
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

// Shape-check for an introspection request. Deliberately narrow: the URL itself is
// validated by the SSRF guard during execution, not here, so this must not try to
// second-guess it.
export function validateIntrospectionRequest(payload) {
  if (!payload || typeof payload !== 'object') return ['An introspection request is required.'];

  const errors = [];
  const { url, headers, auth, runtimeVariables } = payload;

  if (typeof url !== 'string' || !url.trim()) {
    errors.push('url is required.');
  }

  if (headers !== undefined && !isValidRowArray(headers)) {
    errors.push('headers must be an array of { key, value, enabled } rows.');
  }

  if (auth !== undefined) {
    if (typeof auth !== 'object' || auth === null || !ALLOWED_AUTH_TYPES.includes(auth.type)) {
      errors.push(`auth.type must be one of: ${ALLOWED_AUTH_TYPES.join(', ')}.`);
    }
  }

  if (runtimeVariables !== undefined) {
    if (typeof runtimeVariables !== 'object' || runtimeVariables === null || Array.isArray(runtimeVariables)) {
      errors.push('runtimeVariables must be an object of variable name to value.');
    }
  }

  return errors;
}
