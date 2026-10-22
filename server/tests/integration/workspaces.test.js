import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Signed in as the account x-test-user names, loaded from the database so the email
// (which invitations are matched on) is real. requireAuth and workspaceScope are real.
vi.mock('../../src/middleware/authenticate.js', async (importOriginal) => {
  const real = await importOriginal();
  const { User } = await import('../../src/models/User.js');
  return {
    ...real,
    attachUser: async (req, _res, next) => {
      const id = req.get('x-test-user');
      req.user = id ? await User.findById(id) : null;
      next();
    },
  };
});
vi.mock('../../src/services/accounts/mailer.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendWorkspaceInviteEmail: vi.fn(async () => ({ captured: true })),
}));

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Collection } from '../../src/models/Collection.js';
import { WorkspaceInvite } from '../../src/models/WorkspaceInvite.js';
import { sendWorkspaceInviteEmail } from '../../src/services/accounts/mailer.js';

let mongo;
let ada; // owner
let bob; // invited
let mallory; // never invited

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  sendWorkspaceInviteEmail.mockClear();
  ada = await User.create({ email: 'ada@example.com', emailVerified: true, name: 'Ada' });
  bob = await User.create({ email: 'bob@example.com', emailVerified: true, name: 'Bob' });
  mallory = await User.create({ email: 'mallory@example.com', emailVerified: true, name: 'Mallory' });
});

/** Requests as `user`, inside `workspace` when given. */
function as(user, workspace) {
  const wrap = (r) => {
    r.set('x-test-user', String(user._id));
    if (workspace) r.set('x-workspace-id', String(workspace));
    return r;
  };
  return {
    get: (url) => wrap(request(app).get(url)),
    post: (url) => wrap(request(app).post(url)),
    put: (url) => wrap(request(app).put(url)),
    delete: (url) => wrap(request(app).delete(url)),
  };
}

async function teamOf(owner = ada, name = 'Payments team') {
  const res = await as(owner).post('/api/workspaces').send({ name });
  expect(res.status).toBe(201);
  return res.body._id;
}

async function join(ws, user, role) {
  const invited = await as(ada).post(`/api/workspaces/${ws}/invites`).send({ email: user.email, role });
  expect(invited.status).toBe(201);
  const accepted = await as(user).post(`/api/workspaces/invites/${invited.body._id}/accept`);
  expect(accepted.status).toBe(200);
}

const names = (res) => res.body.map((c) => c.name);

describe('creating workspaces', () => {
  it('lists the ones you own and belong to, with your role', async () => {
    const ws = await teamOf();
    await join(ws, bob, 'viewer');
    expect((await as(ada).get('/api/workspaces')).body).toMatchObject([{ name: 'Payments team', role: 'owner', memberCount: 2 }]);
    expect((await as(bob).get('/api/workspaces')).body).toMatchObject([{ name: 'Payments team', role: 'viewer' }]);
    expect((await as(mallory).get('/api/workspaces')).body).toEqual([]);
  });

  it('needs a sensible name', async () => {
    for (const name of ['', '   ', 'x'.repeat(61), 'line\nbreak']) {
      expect((await as(ada).post('/api/workspaces').send({ name })).status).toBe(400);
    }
  });
});

describe('workspace data is separate from personal data', () => {
  it('keeps collections apart by which workspace is open', async () => {
    const ws = await teamOf();
    await as(ada).post('/api/collections').send({ name: 'Personal API' });
    await as(ada, ws).post('/api/collections').send({ name: 'Team API' });

    expect(names(await as(ada).get('/api/collections'))).toEqual(['Personal API']);
    expect(names(await as(ada, ws).get('/api/collections'))).toEqual(['Team API']);
  });

  it('shares the workspace’s collections with members — and nothing personal', async () => {
    const ws = await teamOf();
    await as(ada).post('/api/collections').send({ name: 'Personal API' });
    await as(ada, ws).post('/api/collections').send({ name: 'Team API' });
    await join(ws, bob, 'viewer');

    expect(names(await as(bob, ws).get('/api/collections'))).toEqual(['Team API']);
    expect(names(await as(bob).get('/api/collections'))).toEqual([]);
  });
});

