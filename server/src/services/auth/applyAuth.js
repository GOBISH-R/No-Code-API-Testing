/**
 * Turns an auth configuration into the headers and query parameters it contributes.
 *
 * Protocol-neutral on purpose: an HTTP request and a WebSocket handshake authenticate
 * the same way (the handshake *is* an HTTP upgrade request), so the rules for what
 * "Bearer token" or "API key in the query string" mean must exist once. The HTTP
 * executor and the WebSocket gateway both read from here rather than each deciding.
 *
 * Basic auth is returned separately rather than pre-encoded because axios has native
 * handling for it, and changing the HTTP path to hand-build the header would alter
 * behaviour that already works. Callers without that support (WebSocket) encode it
 * themselves via basicAuthHeader().
 */
export function applyAuth(auth, oauthToken) {
  const result = { headers: {}, params: {}, basic: null };
  if (!auth) return result;

  switch (auth.type) {
    case 'basic':
      result.basic = { username: auth.basic?.username ?? '', password: auth.basic?.password ?? '' };
      break;

    case 'bearer':
      if (auth.bearer?.token) result.headers['Authorization'] = `Bearer ${auth.bearer.token}`;
      break;

    case 'apiKey': {
      const key = auth.apiKey?.key?.trim();
      if (key) {
        const value = auth.apiKey.value ?? '';
        if (auth.apiKey.addTo === 'query') result.params[key] = value;
        else result.headers[key] = value;
      }
      break;
    }

    case 'oauth2':
      // The token itself is obtained by the caller — Client Credentials fetches one
      // per send, Authorization Code reuses a stored one — so this only decides how
      // it is attached.
      if (oauthToken) result.headers['Authorization'] = `Bearer ${oauthToken}`;
      break;

    default:
      break;
  }

  return result;
}

export function basicAuthHeader({ username, password }) {
  return `Basic ${Buffer.from(`${username ?? ''}:${password ?? ''}`).toString('base64')}`;
}
