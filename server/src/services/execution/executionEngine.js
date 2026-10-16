import { assertPublicUrl } from './urlValidator.js';
import { executeHttpRequest } from './requestExecutor.js';
import { fetchClientCredentialsToken } from './oauth2Client.js';
import { resolveRequestConfig } from '../variables/variableResolver.js';
import { applyAuth } from '../auth/applyAuth.js';
import { enabledEntries } from '../../utils/rows.js';
import { ValidationError } from '../../utils/errors.js';

// GraphQL-over-HTTP's standard request shape (used by virtually every real server):
// a JSON body of { query, variables?, operationName? }. variables is stored as a raw
// JSON string (like body.raw) so it's parsed here, after {{variable}} substitution has
// already run — a substitution that breaks JSON syntax (e.g. an unquoted placeholder)
// surfaces as a clear error rather than a silently broken request.
function buildGraphQLData(graphql) {
  let variables;
  if (graphql?.variables?.trim()) {
    try {
      variables = JSON.parse(graphql.variables);
    } catch (err) {
      throw new ValidationError(`graphql.variables must be valid JSON: ${err.message}`);
    }
  }

  const payload = { query: graphql?.query ?? '' };
  if (variables !== undefined) payload.variables = variables;
  if (graphql?.operationName?.trim()) payload.operationName = graphql.operationName.trim();

  return JSON.stringify(payload);
}

/**
 * A multipart/form-data body from the form rows.
 *
 * File contents arrive base64-encoded with this send and are never stored, so a saved
 * request run later (a collection run, a monitor) has the file's name but not its bytes —
 * that is refused with a message saying exactly which field needs its file again, rather
 * than quietly sending an empty part.
 */
function buildFormData(rows) {
  const form = new FormData();
  let fields = 0;
  for (const row of rows || []) {
    if (row?.enabled === false || !row?.key?.trim()) continue;
    const key = row.key.trim();
    if (row.type === 'file') {
      if (typeof row.data !== 'string') {
        throw new ValidationError(
          `Choose the file for "${key}" again — files are sent with a request but never saved with it.`,
        );
      }
      const bytes = Buffer.from(row.data, 'base64');
      form.append(key, new Blob([bytes], { type: row.fileType || 'application/octet-stream' }), row.fileName || 'file');
    } else {
      form.append(key, row.value ?? '');
    }
    fields += 1;
  }
  return fields > 0 ? form : undefined;
}

function buildAxiosConfig(requestConfig, targetUrl, oauthToken) {
  const { protocol, params, headers, body, auth, graphql } = requestConfig;
  const isGraphQL = protocol === 'graphql';
  // GraphQL-over-HTTP is always POST, regardless of whatever `method` happens to be
  // stored on the request (the UI fixes it to POST too, but this is the real guarantee).
  const method = isGraphQL ? 'POST' : requestConfig.method;

  const resolvedHeaders = enabledEntries(headers);
  const resolvedParams = enabledEntries(params);

  // A Content-Type the user typed by hand always wins over the mode's default.
  const setDefaultContentType = (value) => {
    if (!Object.keys(resolvedHeaders).some((h) => h.toLowerCase() === 'content-type')) {
      resolvedHeaders['Content-Type'] = value;
    }
  };

  let data;
  if (isGraphQL) {
    data = buildGraphQLData(graphql);
    setDefaultContentType('application/json');
  } else if (body?.mode === 'json' && body.raw?.trim()) {
    data = body.raw;
    setDefaultContentType('application/json');
  } else if (body?.mode === 'urlencoded') {
    const form = new URLSearchParams(enabledEntries(body.rows));
    const encoded = form.toString();
    if (encoded) {
      data = encoded;
      setDefaultContentType('application/x-www-form-urlencoded');
    }
  } else if (body?.mode === 'text' && body.raw?.trim()) {
    data = body.raw;
    setDefaultContentType('text/plain');
  } else if (body?.mode === 'formdata') {
    data = buildFormData(body.form);
    if (data) {
      // The multipart boundary is generated with the body, so a Content-Type typed by
      // hand — which cannot know it — would make the body unreadable. Axios sets it.
      for (const name of Object.keys(resolvedHeaders)) {
        if (name.toLowerCase() === 'content-type') delete resolvedHeaders[name];
      }
    }
  }

  // The auth rules live in one protocol-neutral place so the WebSocket handshake
  // authenticates identically without a second copy of them. Applied after the user's
  // own rows, so auth still wins on a key collision — unchanged from before.
  const appliedAuth = applyAuth(auth, oauthToken);
  Object.assign(resolvedHeaders, appliedAuth.headers);
  Object.assign(resolvedParams, appliedAuth.params);
  const axiosAuth = appliedAuth.basic ?? undefined;

  return {
    method,
    url: targetUrl.toString(),
    params: resolvedParams,
    headers: resolvedHeaders,
    data,
    auth: axiosAuth,
  };
}