describe('outsiders', () => {
  it('get nothing from any shared route, and the reason is a code the app can act on', async () => {
    const ws = await teamOf();
    await as(ada, ws).post('/api/collections').send({ name: 'Team API' });

    for (const url of ['/api/collections', '/api/environments', '/api/globals', '/api/test-runs', '/api/dashboard', '/api/monitors']) {
      const res = await as(mallory, ws).get(url);
      expect(res.status, url).toBe(403);
      expect(res.body.code).toBe('NOT_A_MEMBER');
    }
    expect((await as(mallory, ws).post('/api/requests/execute').send({ method: 'GET', url: 'https://example.com' })).status).toBe(403);
    expect((await as(mallory).get(`/api/workspaces/${ws}/members`)).status).toBe(404);
  });

  it('cannot use a malformed or made-up workspace id', async () => {
    expect((await as(ada, 'not-an-id').get('/api/collections')).status).toBe(403);
    expect((await as(ada, '64d000000000000000000009').get('/api/collections')).status).toBe(403);
  });
});

describe('invitations', () => {
  it('go only to the invited address, which can accept or decline', async () => {
    const ws = await teamOf();
    const invite = (await as(ada).post(`/api/workspaces/${ws}/invites`).send({ email: 'Bob@Example.com', role: 'editor' })).body;
    expect(sendWorkspaceInviteEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'bob@example.com', workspaceName: 'Payments team' }));

    expect((await as(bob).get('/api/workspaces/invites')).body).toMatchObject([{ workspaceName: 'Payments team', invitedBy: 'Ada', role: 'editor' }]);
    expect((await as(mallory).get('/api/workspaces/invites')).body).toEqual([]);
    // Someone else's invitation cannot be answered, even with its id.
    expect((await as(mallory).post(`/api/workspaces/invites/${invite._id}/accept`)).status).toBe(404);
    expect((await as(mallory, ws).get('/api/collections')).status).toBe(403);

    expect((await as(bob).post(`/api/workspaces/invites/${invite._id}/decline`)).status).toBe(204);
    expect(await WorkspaceInvite.countDocuments()).toBe(0);
    expect((await as(bob, ws).get('/api/collections')).status).toBe(403);
  });

  it('are refused for bad addresses, existing members and outsiders to the workspace', async () => {
    const ws = await teamOf();
    await join(ws, bob, 'viewer');
    expect((await as(ada).post(`/api/workspaces/${ws}/invites`).send({ email: 'nope', role: 'viewer' })).status).toBe(400);
    expect((await as(ada).post(`/api/workspaces/${ws}/invites`).send({ email: 'x@y.com', role: 'admin' })).status).toBe(400);
    expect((await as(ada).post(`/api/workspaces/${ws}/invites`).send({ email: 'bob@example.com', role: 'editor' })).status).toBe(400);
    expect((await as(ada).post(`/api/workspaces/${ws}/invites`).send({ email: 'ada@example.com', role: 'editor' })).status).toBe(400);
    // Only the owner invites.
    expect((await as(bob).post(`/api/workspaces/${ws}/invites`).send({ email: 'x@y.com', role: 'viewer' })).status).toBe(403);
  });

  it('go only to people who already have an account', async () => {
    const ws = await teamOf();
    const res = await as(ada).post(`/api/workspaces/${ws}/invites`).send({ email: 'stranger@example.com', role: 'viewer' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('No ApIForge account uses that email. Ask them to sign up first, then invite them.');
    expect(sendWorkspaceInviteEmail).not.toHaveBeenCalled();
    expect(await WorkspaceInvite.countDocuments()).toBe(0);
  });

  it('expire', async () => {
    const ws = await teamOf();
    const invite = (await as(ada).post(`/api/workspaces/${ws}/invites`).send({ email: 'bob@example.com', role: 'viewer' })).body;
    await WorkspaceInvite.updateOne({ _id: invite._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await as(bob).get('/api/workspaces/invites')).body).toEqual([]);
    expect((await as(bob).post(`/api/workspaces/invites/${invite._id}/accept`)).status).toBe(404);
  });
});

