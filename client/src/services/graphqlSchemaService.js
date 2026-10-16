import api from './api.js';

export async function introspectSchema({ url, headers, auth, environmentId, runtimeVariables }) {
  const { data } = await api.post(
    '/graphql/introspect',
    { url, headers, auth, environmentId, runtimeVariables },
    // Introspection queries a whole schema, which can take longer than a normal
    // request on a large API — the backend's own 15s target timeout still applies.
    { timeout: 40000 },
  );
  return data;
}

// Note: the cached schema is read back through GET /api/graphql/schema, which is a
// documented endpoint but is not currently consumed by the UI — the builder only
// knows the *templated* URL, while the cache is keyed by the resolved one, so the
// client cannot construct the key. Introspection therefore always re-fetches.
