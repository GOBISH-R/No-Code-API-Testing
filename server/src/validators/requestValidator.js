import { validateWsAssertions, validateWaitCondition } from './wsAssertionValidator.js';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const ALLOWED_BODY_MODES = ['none', 'json', 'urlencoded', 'text', 'formdata'];

/** Bounds for multipart bodies: fields per request, and file bytes per send. */
export const FORM_LIMITS = {
  MAX_FIELDS: 50,
  MAX_FILE_BYTES: 5 * 1024 * 1024,
  MAX_FILE_NAME: 255,
};

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function validateFormRows(rows) {
  if (!Array.isArray(rows)) return ['body.form must be an array of fields.'];
  if (rows.length > FORM_LIMITS.MAX_FIELDS) return [`A form can have up to ${FORM_LIMITS.MAX_FIELDS} fields.`];

  const errors = [];
  let fileBytes = 0;
  rows.forEach((row, i) => {
    const where = `body.form[${i}]`;
    if (!row || typeof row !== 'object' || typeof row.key !== 'string' || typeof row.enabled !== 'boolean') {
      errors.push(`${where} must be { key, enabled, type, … }.`);
      return;
    }
    const type = row.type ?? 'text';
    if (type === 'text') {
      if (typeof row.value !== 'string') errors.push(`${where}.value must be a string.`);
    } else if (type === 'file') {
      if (row.fileName !== undefined && (typeof row.fileName !== 'string' || row.fileName.length > FORM_LIMITS.MAX_FILE_NAME)) {
        errors.push(`${where}.fileName must be at most ${FORM_LIMITS.MAX_FILE_NAME} characters.`);
      }
      if (row.fileType !== undefined && (typeof row.fileType !== 'string' || row.fileType.length > 100)) {
        errors.push(`${where}.fileType must be a short MIME type.`);
      }
      if (row.data !== undefined) {
        if (typeof row.data !== 'string' || !BASE64.test(row.data)) {
          errors.push(`${where}.data must be the file's contents in base64.`);
        } else {
          fileBytes += Math.floor((row.data.length * 3) / 4);
        }
      }
    } else {
      errors.push(`${where}.type must be text or file.`);
    }
  });
  if (fileBytes > FORM_LIMITS.MAX_FILE_BYTES) {
    errors.push(`Files in one request can add up to ${FORM_LIMITS.MAX_FILE_BYTES / (1024 * 1024)} MB.`);
  }
  return errors;
}
const ALLOWED_AUTH_TYPES = ['none', 'basic', 'bearer', 'apiKey', 'oauth2'];
const ALLOWED_API_KEY_LOCATIONS = ['header', 'query'];
const ALLOWED_OAUTH2_GRANT_TYPES = ['clientCredentials', 'authorizationCode'];
const ALLOWED_PROTOCOLS = ['rest', 'graphql', 'websocket'];

// A {{placeholder}} is substituted immediately before the request runs, so a JSON
// string containing one cannot be valid JSON *yet*. Parsing it here would reject a
// request that resolves to perfectly valid JSON — e.g. {"id": {{userId}}}. The parse
// that matters happens after substitution (see executionEngine.buildGraphQLData),
// where a substitution that genuinely breaks the JSON still fails with a clear error.
const PLACEHOLDER_PATTERN = /\{\{\s*[\w.-]+\s*\}\}/;

function isJsonCheckable(text) {
  return Boolean(text) && text.trim() !== '' && !PLACEHOLDER_PATTERN.test(text);
}

// Kept here rather than in wsAssertionValidator so the whole request configuration is
// validated in one pass, the same way GraphQL is.
function validateWebSocketConfig(websocket) {
  if (websocket === undefined || websocket === null) return [];
  if (typeof websocket !== 'object') return ['websocket must be an object.'];

  const errors = [];

  if (websocket.subprotocols !== undefined && typeof websocket.subprotocols !== 'string') {
    errors.push('websocket.subprotocols must be a comma-separated string.');
  }

  const subscription = websocket.graphql;
  if (subscription?.enabled) {
    if (typeof subscription.query !== 'string' || !subscription.query.trim()) {
      errors.push('websocket.graphql.query is required when a GraphQL subscription is enabled.');
    }
    if (
      subscription.variables !== undefined &&
      subscription.variables !== '' &&
      typeof subscription.variables !== 'string'
    ) {
      errors.push('websocket.graphql.variables must be a string of JSON.');
    }
  }

  if (websocket.steps !== undefined) {
    if (!Array.isArray(websocket.steps)) {
      errors.push('websocket.steps must be an array.');
    } else {
      websocket.steps.forEach((step, index) => {
        if (!step || typeof step !== 'object') {
          errors.push(`websocket.steps[${index}] must be an object.`);
          return;
        }
        if (step.send !== undefined && typeof step.send !== 'string') {
          errors.push(`websocket.steps[${index}].send must be a string.`);
        }
        errors.push(...validateWaitCondition(step.waitFor).map((e) => `websocket.steps[${index}]: ${e}`));
        errors.push(...validateWsAssertions(step.assertions).map((e) => `websocket.steps[${index}]: ${e}`));
      });
    }
  }

  return errors;
}

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

