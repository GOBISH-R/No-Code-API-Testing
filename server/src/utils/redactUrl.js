/**
 * Strips secrets out of a URL before it is written to a log.
 *
 * The Google sign-in callback arrives as `/callback?code=…&state=…`, and a request logger
 * writes that address out verbatim. The code is single-use and the state is consumed on
 * arrival, so neither is useful by the time anyone reads the log — but a log should not
 * contain credentials at all, and "it was already spent" is not a property worth relying
 * on for the next parameter someone adds.
 *
 * Matching is by parameter name, case-insensitively, and only the value is replaced, so
 * the log still shows which parameters were present.
 */

const SENSITIVE_PARAMS = new Set([
  'code',
  'state',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'password',
  'api_key',
  'apikey',
  'key',
  'secret',
]);

export const REDACTED = '[redacted]';

export function redactUrl(url) {
  const raw = String(url ?? '');
  const queryAt = raw.indexOf('?');
  if (queryAt === -1) return raw;

  const path = raw.slice(0, queryAt);
  const query = raw.slice(queryAt + 1);

  // Rebuilt by hand rather than through URLSearchParams, which would re-encode every
  // value and make the logged line differ from what actually arrived.
  const cleaned = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      const name = eq === -1 ? pair : pair.slice(0, eq);
      let decoded = name;
      try {
        decoded = decodeURIComponent(name);
      } catch {
        // A malformed escape: fall back to the raw name, which is still worth checking.
      }
      return SENSITIVE_PARAMS.has(decoded.toLowerCase()) && eq !== -1 ? `${name}=${REDACTED}` : pair;
    })
    .join('&');

  return `${path}?${cleaned}`;
}