describe('roles', () => {
  it('lets a viewer read, send and run — but not change anything', async () => {
    const ws = await teamOf();
    const collection = (await as(ada, ws).post('/api/collections').send({ name: 'Team API' })).body;
    await as(ada, ws).post('/api/requests').send({ collectionId: collection._id, name: 'Blocked', method: 'GET', url: 'http://127.0.0.1/x' });
    await join(ws, bob, 'viewer');
    const viewer = as(bob, ws);

    expect((await viewer.get('/api/collections')).status).toBe(200);
    // Sending is allowed (refused here only by the SSRF guard, not by the role).
    expect((await viewer.post('/api/requests/execute').send({ method: 'GET', url: 'http://127.0.0.1/x' })).status).toBe(400);
    expect((await viewer.post(`/api/collections/${collection._id}/run`).send({})).status).toBe(201);

    for (const [method, url, body] of [
      ['post', '/api/collections', { name: 'Mine now' }],
      ['put', `/api/collections/${collection._id}`, { name: 'Renamed' }],
      ['delete', `/api/collections/${collection._id}`],
      ['post', '/api/environments', { name: 'Prod' }],
      ['put', '/api/globals', { variables: [] }],
      ['post', '/api/monitors', { name: 'm', collectionId: collection._id, intervalMinutes: 60 }],
    ]) {
      const res = await viewer[method](url).send(body);
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(res.body.code).toBe('VIEWER_READ_ONLY');
    }
    expect(await Collection.countDocuments({ userId: ws })).toBe(1);
  });

  it('lets an editor change the workspace’s data, but not its people or settings', async () => {
    const ws = await teamOf();
    await join(ws, bob, 'editor');
    const editor = as(bob, ws);

    expect((await editor.post('/api/collections').send({ name: 'Added by Bob' })).status).toBe(201);
    expect(names(await as(ada, ws).get('/api/collections'))).toEqual(['Added by Bob']);

    expect((await as(bob).put(`/api/workspaces/${ws}`).send({ name: 'Bob’s now' })).status).toBe(403);
    expect((await as(bob).delete(`/api/workspaces/${ws}`)).status).toBe(403);
    expect((await as(bob).delete(`/api/workspaces/${ws}/members/${ada._id}`)).status).toBe(403);
  });

  it('can be changed by the owner, taking effect on the next request', async () => {
    const ws = await teamOf();
    await join(ws, bob, 'viewer');
    expect((await as(bob, ws).post('/api/collections').send({ name: 'x' })).status).toBe(403);
    expect((await as(ada).put(`/api/workspaces/${ws}/members/${bob._id}`).send({ role: 'editor' })).status).toBe(200);
    expect((await as(bob, ws).post('/api/collections').send({ name: 'x' })).status).toBe(201);
  });

  it('shows pending invitations to the owner only', async () => {
    const ws = await teamOf();
    await join(ws, bob, 'editor');
    await as(ada).post(`/api/workspaces/${ws}/invites`).send({ email: 'mallory@example.com', role: 'viewer' });

    const ownerView = (await as(ada).get(`/api/workspaces/${ws}/members`)).body;
    expect(ownerView.members.map((m) => [m.name, m.role])).toEqual([['Ada', 'owner'], ['Bob', 'editor']]);
    expect(ownerView.invites.map((i) => i.email)).toEqual(['mallory@example.com']);
    expect((await as(bob).get(`/api/workspaces/${ws}/members`)).body.invites).toEqual([]);
  });
});

describe('leaving and removal', () => {
  it('ends a removed member’s access at once', async () => {
    const ws = await teamOf();
    await join(ws, bob, 'editor');
    expect((await as(ada).delete(`/api/workspaces/${ws}/members/${bob._id}`)).status).toBe(204);
    expect((await as(bob, ws).get('/api/collections')).status).toBe(403);
    expect((await as(bob).get('/api/workspaces')).body).toEqual([]);
  });

  it('lets a member leave, but not the owner', async () => {
    const ws = await teamOf();
    await join(ws, bob, 'viewer');
    expect((await as(bob).delete(`/api/workspaces/${ws}/members/${bob._id}`)).status).toBe(204);
    expect((await as(ada).delete(`/api/workspaces/${ws}/members/${ada._id}`)).status).toBe(400);
  });

  it('deletes everything in a workspace with it — and nothing else', async () => {
    const ws = await teamOf();
    await as(ada).post('/api/collections').send({ name: 'Personal API' });
    await as(ada, ws).post('/api/collections').send({ name: 'Team API' });
    await as(ada, ws).post('/api/environments').send({ name: 'Team env', variables: [] });
    await as(ada).post(`/api/workspaces/${ws}/invites`).send({ email: 'bob@example.com', role: 'viewer' });

    expect((await as(ada).delete(`/api/workspaces/${ws}`)).status).toBe(204);
    expect(await Collection.countDocuments({ userId: ws })).toBe(0);
    expect(await WorkspaceInvite.countDocuments()).toBe(0);
    expect(names(await as(ada).get('/api/collections'))).toEqual(['Personal API']);
    expect((await as(ada, ws).get('/api/collections')).status).toBe(403);
  });
});

describe('personal things stay personal', () => {
  it('keeps request history per person, whichever workspace they send from', async () => {
    const ws = await teamOf();
    await join(ws, bob, 'viewer');
    await as(bob, ws).post('/api/requests/execute').send({ method: 'GET', url: 'http://127.0.0.1/from-team' });

    expect((await as(bob).get('/api/history')).body.map((e) => e.url)).toEqual(['http://127.0.0.1/from-team']);
    expect((await as(ada).get('/api/history')).body).toEqual([]);
  });

  it('runs a workspace monitor on the workspace’s data, and refuses a personal collection', async () => {
    const ws = await teamOf();
    const team = (await as(ada, ws).post('/api/collections').send({ name: 'Team API' })).body;
    const personal = (await as(ada).post('/api/collections').send({ name: 'Personal API' })).body;

    expect((await as(ada, ws).post('/api/monitors').send({ name: 'team', collectionId: team._id, intervalMinutes: 60 })).status).toBe(201);
    expect((await as(ada, ws).post('/api/monitors').send({ name: 'x', collectionId: personal._id, intervalMinutes: 60 })).status).toBe(400);
    expect((await as(ada).get('/api/monitors')).body).toEqual([]);
  });
});

