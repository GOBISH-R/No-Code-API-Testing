import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Signed in as whichever account the test names in x-test-user, so one app instance
// can stand in for two people. The real gate is covered by auth-gate.test.js.
vi.mock('../../src/middleware/authenticate.js', () => ({
  attachUser: (req, _res, next) => {
    const id = req.get('x-test-user');
    if (id) req.user = { _id: id, toPublicJSON: () => ({ id }) };
    next();
  },
  requireAuth: (_req, _res, next) => next(),
  ownerId: (req) => req.scope?.ownerId ?? req.user._id,
  actorId: (req) => req.user._id,
}));

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../src/app.js';
import { HistoryEntry } from '../../src/models/HistoryEntry.js';
import {
  recordHistory,
  listHistory,
  MAX_ENTRIES_PER_ACCOUNT,
  MAX_KEPT_BODY_CHARS,
} from '../../src/services/history/historyService.js';

const ADA = '64b000000000000000000001';
const MALLORY = '64b000000000000000000002';

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await HistoryEntry.deleteMany({});
});

const as = (user) => ({
  get: (url) => request(app).get(url).set('x-test-user', user),
  post: (url) => request(app).post(url).set('x-test-user', user),
  delete: (url) => request(app).delete(url).set('x-test-user', user),
});

// Blocked by the SSRF guard, so it is recorded without any network access.
const blockedSend = {
  method: 'POST',
  url: 'http://127.0.0.1:9/{{path}}',
  headers: [{ key: 'X-Trace', value: '1', enabled: true }],
  body: { mode: 'json', raw: '{"a":1}' },
  auth: { type: 'bearer', bearer: { token: 'secret-token-123' } },
};

const ok = (status = 200) => ({ success: true, meta: { time: 12 }, response: { status, size: 34 } });

describe('recording sends', () => {
  it('records a request refused before it left, with the reason', async () => {
    const res = await as(ADA).post('/api/requests/execute').send({ ...blockedSend, url: 'http://127.0.0.1:9/x' });
    expect(res.status).toBe(400);

    const [entry] = (await as(ADA).get('/api/history')).body;
    expect(entry).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:9/x', status: null });
    expect(entry.error).toBeTruthy();
  });

  it('does not record a payload that failed validation', async () => {
    await as(ADA).post('/api/requests/execute').send({ method: 'TRACE', url: 'https://example.com' });
    expect((await as(ADA).get('/api/history')).body).toEqual([]);
  });

  it('keeps the request as typed, with {{variables}} unresolved', async () => {
    await recordHistory(ADA, blockedSend, ok());
    const [summary] = (await as(ADA).get('/api/history')).body;
    const full = (await as(ADA).get(`/api/history/${summary._id}`)).body;
    expect(full.url).toBe('http://127.0.0.1:9/{{path}}');
    expect(full.body).toMatchObject({ mode: 'json', raw: '{"a":1}' });
  });

  it('stores GraphQL as POST and skips WebSocket sessions', async () => {
    await recordHistory(ADA, { protocol: 'graphql', method: 'GET', url: 'https://g.test', graphql: { query: '{a}' } }, ok());
    await recordHistory(ADA, { protocol: 'websocket', url: 'wss://w.test' }, ok());
    const list = await listHistory(ADA);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ protocol: 'graphql', method: 'POST' });
  });
});

describe('what the list exposes', () => {
  it('is a summary: no headers, body or auth', async () => {
    await recordHistory(ADA, blockedSend, ok(201));
    const [entry] = (await as(ADA).get('/api/history')).body;
    expect(entry).toMatchObject({ method: 'POST', status: 201, time: 12, size: 34 });
    expect(entry).not.toHaveProperty('auth');
    expect(entry).not.toHaveProperty('headers');
    expect(entry).not.toHaveProperty('body');
    // Params stay: they are part of the URL as the list shows it.
    expect(entry).toHaveProperty('params');
  });

  it('encrypts credentials at rest and decrypts them for the owner', async () => {
    const { _id } = await recordHistory(ADA, blockedSend, ok());
    const raw = await mongoose.connection.collection('historyentries').findOne({ _id });
    expect(raw.auth.bearer.token).not.toContain('secret-token-123');

    const full = (await as(ADA).get(`/api/history/${_id}`)).body;
    expect(full.auth.bearer.token).toBe('secret-token-123');
  });

  it('lists newest first', async () => {
    await recordHistory(ADA, { ...blockedSend, url: 'https://a.test/1' }, ok());
    await recordHistory(ADA, { ...blockedSend, url: 'https://a.test/2' }, ok());
    const urls = (await as(ADA).get('/api/history')).body.map((e) => e.url);
    expect(urls).toEqual(['https://a.test/2', 'https://a.test/1']);
  });
});

describe('limits', () => {
  it(`keeps only the newest ${MAX_ENTRIES_PER_ACCOUNT} per account`, async () => {
    for (let i = 0; i < MAX_ENTRIES_PER_ACCOUNT + 5; i += 1) {
      await recordHistory(ADA, { ...blockedSend, url: `https://a.test/${i}` }, ok());
    }
    await recordHistory(MALLORY, blockedSend, ok());

    const list = await listHistory(ADA);
    expect(list).toHaveLength(MAX_ENTRIES_PER_ACCOUNT);
    expect(list[0].url).toBe(`https://a.test/${MAX_ENTRIES_PER_ACCOUNT + 4}`);
    expect(list.at(-1).url).toBe('https://a.test/5');
    // Trimming one account never touches another's.
    expect(await listHistory(MALLORY)).toHaveLength(1);
  });

  it('leaves out a body too large to keep, and says so', async () => {
    const big = { ...blockedSend, body: { mode: 'text', raw: 'x'.repeat(MAX_KEPT_BODY_CHARS + 1) } };
    const { _id } = await recordHistory(ADA, big, ok());
    const full = (await as(ADA).get(`/api/history/${_id}`)).body;
    expect(full.bodyOmitted).toBe(true);
    expect(full.body.raw).toBe('');
  });

  it('expires entries after the retention period', () => {
    const ttl = HistoryEntry.schema.indexes().find(([, options]) => options?.expireAfterSeconds);
    expect(ttl[1].expireAfterSeconds).toBe(30 * 24 * 60 * 60);
  });
});

describe('isolation', () => {
  it('cannot be listed, read or deleted by another account', async () => {
    const { _id } = await recordHistory(ADA, blockedSend, ok());

    expect((await as(MALLORY).get('/api/history')).body).toEqual([]);
    expect((await as(MALLORY).get(`/api/history/${_id}`)).status).toBe(404);
    expect((await as(MALLORY).delete(`/api/history/${_id}`)).status).toBe(404);
    expect((await as(MALLORY).delete('/api/history')).status).toBe(204);

    expect(await listHistory(ADA)).toHaveLength(1);
  });
});

describe('deleting', () => {
  it('removes one entry, or all of them', async () => {
    const first = await recordHistory(ADA, blockedSend, ok());
    await recordHistory(ADA, blockedSend, ok());

    expect((await as(ADA).delete(`/api/history/${first._id}`)).status).toBe(204);
    expect(await listHistory(ADA)).toHaveLength(1);

    expect((await as(ADA).delete('/api/history')).status).toBe(204);
    expect(await listHistory(ADA)).toHaveLength(0);
  });

  it('rejects a malformed id', async () => {
    expect((await as(ADA).get('/api/history/not-an-id')).status).toBe(400);
    expect((await as(ADA).delete('/api/history/not-an-id')).status).toBe(400);
  });
});
