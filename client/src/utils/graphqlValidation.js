import { parse, validate, buildClientSchema } from 'graphql';

// Matches the app's {{variable}} syntax, which the *backend* resolves immediately
// before sending. That ordering matters here: the query text in the editor may still
// contain placeholders that are not valid GraphQL, so validating it as-is would
// report a syntax error for a request that is actually fine.
const VARIABLE_PATTERN = /\{\{\s*[\w.-]+\s*\}\}/;

/**
 * Builds an executable schema object from a raw introspection payload.
 * Returns null rather than throwing — a schema we cannot build simply means
 * validation is unavailable, never a blocked request.
 */
export function buildSchemaFromIntrospection(introspection) {
  if (!introspection) return null;
  try {
    const schema = buildClientSchema(introspection);
    // buildClientSchema tolerates some degenerate payloads — notably one with no
    // types at all — and returns a schema with no Query root. Validating against
    // that would reject every query, so treat it as "validation unavailable".
    return schema.getQueryType() ? schema : null;
  } catch {
    return null;
  }
}

function formatError(error) {
  const location = error.locations?.[0];
  return {
    message: error.message,
    line: location?.line ?? null,
    column: location?.column ?? null,
  };
}

/**
 * Validates a GraphQL document against a loaded schema.
 *
 * Deliberately conservative: every condition under which validation cannot be
 * trusted returns `skipped` instead of errors, because a false positive here would
 * block a request the server would have accepted. Validation is an extra safety net
 * in front of the server's own validation, never a replacement for it.
 */
export function validateGraphQLQuery({
  schema,
  query,
  operationName,
  url,
  schemaUrl,
  environmentId,
  schemaEnvironmentId,
}) {
  const text = (query || '').trim();

  if (!text) return { skipped: true, reason: 'empty', errors: [] };
  if (!schema) return { skipped: true, reason: 'no-schema', errors: [] };

  // A schema describes exactly one endpoint. Once the request points somewhere else,
  // validating against the old schema would reject queries that are perfectly valid
  // for the new target — the worst possible failure mode for this feature. The
  // environment counts too: {{baseUrl}}/graphql is the same text but a different
  // server once the environment changes.
  const urlChanged = url !== undefined && schemaUrl !== undefined && url.trim() !== schemaUrl.trim();
  const envChanged =
    environmentId !== undefined &&
    schemaEnvironmentId !== undefined &&
    (environmentId ?? null) !== (schemaEnvironmentId ?? null);

  if (urlChanged || envChanged) {
    return { skipped: true, reason: 'endpoint-changed', errors: [] };
  }

  // Placeholders are substituted server-side, so what is in the editor is not yet
  // the document that will be sent.
  if (VARIABLE_PATTERN.test(text)) {
    return { skipped: true, reason: 'unresolved-variables', errors: [] };
  }

  let document;
  try {
    document = parse(text);
  } catch (err) {
    return { skipped: false, reason: 'syntax', errors: [formatError(err)] };
  }

  // Covers unknown fields, unknown/invalid arguments, missing required arguments,
  // invalid variable definitions and usage, and malformed selection sets.
  const errors = validate(schema, document);
  if (errors.length > 0) {
    return { skipped: false, reason: 'schema', errors: errors.map(formatError) };
  }

  // An operation name that does not exist in the document would fail at the server,
  // and graphql's validate does not check it because it is an execution concern.
  if (operationName?.trim()) {
    const names = document.definitions
      .filter((d) => d.kind === 'OperationDefinition' && d.name)
      .map((d) => d.name.value);

    if (!names.includes(operationName.trim())) {
      return {
        skipped: false,
        reason: 'operation',
        errors: [
          {
            message: names.length
              ? `Operation "${operationName.trim()}" is not defined in this document. Available: ${names.join(', ')}.`
              : `Operation "${operationName.trim()}" is not defined — this document has no named operations.`,
            line: null,
            column: null,
          },
        ],
      };
    }
  }

  return { skipped: false, reason: null, errors: [] };
}

// A short explanation of why validation did not run, for the UI to show instead of
// silently appearing to pass.
export function skipReasonLabel(reason) {
  switch (reason) {
    case 'no-schema':
      return 'Load the schema to validate this query before sending.';
    case 'unresolved-variables':
      return 'Not validated — the query contains {{variables}} resolved at send time.';
    case 'endpoint-changed':
      return 'Not validated — the loaded schema belongs to a different endpoint. Load the schema again for this URL.';
    default:
      return null;
  }
}
