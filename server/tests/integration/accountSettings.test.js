import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Every request here comes from one address; the sign-in limits have their own tests.
vi.mock('express-rate-limit', () => ({
  default: () => (_req, _res, next) => next(),
  rateLimit: () => (_req, _res, next) => next(),
  ipKeyGenerator: (ip) => ip,
}));
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Collection } from '../../src/models/Collection.js';
import { Workspace } from '../../src/models/Workspace.js';
import { WorkspaceInvite } from '../../src/models/WorkspaceInvite.js';
import { hashPassword } from '../../src/services/accounts/passwords.js';
import { setMailTransport } from '../../src/services/accounts/mailer.js';

/**
 * Account settings, against a real database and real sessions: the name, the password,
 * and deleting the account with everything it owns.
 */

const PASSWORD = 'correct horse battery';
let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  setMailTransport(async () => ({ captured: true }));
}, 60_000);

afterAll(async () => {
  setMailTransport(null);
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Collection.deleteMany({}), Workspace.deleteMany({}), WorkspaceInvite.deleteMany({})]);
});

async function account(email = 'ada@example.com', { password = PASSWORD, googleId = null } = {}) {
  return User.create({
    email,
    name: 'Ada',
    emailVerified: true,
    passwordHash: password ? await hashPassword(password) : null,
    passwordSetAt: password ? new Date(Date.now() - 1000) : null,
    googleId,
  });
}

async function signedIn(email = 'ada@example.com', password = PASSWORD) {
  const browser = request.agent(app);
  await browser.post('/api/accounts/login').send({ email, password }).expect(200);
  return browser;
}

describe('the name', () => {
  it('is changed, trimmed, and required', async () => {
    await account();
    const browser = await signedIn();

    const res = await browser.patch('/api/accounts/me').send({ name: '  Ada Lovelace ' }).expect(200);
    expect(res.body.user.name).toBe('Ada Lovelace');
    expect((await browser.patch('/api/accounts/me').send({ name: '   ' })).status).toBe(400);
    expect((await browser.patch('/api/accounts/me').send({ name: 'x'.repeat(81) })).status).toBe(400);
    // It goes into email subjects: no line breaks.
    expect((await browser.patch('/api/accounts/me').send({ name: 'Ada\r\nBcc: everyone' })).status).toBe(400);
  });

  it('cannot be changed without signing in', async () => {
    await request(app).patch('/api/accounts/me').send({ name: 'Mallory' }).expect(401);
  });
});

