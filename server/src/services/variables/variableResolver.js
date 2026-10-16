const VARIABLE_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;

// Turns an environment's variable rows into a plain lookup map.
export function toVariableMap(variables) {
  const map = {};
  for (const row of variables || []) {
    if (row?.enabled !== false && row?.key?.trim()) {
      map[row.key.trim()] = row.value ?? '';
    }
  }
  return map;
}

// Replaces every {{name}} in a string. Unknown names are recorded rather than
// substituted, so the caller can report them instead of sending a broken request.
function resolveString(input, variables, missing) {
  if (typeof input !== 'string' || !input) return input;

  return input.replace(VARIABLE_PATTERN, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(variables, name)) return variables[name];
    missing.add(name);
    return match;
  });
}

/**
 * Substitutes {{variables}} in a single free-text value.
 *
 * Exposed for callers that resolve one string rather than a whole request
 * configuration — a WebSocket message payload, for instance — so they use this exact
 * substitution logic instead of reimplementing the pattern.
 */
export function resolveTextValue(text, variables = {}) {
  const missing = new Set();
  const resolved = resolveString(text, variables, missing);
  return { text: resolved, missing: [...missing] };
}

// Disabled rows are never sent (see enabledEntries in executionEngine), so an unresolved
// {{variable}} in one must not block execution of the rest of the request.
function resolveRows(rows, variables, missing) {
  return (rows || []).map((row) => {
    if (row?.enabled === false) return row;
    return {
      ...row,
      key: resolveString(row.key, variables, missing),
      value: resolveString(row.value, variables, missing),
    };
  });
}

// Only the active auth type's fields are ever read by the execution engine (see
// buildAxiosConfig), so — same reasoning as disabled param/header rows — an
// unresolved {{variable}} sitting in an *inactive* auth type (e.g. leftover Basic
// creds after switching to Bearer) must not block execution.
function resolveAuth(auth, variables, missing) {
  if (!auth) return auth;

  const resolved = { ...auth };

  switch (auth.type) {
    case 'basic':
      resolved.basic = {
        username: resolveString(auth.basic?.username, variables, missing),
        password: resolveString(auth.basic?.password, variables, missing),
      };
      break;
    case 'bearer':
      resolved.bearer = { token: resolveString(auth.bearer?.token, variables, missing) };
      break;
    case 'apiKey':
      resolved.apiKey = {
        key: resolveString(auth.apiKey?.key, variables, missing),
        value: resolveString(auth.apiKey?.value, variables, missing),
        addTo: auth.apiKey?.addTo,
      };
      break;
    case 'oauth2':
      resolved.oauth2 = {
        // grantType/expiresAt aren't strings — pass them through as-is.
        grantType: auth.oauth2?.grantType,
        expiresAt: auth.oauth2?.expiresAt,
        tokenUrl: resolveString(auth.oauth2?.tokenUrl, variables, missing),
        clientId: resolveString(auth.oauth2?.clientId, variables, missing),
        clientSecret: resolveString(auth.oauth2?.clientSecret, variables, missing),
        scope: resolveString(auth.oauth2?.scope, variables, missing),
        authUrl: resolveString(auth.oauth2?.authUrl, variables, missing),
        redirectUri: resolveString(auth.oauth2?.redirectUri, variables, missing),
        accessToken: resolveString(auth.oauth2?.accessToken, variables, missing),
        refreshToken: resolveString(auth.oauth2?.refreshToken, variables, missing),
      };
      break;
    default:
      break;
  }

  return resolved;
}

// Each body mode is backed by a different field — `rows` for urlencoded, `raw` for
// json/text — and only the active one is ever sent, so resolving the others would
// let a stale placeholder in an inactive mode block an otherwise-valid request.
function resolveBody(body, variables, missing) {
  switch (body.mode) {
    case 'urlencoded':
      return { ...body, rows: resolveRows(body.rows, variables, missing) };
    case 'json':
    case 'text':
      return { ...body, raw: resolveString(body.raw, variables, missing) };
    case 'formdata':
      // A file field's name can hold a variable; its contents are bytes, never text.
      return {
        ...body,
        form: (body.form || []).map((row) => {
          if (row?.enabled === false) return row;
          const key = resolveString(row.key, variables, missing);
          return row.type === 'file' ? { ...row, key } : { ...row, key, value: resolveString(row.value, variables, missing) };
        }),
      };
    default:
      return body;
  }
}

/**
 * Substitutes {{variables}} throughout a request configuration.
 *
 * Pure and self-contained: it knows nothing about HTTP, environments storage, or
 * assertions — it takes a config plus a variable map and returns a new config.
 * Returns the resolved config and the names of any variables that were not found.
 */
export function resolveRequestConfig(requestConfig, variables = {}) {
  const missing = new Set();
  const isGraphQL = requestConfig.protocol === 'graphql';

  const resolved = {
    ...requestConfig,
    url: resolveString(requestConfig.url, variables, missing),
    params: resolveRows(requestConfig.params, variables, missing),
    headers: resolveRows(requestConfig.headers, variables, missing),
    // body is unused in GraphQL mode (the engine builds the JSON body from
    // `graphql` instead) — same "don't resolve what isn't sent" reasoning as
    // disabled rows and inactive auth types. Within REST, only the field the active
    // body mode actually sends is resolved, for that same reason.
    body: requestConfig.body && !isGraphQL ? resolveBody(requestConfig.body, variables, missing) : requestConfig.body,
    graphql:
      requestConfig.graphql && isGraphQL
        ? {
            ...requestConfig.graphql,
            query: resolveString(requestConfig.graphql.query, variables, missing),
            variables: resolveString(requestConfig.graphql.variables, variables, missing),
            operationName: resolveString(requestConfig.graphql.operationName, variables, missing),
          }
        : requestConfig.graphql,
    auth: resolveAuth(requestConfig.auth, variables, missing),
  };

  return { config: resolved, missing: [...missing] };
}
