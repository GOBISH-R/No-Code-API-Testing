import { resolveRequestConfig } from '../variables/variableResolver.js';
import { applyAuth, basicAuthHeader } from '../auth/applyAuth.js';
import { fetchClientCredentialsToken } from '../execution/oauth2Client.js';
import { enabledEntries } from '../../utils/rows.js';
import { ValidationError } from '../../utils/errors.js';

/**
 * Turns a WebSocket request configuration into the concrete handshake to perform.
 *
 * Every piece of this is borrowed rather than reimplemented: {{variable}} substitution
 * comes from the shared resolver (which already skips disabled rows and inactive auth
 * types), and the auth rules come from the shared applier that the HTTP executor uses.
 * The only WebSocket-specific work here is folding query parameters into the URL and
 * encoding Basic auth as a header, because a handshake has no separate auth channel.
 */
export async function buildHandshake(config = {}, variables = {}) {
  if (!config.url?.trim()) throw new ValidationError('A WebSocket URL is required.');

  const { config: resolved, missing } = resolveRequestConfig(
    { ...config, protocol: 'websocket' },
    variables,
  );

  if (missing.length > 0) {
    throw new ValidationError(
      `Unresolved variable${missing.length > 1 ? 's' : ''}: ${missing.map((m) => `{{${m}}}`).join(', ')}. ` +
        'Define them in the selected environment, or select an environment that provides them.',
    );
  }

  let oauthToken;
  if (resolved.auth?.type === 'oauth2') {
    const grantType = resolved.auth.oauth2?.grantType || 'clientCredentials';
    if (grantType === 'authorizationCode') {
      oauthToken = resolved.auth.oauth2?.accessToken;
      if (!oauthToken) {
        throw new ValidationError(
          'No OAuth 2.0 access token yet — obtain one on the Auth tab before connecting.',
        );
      }
    } else {
      oauthToken = await fetchClientCredentialsToken(resolved.auth.oauth2);
    }
  }

  const applied = applyAuth(resolved.auth, oauthToken);

  // Auth is applied over the user's own rows, so it wins a key collision — the same
  // precedence the HTTP executor uses.
  const headers = { ...enabledEntries(resolved.headers), ...applied.headers };
  if (applied.basic) headers['Authorization'] = basicAuthHeader(applied.basic);

  const params = { ...enabledEntries(resolved.params), ...applied.params };

  // A WebSocket handshake carries query parameters in the URL itself; there is no
  // separate params channel the way an HTTP client has.
  let url;
  try {
    url = new URL(resolved.url);
  } catch {
    throw new ValidationError('Invalid WebSocket URL. Include the protocol, e.g. wss://example.com/socket');
  }
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const subprotocols = (config.subprotocols || [])
    .map((p) => String(p).trim())
    .filter(Boolean);

  return { url: url.toString(), headers, subprotocols };
}
