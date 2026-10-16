import { load as loadYaml } from 'js-yaml';
import { ValidationError } from '../../utils/errors.js';

// OpenAPI/Swagger specs are distributed as either JSON or YAML — and JSON is valid
// YAML, so a single safe (js-yaml's default schema, no custom tags) parse handles
// both without needing to guess the format first.
export function parseSpecText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new ValidationError('An OpenAPI/Swagger document is required.');
  }

  let spec;
  try {
    spec = loadYaml(text);
  } catch (err) {
    throw new ValidationError(`Could not parse the file as JSON or YAML: ${err.message}`);
  }

  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new ValidationError('The file does not contain a valid OpenAPI/Swagger document.');
  }

  return spec;
}

export function detectVersion(spec) {
  if (typeof spec.openapi === 'string' && spec.openapi.startsWith('3.')) return 'openapi3';
  if (spec.swagger === '2.0') return 'swagger2';
  return null;
}