// Validates the shape of the request configuration coming from the Request Builder.
// Returns a list of human-readable error strings; empty list means valid.
export function validateRequestConfig(payload) {
  if (!payload || typeof payload !== 'object') {
    return ['A request configuration is required.'];
  }

  const errors = [];
  const { protocol = 'rest', method, url, params, headers, body, auth, graphql } = payload;

  if (!ALLOWED_PROTOCOLS.includes(protocol)) {
    errors.push(`protocol must be one of: ${ALLOWED_PROTOCOLS.join(', ')}.`);
  }

  // A WebSocket connection has no HTTP method; requiring one would make every
  // WebSocket request unsaveable.
  if (protocol !== 'websocket' && !ALLOWED_METHODS.includes(method)) {
    errors.push(`method must be one of: ${ALLOWED_METHODS.join(', ')}.`);
  }

  if (typeof url !== 'string' || !url.trim()) {
    errors.push('url is required.');
  }

  if (protocol === 'graphql') {
    if (!graphql || typeof graphql !== 'object' || typeof graphql.query !== 'string' || !graphql.query.trim()) {
      errors.push('graphql.query is required.');
    }
    if (graphql !== undefined && graphql !== null) {
      if (graphql.variables !== undefined && graphql.variables !== '') {
        if (typeof graphql.variables !== 'string') {
          errors.push('graphql.variables must be a string of JSON.');
        } else if (isJsonCheckable(graphql.variables)) {
          try {
            JSON.parse(graphql.variables);
          } catch {
            errors.push('graphql.variables must be valid JSON.');
          }
        }
      }
      if (graphql.operationName !== undefined && typeof graphql.operationName !== 'string') {
        errors.push('graphql.operationName must be a string.');
      }
    }
  }

  if (protocol === 'websocket') {
    errors.push(...validateWebSocketConfig(payload.websocket));
  }

  if (params !== undefined && !isValidRowArray(params)) {
    errors.push('params must be an array of { key, value, enabled } rows.');
  }

  if (headers !== undefined && !isValidRowArray(headers)) {
    errors.push('headers must be an array of { key, value, enabled } rows.');
  }

  if (body !== undefined) {
    if (typeof body !== 'object' || body === null || !ALLOWED_BODY_MODES.includes(body.mode)) {
      errors.push(`body.mode must be one of: ${ALLOWED_BODY_MODES.join(', ')}.`);
    } else if (body.mode === 'json' && isJsonCheckable(body.raw)) {
      try {
        JSON.parse(body.raw);
      } catch {
        errors.push('body.raw must be valid JSON.');
      }
    } else if (body.mode === 'urlencoded' && body.rows !== undefined && !isValidRowArray(body.rows)) {
      errors.push('body.rows must be an array of { key, value, enabled } rows.');
    } else if (body.mode === 'text' && body.raw !== undefined && typeof body.raw !== 'string') {
      errors.push('body.raw must be a string.');
    } else if (body.mode === 'formdata' && body.form !== undefined) {
      errors.push(...validateFormRows(body.form));
    }
  }

  if (auth !== undefined) {
    if (typeof auth !== 'object' || auth === null || !ALLOWED_AUTH_TYPES.includes(auth.type)) {
      errors.push(`auth.type must be one of: ${ALLOWED_AUTH_TYPES.join(', ')}.`);
    } else if (auth.type === 'apiKey' && auth.apiKey?.addTo !== undefined) {
      if (!ALLOWED_API_KEY_LOCATIONS.includes(auth.apiKey.addTo)) {
        errors.push(`auth.apiKey.addTo must be one of: ${ALLOWED_API_KEY_LOCATIONS.join(', ')}.`);
      }
    } else if (auth.type === 'oauth2' && auth.oauth2?.grantType !== undefined) {
      if (!ALLOWED_OAUTH2_GRANT_TYPES.includes(auth.oauth2.grantType)) {
        errors.push(`auth.oauth2.grantType must be one of: ${ALLOWED_OAUTH2_GRANT_TYPES.join(', ')}.`);
      }
    }
  }

  return errors;
}

// Generous for any real request chain, and small enough that one request cannot make
// the server resolve against megabytes of browser-supplied variables.
export const RUNTIME_VARIABLE_LIMITS = { MAX_COUNT: 500, MAX_NAME: 200, MAX_VALUE: 100_000 };

// Validates the optional runtimeVariables map sent alongside a request, an
// introspection or a WebSocket message — the browser-side context accumulated from
// earlier captures in a manual request chain.
export function validateRuntimeVariables(payload) {
  if (payload === undefined || payload === null) return [];

  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return ['runtimeVariables must be an object of variable name to value.'];
  }

  const entries = Object.entries(payload);
  const { MAX_COUNT, MAX_NAME, MAX_VALUE } = RUNTIME_VARIABLE_LIMITS;
  if (entries.length > MAX_COUNT) return [`runtimeVariables may hold at most ${MAX_COUNT} variables.`];
  if (!entries.every(([, value]) => typeof value === 'string')) {
    return ['runtimeVariables values must all be strings.'];
  }
  if (entries.some(([key, value]) => key.length > MAX_NAME || value.length > MAX_VALUE)) {
    return [`runtimeVariables names must be under ${MAX_NAME} characters and values under ${MAX_VALUE}.`];
  }
  return [];
}
