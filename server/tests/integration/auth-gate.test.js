import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';

/**
 * Proof that the authentication gate is actually mounted.
 *
 * Deliberately uses the real middleware — the other integration files stub it so they
 * can test what sits behind it, and that stubbing is exactly why this file has to
 * exist. Without it, someone could delete `app.use('/api', requireAuth)` and the whole
 * suite would still pass.
 *
 * Every route listed here reads or writes stored data. If any one of them stops
 * returning 401 to an anonymous caller, that data is public.
 */

const PROTECTED = [
  ['get', '/api/collections'],
  ['post', '/api/collections'],
  ['get', '/api/environments'],
  ['post', '/api/environments'],
  ['get', '/api/globals'],
  ['put', '/api/globals'],
  ['get', '/api/mocks'],
  ['post', '/api/mocks'],
  ['get', '/api/test-runs'],
  ['get', '/api/dashboard'],
  ['post', '/api/requests/execute'],
  ['post', '/api/requests'],
  ['post', '/api/folders'],
  ['post', '/api/graphql/introspect'],
  ['get', '/api/graphql/schema'],
  ['post', '/api/oauth/authcode/authorize-url'],
];

describe('the API is closed by default', () => {
  it.each(PROTECTED)('refuses %s %s without a session', async (method, path) => {
    const res = await request(app)[method](path).send({});

    expect(res.status).toBe(401);
    // No detail about what the route would have done, or whether it exists.
    expect(res.body.status).toBe('error');
  });

  it('refuses an unknown /api route without a session too', async () => {
    // 401 rather than 404 is deliberate: answering "no such route" to an anonymous
    // caller would let them map the API surface.
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(401);
  });
});

describe('the endpoints needed to sign in stay open', () => {
  it('serves health, for monitoring', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('serves the list of sign-in methods, so the page knows what to render', async () => {
    const res = await request(app).get('/api/accounts/methods');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('password');
    expect(res.body).toHaveProperty('google');
  });

  it('answers "who am I" with 401 and a null user rather than an error', async () => {
    // The client calls this on load to choose between the app and the sign-in page; it
    // is a question, not a failure.
    const res = await request(app).get('/api/accounts/me');
    expect(res.status).toBe(401);
    expect(res.body.user).toBeNull();
  });

  it('reaches the login handler rather than the auth gate', async () => {
    // A login endpoint behind requireAuth is a locked door with the key inside.
    //
    // Status alone cannot show this: the gate returns 401, and so does the handler for
    // bad credentials. The message is what distinguishes them — the gate says "Sign in
    // to continue", which would be a nonsensical reply to someone trying to sign in.
    const res = await request(app)
      .post('/api/accounts/login')
      .send({ email: 'nobody@example.com', password: 'whatever-goes-here' });

    expect(res.body.message).not.toMatch(/sign in to continue/i);
  });
});

describe('the mock server stays public', () => {
  it('does not sit behind the account gate', async () => {
    // Mocks exist to be called by whatever client is under test, which has no session
    // here. A 404 means it reached the mock router and found no matching endpoint —
    // a 401 would mean the gate had swallowed it.
    const res = await request(app).get('/mock/anything');
    expect(res.status).not.toBe(401);
  });
});

describe('the welcome endpoint', () => {
  it('refuses a request with no session', async () => {
    await request(app).post('/api/accounts/welcome').send({ name: 'Ada' }).expect(401);
  });
});