describe('copying and moving collections between spaces', () => {
  // A personal collection with a folder, a request inside it and a saved bearer token.
  async function personalCollection(owner = ada) {
    const collection = (await as(owner).post('/api/collections').send({ name: 'Orders API' })).body;
    const folder = (await as(owner).post('/api/folders').send({ collectionId: collection._id, name: 'v1' })).body;
    await as(owner).post('/api/requests').send({
      collectionId: collection._id,
      folderId: folder._id,
      name: 'List orders',
      method: 'GET',
      url: 'https://api.example.com/orders',
      auth: { type: 'bearer', bearer: { token: 'secret-token' } },
    });
    return collection;
  }

  const copy = (user, scope, id, body) => as(user, scope).post(`/api/collections/${id}/copy`).send(body);

  it('copies a personal collection into a team, with its folders, requests and credentials', async () => {
    const ws = await teamOf();
    const source = await personalCollection();

    const res = await copy(ada, null, source._id, { targetWorkspaceId: ws, mode: 'copy' });
    expect(res.status).toBe(201);
    expect(res.body.collection.name).toBe('Orders API');

    const [team] = (await as(ada, ws).get('/api/collections')).body;
    expect(team.requests.map((r) => r.name)).toEqual(['List orders']);
    expect(team.folders.map((f) => f.name)).toEqual(['v1']);
    const request = (await as(ada, ws).get(`/api/requests/${team.requests[0]._id}`)).body;
    expect(request.auth.bearer.token).toBe('secret-token');
    // A copy, so the original stays.
    expect(names(await as(ada).get('/api/collections'))).toEqual(['Orders API']);
  });

  it('moves a collection: there afterwards, gone from where it was', async () => {
    const ws = await teamOf();
    const source = await personalCollection();
    expect((await copy(ada, null, source._id, { targetWorkspaceId: ws, mode: 'move' })).status).toBe(201);
    expect(names(await as(ada).get('/api/collections'))).toEqual([]);
    expect(names(await as(ada, ws).get('/api/collections'))).toEqual(['Orders API']);
  });

  it('names a copy in the same space "(copy)", and refuses a move to where it already is', async () => {
    const source = await personalCollection();
    expect((await copy(ada, null, source._id, { mode: 'copy' })).body.collection.name).toBe('Orders API (copy)');
    expect((await copy(ada, null, source._id, { mode: 'move' })).status).toBe(400);
  });

  it('lets a viewer copy out to their own space, but not move it or add to the workspace', async () => {
    const ws = await teamOf();
    const team = (await as(ada, ws).post('/api/collections').send({ name: 'Team API' })).body;
    await join(ws, bob, 'viewer');

    expect((await copy(bob, ws, team._id, { targetWorkspaceId: null, mode: 'copy' })).status).toBe(201);
    expect(names(await as(bob).get('/api/collections'))).toEqual(['Team API']);

    expect((await copy(bob, ws, team._id, { targetWorkspaceId: null, mode: 'move' })).status).toBe(403);
    expect((await copy(bob, ws, team._id, { targetWorkspaceId: ws, mode: 'copy' })).status).toBe(403);
    expect(names(await as(ada, ws).get('/api/collections'))).toEqual(['Team API']);
  });

  it('cannot reach into a workspace you are not in, from either side', async () => {
    const ws = await teamOf();
    const team = (await as(ada, ws).post('/api/collections').send({ name: 'Team API' })).body;
    const mine = await personalCollection(mallory);

    // Reading Ada's team collection: refused by the workspace check.
    expect((await copy(mallory, ws, team._id, { targetWorkspaceId: null, mode: 'copy' })).status).toBe(403);
    // Pushing into Ada's team: refused as an unknown workspace.
    expect((await copy(mallory, null, mine._id, { targetWorkspaceId: ws, mode: 'copy' })).status).toBe(400);
    // Someone else's collection id from your own space is simply not found.
    expect((await copy(mallory, null, team._id, { mode: 'copy' })).status).toBe(404);
    expect(names(await as(ada, ws).get('/api/collections'))).toEqual(['Team API']);
  });
});
