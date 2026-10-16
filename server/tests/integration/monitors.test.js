import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Signed in as whichever account x-test-user names, as in history.test.js.
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

// No real network: each "request" answers with whatever status the test sets.
const target = { status: 200 };
vi.mock('../../src/services/execution/executionEngine.js', () => ({
  executeRequest: vi.fn(async () => ({
    success: true,
    meta: { time: 5 },
    response: { status: target.status, statusText: '', headers: {}, body: { ok: true }, size: 11 },
  })),
}));

// Alert emails are captured, not sent.
vi.mock('../../src/services/accounts/mailer.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendMonitorAlertEmail: vi.fn(async () => ({ captured: true })),
}));

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../src/app.js';
import { Monitor } from '../../src/models/Monitor.js';
import { TestRun } from '../../src/models/TestRun.js';
import * as collections from '../../src/services/collections/collectionService.js';
import * as savedRequests from '../../src/services/collections/savedRequestService.js';
import * as environments from '../../src/services/environments/environmentService.js';
import { runGate } from '../../src/services/runner/collectionRunner.js';
import {
  executeMonitor,
  MAX_MONITORS_PER_ACCOUNT,
  RUNS_KEPT_PER_MONITOR,
} from '../../src/services/monitors/monitorService.js';
import { claimNextDue, startMonitorScheduler } from '../../src/services/monitors/monitorScheduler.js';
import { sendMonitorAlertEmail } from '../../src/services/accounts/mailer.js';
import { User } from '../../src/models/User.js';
import { Workspace } from '../../src/models/Workspace.js';

const ADA = '64c000000000000000000001';
const MALLORY = '64c000000000000000000002';
const MIN = 60 * 1000;

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
  target.status = 200;
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  sendMonitorAlertEmail.mockClear();
  // Real accounts behind the ids, so alert emails have somewhere to go.
  await User.create([
    { _id: ADA, email: 'ada@example.com', emailVerified: true, name: 'Ada' },
    { _id: MALLORY, email: 'mallory@example.com', emailVerified: true, name: 'Mallory' },
  ]);
});

const as = (user) => ({
  get: (url) => request(app).get(url).set('x-test-user', user),
  post: (url) => request(app).post(url).set('x-test-user', user),
  put: (url) => request(app).put(url).set('x-test-user', user),
  delete: (url) => request(app).delete(url).set('x-test-user', user),
});

// A collection with one request that asserts a 200.
async function collectionFor(owner, name = 'API') {
  const collection = await collections.createCollection(owner, { name });
  await savedRequests.createSavedRequest(owner, {
    collectionId: collection._id,
    name: 'Health',
    method: 'GET',
    url: 'https://api.example.com/health',
    assertions: [{ source: 'status', operator: 'equals', expected: '200' }],
  });
  return collection;
}

async function monitorFor(owner, overrides = {}) {
  const collection = overrides.collection ?? (await collectionFor(owner));
  const res = await as(owner)
    .post('/api/monitors')
    .send({ name: 'Every 5 minutes', collectionId: collection._id, intervalMinutes: 5, ...overrides.body });
  expect(res.status).toBe(201);
  return res.body;
}

