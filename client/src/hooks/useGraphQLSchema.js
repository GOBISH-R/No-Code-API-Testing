import { useCallback, useMemo, useState } from 'react';
import { introspectSchema } from '../services/graphqlSchemaService.js';

// Holds the introspected schema for the request currently in the builder.
//
// Kept in one place because every GraphQL tool built on top of it — the schema
// viewer, pre-send validation, autocomplete and the docs explorer — must read the
// same schema rather than each fetching its own.
export function useGraphQLSchema() {
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [schema, setSchema] = useState(null); // raw introspection payload
  const [endpoint, setEndpoint] = useState(''); // resolved URL the schema came from
  // The URL *as typed*, plus the environment, at the moment the schema was loaded.
  // A schema only describes the endpoint it came from, and a templated URL like
  // {{baseUrl}}/graphql resolves differently per environment — so both have to match
  // before the schema can be trusted to describe the request's current target.
  const [loadedForUrl, setLoadedForUrl] = useState('');
  const [loadedForEnvironmentId, setLoadedForEnvironmentId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async ({ url, headers, auth, environmentId, runtimeVariables }) => {
    if (!url?.trim()) {
      setStatus('error');
      setError('Enter the GraphQL endpoint URL first.');
      return;
    }

    setStatus('loading');
    setError('');
    try {
      const data = await introspectSchema({ url, headers, auth, environmentId, runtimeVariables });
      setSchema(data.schema);
      setEndpoint(data.endpoint);
      setLoadedForUrl(url);
      setLoadedForEnvironmentId(environmentId ?? null);
      setStatus('ready');
    } catch (err) {
      setSchema(null);
      setEndpoint('');
      setLoadedForUrl('');
      setLoadedForEnvironmentId(null);
      setStatus('error');
      setError(err.response?.data?.message || err.message || 'Failed to load the schema.');
    }
  }, []);

  const clear = useCallback(() => {
    setSchema(null);
    setEndpoint('');
    setLoadedForUrl('');
    setLoadedForEnvironmentId(null);
    setError('');
    setStatus('idle');
  }, []);

  // Cheap summary for the UI — the full schema stays untouched for later phases.
  const summary = useMemo(() => {
    const root = schema?.__schema;
    if (!root) return null;
    return {
      typeCount: root.types?.length ?? 0,
      queryType: root.queryType?.name || null,
      mutationType: root.mutationType?.name || null,
      subscriptionType: root.subscriptionType?.name || null,
    };
  }, [schema]);

  return { status, schema, summary, endpoint, loadedForUrl, loadedForEnvironmentId, error, load, clear };
}