describe('the password', () => {
  it('needs the current one, and must actually change', async () => {
    await account();
    const browser = await signedIn();

    const wrong = await browser.post('/api/accounts/password').send({ currentPassword: 'not it at all', newPassword: 'a brand new passphrase' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toBe('Incorrect password. Try again.');

    const same = await browser.post('/api/accounts/password').send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(400);

    const weak = await browser.post('/api/accounts/password').send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(400);
  });

  it('changing it keeps this browser signed in and signs every other one out', async () => {
    await account();
    const laptop = await signedIn();
    const phone = await signedIn();

    await phone
      .post('/api/accounts/password')
      .send({ currentPassword: PASSWORD, newPassword: 'a brand new passphrase' })
      .expect(200);

    await phone.get('/api/collections').expect(200);
    await laptop.get('/api/collections').expect(401);
    await request(app).post('/api/accounts/login').send({ email: 'ada@example.com', password: PASSWORD }).expect(401);
    await signedIn('ada@example.com', 'a brand new passphrase');
  });

  it('is not changed without the current one — a missing one is refused like a wrong one', async () => {
    await account();
    const browser = await signedIn();
    const res = await browser.post('/api/accounts/password').send({ newPassword: 'a brand new passphrase' });
    expect(res.status).toBe(400);
    await signedIn(); // the old one still works
  });

  it('a Google-only account has no current password, so it cannot be changed here', async () => {
    const user = await account('grace@example.com', { password: null, googleId: 'g-1' });
    const agent = await googleSession(user);
    const res = await agent.post('/api/accounts/password').send({ currentPassword: '', newPassword: 'a brand new passphrase' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_PASSWORD');
    expect((await User.findById(user._id)).passwordSetAt).toBeNull();
  });
});

/**
 * A browser signed in as an account with no password (Google only). Google itself is not
 * reachable in a test, so the account is given a throwaway password to sign in with, and
 * the password is then removed — the session stays, as it would after a Google sign-in.
 */
async function googleSession(user) {
  user.passwordHash = await hashPassword('temporary sign-in phrase');
  user.passwordSetAt = new Date(Date.now() - 5000);
  await user.save();
  const browser = await signedIn(user.email, 'temporary sign-in phrase');
  await User.updateOne({ _id: user._id }, { passwordHash: null, passwordSetAt: null });
  return browser;
}

describe('deleting the account', () => {
  it('needs the password; a wrong one deletes nothing', async () => {
    await account();
    const browser = await signedIn();
    const res = await browser.delete('/api/accounts/me').send({ password: 'not it at all' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Incorrect password. Try again.');
    expect(await User.countDocuments()).toBe(1);
  });

  it('removes the account, its data and the workspaces it owns, and leaves other people’s', async () => {
    const ada = await account();
    const grace = await account('grace@example.com');
    const adaBrowser = await signedIn();
    const otherAdaBrowser = await signedIn();
    const graceBrowser = await signedIn('grace@example.com');

    await adaBrowser.post('/api/collections').send({ name: 'Ada’s APIs' }).expect(201);
    await graceBrowser.post('/api/collections').send({ name: 'Grace’s APIs' }).expect(201);

    // Ada owns a team Grace is in; Grace owns a team Ada is in.
    const adaTeam = await Workspace.create({ userId: ada._id, name: 'Ada team', members: [{ userId: grace._id, role: 'editor' }] });
    const graceTeam = await Workspace.create({ userId: grace._id, name: 'Grace team', members: [{ userId: ada._id, role: 'editor' }] });
    await Collection.create({ userId: adaTeam._id, name: 'Team collection' });
    await WorkspaceInvite.create({
      workspaceId: graceTeam._id,
      email: 'ada@example.com',
      role: 'viewer',
      invitedBy: grace._id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const summary = await adaBrowser.get('/api/accounts/me/deletion').expect(200);
    expect(summary.body).toEqual({ ownedWorkspaces: [{ name: 'Ada team', members: 1 }], memberOfWorkspaces: 1 });

    await adaBrowser.delete('/api/accounts/me').send({ password: PASSWORD }).expect(204);

    expect(await User.exists({ _id: ada._id })).toBeNull();
    expect(await Collection.countDocuments({ userId: ada._id })).toBe(0);
    expect(await Collection.countDocuments({ userId: adaTeam._id })).toBe(0);
    expect(await Workspace.exists({ _id: adaTeam._id })).toBeNull();
    expect((await Workspace.findById(graceTeam._id)).members).toHaveLength(0);
    expect(await WorkspaceInvite.countDocuments({ email: 'ada@example.com' })).toBe(0);

    // Grace keeps everything of hers.
    expect(await Collection.countDocuments({ userId: grace._id })).toBe(1);
    await graceBrowser.get('/api/collections').expect(200);

    // Ada is signed out everywhere, and there is no account to sign in to.
    await adaBrowser.get('/api/accounts/me').expect(401);
    await otherAdaBrowser.get('/api/collections').expect(401);
    const login = await request(app).post('/api/accounts/login').send({ email: 'ada@example.com', password: PASSWORD });
    expect(login.body.message).toBe('No account exists with this email.');
  });

  it('a Google-only account confirms by typing its email address', async () => {
    const user = await account('grace@example.com', { password: null, googleId: 'g-1' });
    const browser = await googleSession(user);

    const wrong = await browser.delete('/api/accounts/me').send({ email: 'someone@example.com' });
    expect(wrong.status).toBe(400);
    expect(await User.countDocuments()).toBe(1);

    await browser.delete('/api/accounts/me').send({ email: ' Grace@Example.com ' }).expect(204);
    expect(await User.countDocuments()).toBe(0);
  });
});