describe('managing monitors', () => {
  it('creates one that is due straight away, and lists it', async () => {
    const created = await monitorFor(ADA);
    expect(created).toMatchObject({ name: 'Every 5 minutes', intervalMinutes: 5, enabled: true, running: false });
    expect(new Date(created.nextRunAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(created).not.toHaveProperty('lockedUntil');

    const list = (await as(ADA).get('/api/monitors')).body;
    expect(list.map((m) => m._id)).toEqual([created._id]);
  });

  it('rejects bad input', async () => {
    const collection = await collectionFor(ADA);
    const bad = [
      { name: '', collectionId: collection._id, intervalMinutes: 5 },
      { name: 'x', collectionId: 'nope', intervalMinutes: 5 },
      { name: 'x', collectionId: collection._id, intervalMinutes: 1 },
      { name: 'x', collectionId: collection._id, intervalMinutes: 5, enabled: 'yes' },
    ];
    for (const body of bad) expect((await as(ADA).post('/api/monitors').send(body)).status).toBe(400);
  });

  it(`allows at most ${MAX_MONITORS_PER_ACCOUNT} per account`, async () => {
    const collection = await collectionFor(ADA);
    for (let i = 0; i < MAX_MONITORS_PER_ACCOUNT; i += 1) await monitorFor(ADA, { collection });
    const res = await as(ADA).post('/api/monitors').send({ name: 'one more', collectionId: collection._id, intervalMinutes: 5 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/up to 5 monitors/);
  });

  it('pauses, and resumes due at once', async () => {
    const monitor = await monitorFor(ADA);
    await Monitor.updateOne({ _id: monitor._id }, { $set: { nextRunAt: new Date(Date.now() + 60 * MIN) } });

    const paused = (await as(ADA).put(`/api/monitors/${monitor._id}`).send({ enabled: false })).body;
    expect(paused.enabled).toBe(false);
    expect(await claimNextDue(new Date(Date.now() + 120 * MIN))).toBeNull();

    const resumed = (await as(ADA).put(`/api/monitors/${monitor._id}`).send({ enabled: true })).body;
    expect(new Date(resumed.nextRunAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('is removed with its collection', async () => {
    const monitor = await monitorFor(ADA);
    await collections.deleteCollection(ADA, monitor.collectionId);
    expect(await Monitor.countDocuments()).toBe(0);
  });

});

describe('isolation', () => {
  it('cannot point at another account’s collection or environment', async () => {
    const adasCollection = await collectionFor(ADA);
    const adasEnv = await environments.createEnvironment(ADA, { name: 'Prod' });
    const mine = await collectionFor(MALLORY);

    expect(
      (await as(MALLORY).post('/api/monitors').send({ name: 'x', collectionId: adasCollection._id, intervalMinutes: 5 })).status,
    ).toBe(400);
    expect(
      (await as(MALLORY).post('/api/monitors').send({ name: 'x', collectionId: mine._id, environmentId: adasEnv._id, intervalMinutes: 5 })).status,
    ).toBe(400);
  });

  it('cannot be listed, changed, run or deleted by another account', async () => {
    const monitor = await monitorFor(ADA);
    expect((await as(MALLORY).get('/api/monitors')).body).toEqual([]);
    expect((await as(MALLORY).put(`/api/monitors/${monitor._id}`).send({ enabled: false })).status).toBe(404);
    expect((await as(MALLORY).post(`/api/monitors/${monitor._id}/run`)).status).toBe(404);
    expect((await as(MALLORY).delete(`/api/monitors/${monitor._id}`)).status).toBe(404);
    expect((await Monitor.findById(monitor._id)).enabled).toBe(true);
  });
});

describe('running', () => {
  it('"Run now" records an ordinary run, marked as the monitor’s', async () => {
    const monitor = await monitorFor(ADA);
    const after = (await as(ADA).post(`/api/monitors/${monitor._id}/run`)).body;

    expect(after).toMatchObject({ lastStatus: 'passed', lastError: null, running: false });
    const run = await TestRun.findById(after.lastRunId).lean();
    expect(run).toMatchObject({ trigger: 'monitor', monitorName: 'Every 5 minutes', status: 'passed' });
    expect(String(run.userId)).toBe(ADA);

    // Visible in Runs, filterable to this monitor.
    const runs = (await as(ADA).get(`/api/test-runs?monitorId=${monitor._id}`)).body;
    expect(runs).toHaveLength(1);
  });

  it('"Run now" restarts the schedule, so the scheduler does not run it again straight after', async () => {
    const monitor = await monitorFor(ADA); // due immediately
    const before = Date.now();
    const after = (await as(ADA).post(`/api/monitors/${monitor._id}/run`)).body;
    expect(new Date(after.nextRunAt).getTime()).toBeGreaterThanOrEqual(before + 5 * MIN);
    expect(await claimNextDue()).toBeNull();
  });

  it('records a failing assertion as failed', async () => {
    target.status = 500;
    const monitor = await monitorFor(ADA);
    const after = (await as(ADA).post(`/api/monitors/${monitor._id}/run`)).body;
    expect(after.lastStatus).toBe('failed');
  });

  it('refuses to start a second run while one is going', async () => {
    const monitor = await monitorFor(ADA);
    await Monitor.updateOne({ _id: monitor._id }, { $set: { lockedUntil: new Date(Date.now() + 5 * MIN) } });
    expect((await as(ADA).get('/api/monitors')).body[0].running).toBe(true);
    expect((await as(ADA).post(`/api/monitors/${monitor._id}/run`)).status).toBe(429);
  });

  it('is skipped, not failed, when the account already has the most runs going', async () => {
    const monitor = await monitorFor(ADA);
    const releases = [runGate.acquire(ADA), runGate.acquire(ADA)];
    try {
      const after = await executeMonitor(await Monitor.findById(monitor._id).lean());
      expect(after.lastStatus).toBe('skipped');
      expect(after.lastError).toMatch(/Skipped/);
    } finally {
      releases.forEach((release) => release());
    }
  });

  it('reports a deleted environment as an error the owner can act on', async () => {
    const env = await environments.createEnvironment(ADA, { name: 'Staging' });
    const monitor = await monitorFor(ADA, { body: { environmentId: env._id } });
    await environments.deleteEnvironment(ADA, env._id);

    const after = (await as(ADA).post(`/api/monitors/${monitor._id}/run`)).body;
    expect(after.lastStatus).toBe('error');
    expect(after.lastError).toMatch(/environment no longer exists/);
  });

  it('pauses itself if its collection disappears', async () => {
    const monitor = await monitorFor(ADA);
    // Removed behind the cascade's back, as an older database might have.
    await mongoose.connection.collection('collections').deleteMany({});
    const after = await executeMonitor(await Monitor.findById(monitor._id).lean());
    expect(after).toMatchObject({ enabled: false, lastStatus: 'error' });
  });

  it(`keeps only the newest ${RUNS_KEPT_PER_MONITOR} runs per monitor`, async () => {
    const monitor = await monitorFor(ADA);
    const old = Array.from({ length: RUNS_KEPT_PER_MONITOR + 2 }, (_, i) => ({
      userId: ADA,
      collectionId: monitor.collectionId,
      status: 'passed',
      startedAt: new Date(Date.now() - (i + 1) * MIN),
      completedAt: new Date(Date.now() - (i + 1) * MIN),
      requestCount: 1,
      trigger: 'monitor',
      monitorId: monitor._id,
    }));
    await TestRun.insertMany(old);
    await as(ADA).post(`/api/monitors/${monitor._id}/run`);
    expect(await TestRun.countDocuments({ monitorId: monitor._id })).toBe(RUNS_KEPT_PER_MONITOR);
  });
});

describe('the scheduler', () => {
  it('claims a due monitor once, and moves its next run on by the interval', async () => {
    const monitor = await monitorFor(ADA);
    const now = new Date();

    const claimed = await claimNextDue(now);
    expect(String(claimed._id)).toBe(monitor._id);
    expect(new Date(claimed.nextRunAt).getTime()).toBe(now.getTime() + 5 * MIN);
    // Locked and no longer due: a second claim — another tick, another server — gets nothing.
    expect(await claimNextDue(now)).toBeNull();
  });

  it('leaves monitors that are not due, and reclaims one whose run died', async () => {
    const monitor = await monitorFor(ADA);
    await Monitor.updateOne({ _id: monitor._id }, { $set: { nextRunAt: new Date(Date.now() + 10 * MIN) } });
    expect(await claimNextDue()).toBeNull();

    await Monitor.updateOne(
      { _id: monitor._id },
      { $set: { nextRunAt: new Date(Date.now() - MIN), lockedUntil: new Date(Date.now() - MIN) } },
    );
    expect(await claimNextDue()).not.toBeNull();
  });

  it('runs due monitors on its own, each as its owner', async () => {
    const adas = await monitorFor(ADA);
    const mallorys = await monitorFor(MALLORY);
    const stop = startMonitorScheduler({ tickMs: 60 * MIN });
    try {
      await vi.waitFor(
        async () => {
          const done = await Monitor.find({ lastStatus: 'passed' }).lean();
          expect(done).toHaveLength(2);
        },
        { timeout: 5000 },
      );
    } finally {
      stop();
    }
    for (const [monitor, owner] of [[adas, ADA], [mallorys, MALLORY]]) {
      const after = await Monitor.findById(monitor._id).lean();
      const run = await TestRun.findById(after.lastRunId).lean();
      expect(String(run.userId)).toBe(owner);
      expect(after.lockedUntil).toBeNull();
    }
  });
});

describe('alerts', () => {
  const run = (monitor) => as(ADA).post(`/api/monitors/${monitor._id}/run`);
  const events = () => sendMonitorAlertEmail.mock.calls.map(([args]) => args.event);

  it('emails the creator once when a monitor starts failing, and once when it recovers', async () => {
    const monitor = await monitorFor(ADA);
    await run(monitor); // passes: nothing to say
    expect(events()).toEqual([]);

    target.status = 500;
    await run(monitor);
    await run(monitor); // still failing: no second alert
    expect(events()).toEqual(['failed']);
    const [args] = sendMonitorAlertEmail.mock.calls[0];
    expect(args).toMatchObject({ to: 'ada@example.com', monitorName: 'Every 5 minutes', collectionName: 'API' });
    expect(args.failures).toEqual(['GET Health — Status Code equals 200, got 500']);

    target.status = 200;
    await run(monitor);
    await run(monitor);
    expect(events()).toEqual(['failed', 'recovered']);
  });

  it('treats a skipped run as no news', async () => {
    const monitor = await monitorFor(ADA);
    const releases = [runGate.acquire(ADA), runGate.acquire(ADA)];
    try {
      await executeMonitor(await Monitor.findById(monitor._id).lean());
    } finally {
      releases.forEach((release) => release());
    }
    expect(events()).toEqual([]);
    expect((await Monitor.findById(monitor._id)).alertState).toBe('ok');
  });

  it('alerts when a run cannot even start', async () => {
    const env = await environments.createEnvironment(ADA, { name: 'Staging' });
    const monitor = await monitorFor(ADA, { body: { environmentId: env._id } });
    await environments.deleteEnvironment(ADA, env._id);
    await run(monitor);
    expect(events()).toEqual(['failed']);
    expect(sendMonitorAlertEmail.mock.calls[0][0].failures[0]).toMatch(/environment no longer exists/);
  });

  it('stays quiet with email alerts off', async () => {
    const monitor = await monitorFor(ADA, { body: { alertEmail: false } });
    target.status = 500;
    await run(monitor);
    expect(events()).toEqual([]);
  });

  it('emails the workspace owner once the creator has left the workspace', async () => {
    const ws = await Workspace.create({ userId: MALLORY, name: 'Team', members: [{ userId: ADA, role: 'editor' }] });
    const collection = await collectionFor(ws._id);
    const created = await request(app)
      .post('/api/monitors')
      .set('x-test-user', ADA)
      .set('x-workspace-id', String(ws._id))
      .send({ name: 'Team monitor', collectionId: collection._id, intervalMinutes: 5 });
    expect(created.status).toBe(201);

    await Workspace.updateOne({ _id: ws._id }, { $set: { members: [] } }); // Ada left
    target.status = 500;
    await executeMonitor(await Monitor.findById(created.body._id).lean());
    expect(sendMonitorAlertEmail.mock.calls[0][0]).toMatchObject({ to: 'mallory@example.com', workspaceName: 'Team' });
  });

  it('keeps the webhook URL encrypted at rest and rejects unusable ones', async () => {
    const collection = await collectionFor(ADA);
    const base = { name: 'm', collectionId: collection._id, intervalMinutes: 5 };
    for (const alertWebhookUrl of ['ftp://x.test/hook', 'not a url', 'https://user:pw@hooks.test/x']) {
      expect((await as(ADA).post('/api/monitors').send({ ...base, alertWebhookUrl })).status).toBe(400);
    }

    const url = 'https://hooks.slack.com/services/T000/B000/secret';
    const created = (await as(ADA).post('/api/monitors').send({ ...base, alertWebhookUrl: url })).body;
    expect(created.alertWebhookUrl).toBe(url);
    const raw = await mongoose.connection.collection('monitors').findOne({ _id: new mongoose.Types.ObjectId(created._id) });
    expect(raw.alertWebhookUrl).not.toContain('secret');
  });

  it('sends a test alert and reports each channel', async () => {
    const monitor = await monitorFor(ADA);
    const res = await as(ADA).post(`/api/monitors/${monitor._id}/test-alert`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'sent', webhook: 'off' });
    expect(events()).toEqual(['test']);

    // A webhook pointing inside the network is refused by the SSRF guard, and says so.
    await as(ADA).put(`/api/monitors/${monitor._id}`).send({ alertEmail: false, alertWebhookUrl: 'http://127.0.0.1:9/hook' });
    const blocked = (await as(ADA).post(`/api/monitors/${monitor._id}/test-alert`)).body;
    expect(blocked.email).toBe('off');
    expect(blocked.webhook).toMatch(/^failed: .*(not allowed|private)/i);

    await as(ADA).put(`/api/monitors/${monitor._id}`).send({ alertWebhookUrl: '' });
    expect((await as(ADA).post(`/api/monitors/${monitor._id}/test-alert`)).status).toBe(400);
  });
});

describe('a monitor deleted while it runs', () => {
  it('leaves no orphaned run behind', async () => {
    const monitor = await monitorFor(ADA);
    const doc = await Monitor.findById(monitor._id).lean();
    await Monitor.deleteOne({ _id: monitor._id }); // removed mid-run
    expect(await executeMonitor(doc)).toBeNull();
    expect(await TestRun.countDocuments({ monitorId: monitor._id })).toBe(0);
  });
});
