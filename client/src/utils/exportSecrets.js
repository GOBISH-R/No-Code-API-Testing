/**
 * Finds the credentials an export file is about to contain.
 *
 * An export is the file people attach to tickets and commit to repositories, and it
 * carries whatever auth was saved on each request verbatim. That is deliberate — a
 * re-imported collection should work — but it should never be a surprise, so this
 * counts what is in there and the UI says so before the file is written.
 */

// Each entry is one kind of credential and how to read it off a request's auth block.
const CREDENTIAL_KINDS = [
  { singular: 'password', plural: 'passwords', read: (a) => a?.basic?.password },
  { singular: 'bearer token', plural: 'bearer tokens', read: (a) => a?.bearer?.token },
  { singular: 'API key', plural: 'API keys', read: (a) => a?.apiKey?.value },
  { singular: 'OAuth client secret', plural: 'OAuth client secrets', read: (a) => a?.oauth2?.clientSecret },
  { singular: 'OAuth access token', plural: 'OAuth access tokens', read: (a) => a?.oauth2?.accessToken },
  { singular: 'OAuth refresh token', plural: 'OAuth refresh tokens', read: (a) => a?.oauth2?.refreshToken },
];

function isPresent(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Summarises the credentials in an export document.
 *
 * Counts only non-empty values: every request carries the full auth shape with blank
 * defaults, so counting fields rather than values would warn about every export.
 */
export function summarizeSecrets(document) {
  const requests = document?.collection?.requests || [];
  const counts = new Map();
  const requestNames = [];

  for (const request of requests) {
    let hasAny = false;
    for (const kind of CREDENTIAL_KINDS) {
      if (isPresent(kind.read(request.auth))) {
        counts.set(kind.singular, (counts.get(kind.singular) || 0) + 1);
        hasAny = true;
      }
    }
    if (hasAny) requestNames.push(request.name || 'Untitled request');
  }

  const parts = CREDENTIAL_KINDS.filter((kind) => counts.has(kind.singular)).map((kind) => {
    const count = counts.get(kind.singular);
    return `${count} ${count === 1 ? kind.singular : kind.plural}`;
  });

  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);

  return { total, parts, requestNames, requestCount: requestNames.length };
}

// e.g. "1 bearer token and 2 OAuth client secrets"
export function describeSecrets(summary) {
  const { parts } = summary;
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
