import * as mockService from '../services/mocking/mockService.js';
import { findMatch } from '../services/mocking/mockMatcher.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enabledHeaders(rows) {
  const headers = {};
  for (const row of rows || []) {
    if (row?.enabled && row.key?.trim()) headers[row.key.trim()] = row.value ?? '';
  }
  return headers;
}

function hasHeader(headers, name) {
  return Object.keys(headers).some((h) => h.toLowerCase() === name.toLowerCase());
}

/**
 * Serves the configured fake response for the best-matching enabled mock.
 *
 * Public by design: the client under test calls this, and it has no session. The first
 * path segment is the owner's mock key, which is what keeps two accounts that both
 * define `/users` from answering each other's traffic.
 *
 * Deliberately has no knowledge of the real execution engine — mocking stays separate.
 */
export async function serveMockHandler(req, res, next) {
  try {
    const { mockKey } = req.params;
    const path = '/' + (req.params.splat || []).join('/');
    const mocks = await mockService.listEnabledMocksByKey(mockKey);
    const mock = findMatch(mocks, req.method, path);

    if (!mock) {
      res.status(404).json({
        status: 'error',
        message: `No mock configured for ${req.method} ${path}.`,
      });
      return;
    }

    if (mock.delayMs > 0) await delay(mock.delayMs);

    const headers = enabledHeaders(mock.headers);
    res.set(headers);

    if (!mock.body) {
      res.status(mock.statusCode).end();
      return;
    }

    if (!hasHeader(headers, 'content-type')) {
      try {
        JSON.parse(mock.body);
        res.type('application/json');
      } catch {
        res.type('text/plain');
      }
    }

    res.status(mock.statusCode).send(mock.body);
  } catch (err) {
    next(err);
  }
}
