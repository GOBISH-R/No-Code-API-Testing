export function validateCollection(payload) {
  if (!payload || typeof payload !== 'object') return ['A collection is required.'];

  const errors = [];
  if (typeof payload.name !== 'string' || !payload.name.trim()) {
    errors.push('name is required.');
  }

  return errors;
}
