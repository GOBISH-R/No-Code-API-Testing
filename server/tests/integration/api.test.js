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

// These run against the real Express app with no database and no network access to
// any target — every case here is deterministic and offline. Execution paths that
// genuinely need a live target API stay out of the automated suite on purpose.

describe('GET /api/health', () => {
  it('reports server and database status', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toHaveProperty('state');
  });
});

describe('unknown routes', () => {
  it('404s with the standard error shape instead of an HTML stack page', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');

    expect(res.status).toBe(404);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toMatch(/not found/i);
  });
});

describe('POST /api/requests/execute — validation', () => {
  it('rejects an empty payload', async () => {
    const res = await request(app).post('/api/requests/execute').send({});
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported method', async () => {
    const res = await request(app)
      .post('/api/requests/execute')
      .send({ method: 'TRACE', url: 'https://example.com' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/method/i);
  });

  it('rejects a missing URL', async () => {
    const res = await request(app).post('/api/requests/execute').send({ method: 'GET', url: '' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/url/i);
  });

  it('rejects a malformed JSON body', async () => {
    const res = await request(app)
      .post('/api/requests/execute')
      .send({ method: 'POST', url: 'https://example.com', body: { mode: 'json', raw: '{broken' } });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/json/i);
  });

  it('rejects an unknown oauth2 grant type', async () => {
    const res = await request(app)
      .post('/api/requests/execute')
      .send({
        method: 'GET',
        url: 'https://example.com',
        auth: { type: 'oauth2', oauth2: { grantType: 'bogus' } },
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/grantType/i);
  });
});

describe('POST /api/requests/execute — SSRF guard', () => {
  it('blocks localhost targets', async () => {
    const res = await request(app)
      .post('/api/requests/execute')
      .send({ method: 'GET', url: 'http://localhost:5000/api/health' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/local|internal/i);
  });

  it('blocks loopback IPs', async () => {
    const res = await request(app)
      .post('/api/requests/execute')
      .send({ method: 'GET', url: 'http://127.0.0.1/secrets' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/private|internal/i);
  });

  it('blocks link-local cloud metadata addresses', async () => {
    // 169.254.169.254 is the cloud instance-metadata endpoint — the classic SSRF target.
    const res = await request(app)
      .post('/api/requests/execute')
      .send({ method: 'GET', url: 'http://169.254.169.254/latest/meta-data/' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/private|internal/i);
  });

  it('blocks non-http protocols', async () => {
    const res = await request(app)
      .post('/api/requests/execute')
      .send({ method: 'GET', url: 'file:///etc/passwd' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/http/i);
  });
});

describe('POST /api/oauth/authcode/authorize-url — validation', () => {
  it('requires a client id', async () => {
    const res = await request(app)
      .post('/api/oauth/authcode/authorize-url')
      .send({ authUrl: 'https://auth.example.com/authorize', tokenUrl: 'https://auth.example.com/token' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/client id/i);
  });

  it('rejects a malformed auth URL', async () => {
    const res = await request(app)
      .post('/api/oauth/authcode/authorize-url')
      .send({ authUrl: 'not-a-url', tokenUrl: 'https://auth.example.com/token', clientId: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/valid URL/i);
  });

  it('builds a spec-shaped authorization URL and owns the redirect URI', async () => {
    const res = await request(app).post('/api/oauth/authcode/authorize-url').send({
      authUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'abc123',
      clientSecret: 'shh',
      scope: 'read write',
    });

    expect(res.status).toBe(200);

    const url = new URL(res.body.authorizationUrl);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('abc123');
    expect(url.searchParams.get('scope')).toBe('read write');
    // The state must be unguessable and the redirect URI server-owned, never client-supplied.
    expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]{48}$/);
    expect(url.searchParams.get('redirect_uri')).toBe(res.body.redirectUri);
    expect(res.body.redirectUri).toMatch(/\/api\/oauth\/authcode\/callback$/);

    // The client secret must never be echoed back to the browser.
    expect(JSON.stringify(res.body)).not.toContain('shh');
  });
});

describe('GET /api/oauth/authcode/callback — handshake safety', () => {
  it('rejects an unknown state instead of exchanging anything', async () => {
    const res = await request(app)
      .get('/api/oauth/authcode/callback')
      .query({ code: 'abc', state: 'not-a-real-state' });

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/expired or was already used/i);
  });

  it('surfaces a provider denial to the opener', async () => {
    const res = await request(app)
      .get('/api/oauth/authcode/callback')
      .query({ error: 'access_denied', error_description: 'User said no', state: 'x' });

    expect(res.text).toContain('User said no');
    expect(res.text).toContain('oauth-authcode-result');
  });

  it('consumes a state exactly once', async () => {
    const start = await request(app).post('/api/oauth/authcode/authorize-url').send({
      authUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'abc123',
    });
    const state = new URL(start.body.authorizationUrl).searchParams.get('state');

    // First use fails at the (unreachable) token exchange, but it still consumes the state.
    await request(app).get('/api/oauth/authcode/callback').query({ code: 'code1', state });

    const replay = await request(app)
      .get('/api/oauth/authcode/callback')
      .query({ code: 'code1', state });

    expect(replay.text).toMatch(/expired or was already used/i);
  });
});
