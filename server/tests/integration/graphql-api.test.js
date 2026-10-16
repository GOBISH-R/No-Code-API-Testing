import { describe, it, expect, vi } from 'vitest';

// Signed in, without a database.
//
// These cases are about validation and the SSRF guard, which live *behind* the auth
// gate — unauthenticated they would all return 401 before reaching the code under
// test. Stubbing the middleware keeps them offline and fast, and keeps each test about
// the one thing it names. The gate itself is proven separately, in auth-gate.test.js,
// against the real middleware.
vi.mock('../../src/middleware/authenticate.js', () => ({
  attachUser: (req, _res, next) => {
    req.user = { _id: '000000000000000000000001', toPublicJSON: () => ({ id: 'test-user' }) };
    next();
  },
  requireAuth: (_req, _res, next) => next(),
  ownerId: (req) => req.scope?.ownerId ?? req.user._id,
  actorId: (req) => req.user._id,
}));

import request from 'supertest';
import app from '../../src/app.js';

// Offline and deterministic: every case here fails before any network call, or is
// rejected by the SSRF guard using a literal IP that needs no DNS lookup.

describe('POST /api/graphql/introspect — validation', () => {
  it('requires a url', async () => {
    const res = await request(app).post('/api/graphql/introspect').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/url is required/i);
  });

  it('rejects malformed headers', async () => {
    const res = await request(app)
      .post('/api/graphql/introspect')
      .send({ url: 'https://example.com/graphql', headers: [{ key: 'X' }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/headers/i);
  });

  it('rejects an unknown auth type', async () => {
    const res = await request(app)
      .post('/api/graphql/introspect')
      .send({ url: 'https://example.com/graphql', auth: { type: 'magic' } });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/auth.type/i);
  });

  it('rejects malformed runtimeVariables', async () => {
    const res = await request(app)
      .post('/api/graphql/introspect')
      .send({ url: 'https://example.com/graphql', runtimeVariables: ['nope'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/runtimeVariables/i);
  });
});

describe('POST /api/graphql/introspect — SSRF guard still applies', () => {
  it('blocks loopback endpoints', async () => {
    const res = await request(app)
      .post('/api/graphql/introspect')
      .send({ url: 'http://127.0.0.1/graphql' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/private|internal/i);
  });

  it('blocks localhost endpoints', async () => {
    const res = await request(app)
      .post('/api/graphql/introspect')
      .send({ url: 'http://localhost:4000/graphql' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/local|internal/i);
  });

  it('blocks cloud metadata endpoints', async () => {
    const res = await request(app)
      .post('/api/graphql/introspect')
      .send({ url: 'http://169.254.169.254/graphql' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/private|internal/i);
  });

  it('blocks non-http protocols', async () => {
    const res = await request(app)
      .post('/api/graphql/introspect')
      .send({ url: 'file:///etc/passwd' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/http/i);
  });

  it('reports an unresolved variable instead of sending a broken URL', async () => {
    const res = await request(app)
      .post('/api/graphql/introspect')
      .send({ url: '{{missingBase}}/graphql' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/missingBase/);
  });
});

describe('GET /api/graphql/schema — cache lookup', () => {
  it('requires an endpoint parameter', async () => {
    const res = await request(app).get('/api/graphql/schema');
    // 400 for the missing parameter, or 503 when no database is connected — both are
    // correct refusals; what matters is that it never 200s without an endpoint.
    expect([400, 503]).toContain(res.status);
  });
});
