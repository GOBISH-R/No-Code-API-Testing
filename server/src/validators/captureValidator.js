const ALLOWED_SOURCES = ['status', 'json', 'header', 'time'];

// Validates the shape of "Capture" rules from the Request Builder's Capture tab.
export function validateCaptures(captures) {
  if (captures === undefined) return [];
  if (!Array.isArray(captures)) return ['captures must be an array.'];

  const errors = [];

  captures.forEach((capture, index) => {
    const prefix = `captures[${index}]`;

    if (!capture || typeof capture !== 'object') {
      errors.push(`${prefix} must be an object.`);
      return;
    }

    const { source, path, headerName, variableName } = capture;

    if (!ALLOWED_SOURCES.includes(source)) {
      errors.push(`${prefix}.source must be one of: ${ALLOWED_SOURCES.join(', ')}.`);
    }

    if (typeof variableName !== 'string' || !variableName.trim()) {
      errors.push(`${prefix}.variableName is required.`);
    }

    if (source === 'json' && (typeof path !== 'string' || !path.trim())) {
      errors.push(`${prefix}.path is required for source "json".`);
    }

    if (source === 'header' && (typeof headerName !== 'string' || !headerName.trim())) {
      errors.push(`${prefix}.headerName is required for source "header".`);
    }
  });

  return errors;
}
