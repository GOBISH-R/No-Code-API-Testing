// Segment-by-segment path match: a pattern segment starting with ":" matches any
// single actual segment (e.g. "/users/:id" matches "/users/1" but not "/users/1/posts").
export function matchPath(pattern, actual) {
  const patternParts = pattern.split('/').filter(Boolean);
  const actualParts = actual.split('/').filter(Boolean);

  if (patternParts.length !== actualParts.length) return false;

  return patternParts.every((part, i) => part.startsWith(':') || part === actualParts[i]);
}

// First enabled mock (in creation order) whose method and path pattern match the
// incoming request — pure matching logic, no knowledge of Express or persistence.
export function findMatch(mocks, method, path) {
  return (
    mocks.find(
      (mock) => mock.enabled !== false && mock.method === method && matchPath(mock.path, path),
    ) || null
  );
}