// Request configuration -> resolve {{variables}} -> (OAuth2: fetch a token) -> validate
// target URL -> execute -> result. Variables arrive already loaded (the caller owns
// environment storage), so this stays independent of the database. Assertions and
// result persistence live outside this engine.
export async function executeRequest(requestConfig, variables = {}) {
  const { config, missing } = resolveRequestConfig(requestConfig, variables);

  if (missing.length > 0) {
    throw new ValidationError(
      `Unresolved variable${missing.length > 1 ? 's' : ''}: ${missing.map((m) => `{{${m}}}`).join(', ')}. ` +
        'Define them in the selected environment, or select an environment that provides them.',
    );
  }

  let oauthToken;
  if (config.auth?.type === 'oauth2') {
    const grantType = config.auth.oauth2?.grantType || 'clientCredentials';
    if (grantType === 'authorizationCode') {
      // No user, no browser here — the consent step already happened in the frontend
      // (see oauth.controller.js), so this just reuses whatever token that produced.
      oauthToken = config.auth.oauth2?.accessToken;
      if (!oauthToken) {
        throw new ValidationError(
          'No OAuth 2.0 access token yet — click "Get New Access Token" on the Auth tab first.',
        );
      }
    } else {
      // Client Credentials: fetched fresh on every send — no caching. Simple and
      // always-correct; the cost is one extra round trip per request, which is fine
      // for interactive testing.
      oauthToken = await fetchClientCredentialsToken(config.auth.oauth2);
    }
  }

  const targetUrl = await assertPublicUrl(config.url);
  const axiosConfig = buildAxiosConfig(config, targetUrl, oauthToken);
  return followRedirects(axiosConfig);
}

// Matches what Axios would have allowed on its own, so behaviour is unchanged for
// every legitimate request — only the checking is different.
const MAX_REDIRECTS = 5;

function headerValue(headers, name) {
  const key = Object.keys(headers || {}).find((h) => h.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

/**
 * Chooses the method for the next hop.
 *
 * 307 and 308 exist precisely to preserve the method and body; 303 mandates GET; and
 * 301/302 after a non-GET became GET by universal practice, which every browser and
 * HTTP client follows. Getting this wrong would silently replay a POST.
 */
function nextMethod(status, method) {
  const current = String(method || 'GET').toUpperCase();
  if (status === 307 || status === 308) return current;
  if (current === 'GET' || current === 'HEAD') return current;
  return 'GET';
}

/**
 * Follows redirects one hop at a time, re-validating each target.
 *
 * Two things happen here that Axios's own redirect handling would not do: every new
 * URL goes back through the SSRF guard, and credentials are dropped when a redirect
 * crosses to another origin — otherwise a redirect is enough to make this tool hand
 * the user's Authorization header to a host they never addressed.
 */
async function followRedirects(initialConfig) {
  let config = initialConfig;
  let origin = new URL(config.url).origin;
  const chain = [];
  let totalTime = 0;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await executeHttpRequest(config);
    totalTime += result.meta?.time ?? 0;

    const status = result.response?.status;
    const location = result.success && status >= 300 && status < 400
      ? headerValue(result.response.headers, 'location')
      : undefined;

    // Either a final response, or a redirect with no Location to follow.
    if (!location) {
      if (chain.length > 0) {
        result.meta = { ...result.meta, time: totalTime, redirects: chain };
      }
      return result;
    }

    if (hop === MAX_REDIRECTS) {
      return {
        success: false,
        meta: { time: totalTime, redirects: chain },
        response: null,
        error: {
          message: `The request exceeded ${MAX_REDIRECTS} redirects.`,
          code: 'TOO_MANY_REDIRECTS',
        },
      };
    }

    let target;
    try {
      // Resolved against the current URL, since a Location may be relative.
      target = await assertPublicUrl(new URL(location, config.url).toString());
    } catch (err) {
      return {
        success: false,
        meta: { time: totalTime, redirects: chain },
        response: null,
        error: {
          message: `Redirect blocked: ${err.message}`,
          code: 'REDIRECT_BLOCKED',
        },
      };
    }

    chain.push({ status, url: target.toString() });

    const method = nextMethod(status, config.method);
    const crossOrigin = target.origin !== origin;
    const headers = { ...config.headers };
    if (crossOrigin) {
      for (const name of Object.keys(headers)) {
        if (['authorization', 'cookie', 'proxy-authorization'].includes(name.toLowerCase())) {
          delete headers[name];
        }
      }
    }

    config = {
      ...config,
      url: target.toString(),
      method,
      headers,
      // A body is meaningless once the method has been downgraded to GET.
      data: method === config.method ? config.data : undefined,
      auth: crossOrigin ? undefined : config.auth,
      // Query parameters were already folded into the URL the server sent us back.
      params: undefined,
    };
    origin = target.origin;
  }

  // Unreachable: the hop === MAX_REDIRECTS branch above always returns.
  throw new Error('Redirect loop exited unexpectedly.');
}
