import { getIntrospectionQuery, buildClientSchema } from 'graphql';
import { executeRequest } from '../execution/executionEngine.js';
import { resolveRequestConfig } from '../variables/variableResolver.js';
import { cacheSchema, schemaSizeOf, MAX_SCHEMA_BYTES } from './schemaService.js';
import { ValidationError } from '../../utils/errors.js';

// Conservative options: older GraphQL servers reject an introspection query that asks
// for fields their implementation predates, so we request only the widely-supported
// set. Descriptions are kept because the schema viewer and docs explorer need them.
const INTROSPECTION_QUERY = getIntrospectionQuery({
  descriptions: true,
  specifiedByUrl: false,
  directiveIsRepeatable: false,
  schemaDescription: false,
  inputValueDeprecation: false,
});

function introspectionRequestConfig({ url, headers, auth }) {
  return {
    protocol: 'graphql',
    method: 'POST',
    url,
    params: [],
    headers: headers || [],
    body: { mode: 'none', raw: '', rows: [] },
    auth: auth || { type: 'none' },
    graphql: { query: INTROSPECTION_QUERY, variables: '', operationName: '' },
  };
}

/**
 * Turns a completed execution result into either a schema or a clear, actionable
 * error. Pure and network-free, so every failure mode is unit-testable.
 */
export function interpretIntrospectionResponse(result) {
  if (!result.success) {
    // Timeout / DNS / connection failures are already classified by requestExecutor.
    throw new ValidationError(result.error?.message || 'The introspection request failed.');
  }

  const { status, body } = result.response;

  if (status === 401 || status === 403) {
    throw new ValidationError(
      `The endpoint rejected the introspection request with ${status}. Check the Auth tab — introspection uses the same credentials as the request.`,
    );
  }

  if (status < 200 || status >= 300) {
    throw new ValidationError(`Introspection failed with HTTP ${status}.`);
  }

  if (typeof body === 'string' || body === null || typeof body !== 'object') {
    throw new ValidationError(
      'The endpoint did not return JSON. Check that the URL is a GraphQL endpoint.',
    );
  }

  // A GraphQL server that disables introspection answers with HTTP 200 and an errors
  // array — the single most common real-world failure, so it gets its own message.
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const detail = body.errors[0]?.message || 'Unknown GraphQL error.';
    throw new ValidationError(
      `The endpoint refused introspection: ${detail} Many production servers disable introspection deliberately.`,
    );
  }

  const introspection = body.data;
  if (!introspection?.__schema) {
    throw new ValidationError(
      'The response contained no __schema. Check that the URL is a GraphQL endpoint.',
    );
  }

  // buildClientSchema is the real correctness check: it throws on a structurally
  // invalid schema that merely looks right at the JSON level.
  try {
    buildClientSchema(introspection);
  } catch (err) {
    throw new ValidationError(`The endpoint returned a schema that could not be parsed: ${err.message}`);
  }

  const size = schemaSizeOf(introspection);
  if (size > MAX_SCHEMA_BYTES) {
    throw new ValidationError(
      `The schema is ${Math.round(size / 1024 / 1024)}MB, larger than the ${MAX_SCHEMA_BYTES / 1024 / 1024}MB limit.`,
    );
  }

  return introspection;
}

/**
 * Loads a GraphQL schema by running a standard introspection query against the
 * endpoint.
 *
 * Deliberately built on executeRequest rather than its own HTTP client: introspection
 * *is* an authenticated GraphQL POST, so this inherits SSRF validation, every auth
 * type (including the OAuth token fetch), {{variable}} resolution, the request
 * timeout and the response size cap without duplicating any of it.
 */
export async function loadSchema(ownerId, { url, headers, auth }, variables = {}) {
  if (!url?.trim()) throw new ValidationError('A GraphQL endpoint URL is required.');

  const config = introspectionRequestConfig({ url, headers, auth });
  const result = await executeRequest(config, variables);
  const introspection = interpretIntrospectionResponse(result);

  // Resolution already succeeded inside executeRequest; repeating it here is pure and
  // is how the cache key becomes the *resolved* endpoint rather than the template.
  const { config: resolved } = resolveRequestConfig(config, variables);
  const endpoint = resolved.url;

  await cacheSchema(ownerId, endpoint, introspection);

  return { endpoint, schema: introspection, fetchedAt: new Date() };
}
