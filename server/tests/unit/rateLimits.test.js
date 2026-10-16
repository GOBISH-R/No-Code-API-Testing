import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  accountOrIpKey,
  parseTrustProxy,
  executeLimiter,
  API_LIMITS,
  emailLimits,
  byEmailAddress,
} from '../../src/middleware/rateLimits.js';

describe('accountOrIpKey', () => {
  it('counts a signed-in request against the account, not the address', () => {
    // Two colleagues behind the same office NAT must not share one budget.
    const a = accountOrIpKey({ user: { _id: 'aaa' }, ip: '203.0.113.7' });
    const b = accountOrIpKey({ user: { _id: 'bbb' }, ip: '203.0.113.7' });
    expect(a).toBe('user:aaa');
    expect(a).not.toBe(b);
  });

  it('falls back to the IP for anonymous traffic', () => {
    expect(accountOrIpKey({ ip: '203.0.113.7' })).toBe('ip:203.0.113.7');
  });

  it('groups an IPv6 client by its block, so rotating addresses does not reset the count', () => {
    const one = accountOrIpKey({ ip: '2001:db8:abcd:12::1' });
    const two = accountOrIpKey({ ip: '2001:db8:abcd:12::2' });
    expect(one).toBe(two);
  });
});

describe('parseTrustProxy', () => {
  it('is off unless configured', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
  });

  it('accepts a hop count', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
  });

  it('refuses "true" and anything else that would trust every forwarded address', () => {
    for (const bad of ['true', 'loopback', '-1', '1.5', '99']) {
      expect(() => parseTrustProxy(bad)).toThrow(/TRUST_PROXY/);
    }
  });
});

describe('the execute limiter', () => {
  it('gives each account its own budget', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { _id: req.get('x-test-user') };
      next();
    });
    app.post('/execute', executeLimiter, (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < API_LIMITS.EXECUTE_PER_MINUTE; i += 1) {
      await request(app).post('/execute').set('x-test-user', 'heavy-user').expect(200);
    }
    await request(app).post('/execute').set('x-test-user', 'heavy-user').expect(429);

    // Same machine, different account: unaffected.
    await request(app).post('/execute').set('x-test-user', 'other-user').expect(200);
  });
});

describe('the email limits', () => {
  function appWith(status = 202) {
    const app = express();
    app.use(express.json());
    app.post('/send', emailLimits(byEmailAddress), (req, res) => res.status(status).json({ sent: true }));
    return app;
  }

  it('sends one email a minute to an address, and says so plainly when asked again', async () => {
    const app = appWith();
    await request(app).post('/send').send({ email: 'ada@example.com' }).expect(202);
    const again = await request(app).post('/send').send({ email: 'Ada@Example.com ' });
    expect(again.status).toBe(429);
    expect(again.body.message).toBe('Too many requests. Try again later.');
    expect(Number(again.headers['retry-after'])).toBeLessThanOrEqual(60);
  });

  it('counts each address on its own', async () => {
    const app = appWith();
    await request(app).post('/send').send({ email: 'ada@example.com' }).expect(202);
    await request(app).post('/send').send({ email: 'grace@example.com' }).expect(202);
  });

  it('does not count an attempt that sent nothing — "No account exists" can be retried', async () => {
    const app = appWith(404);
    await request(app).post('/send').send({ email: 'nobody@example.com' }).expect(404);
    await request(app).post('/send').send({ email: 'nobody@example.com' }).expect(404);
  });
});
