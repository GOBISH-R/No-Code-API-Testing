import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { owned } from '../../src/services/owned.js';
import * as collections from '../../src/services/collections/collectionService.js';
import * as environments from '../../src/services/environments/environmentService.js';
import * as globals from '../../src/services/globals/globalService.js';
import * as mocks from '../../src/services/mocking/mockService.js';
import * as testRuns from '../../src/services/runner/testRunService.js';
import { getDashboardSummary } from '../../src/services/runner/dashboardService.js';
import { loadBaseVariables } from '../../src/services/variables/variableContext.js';
import * as savedRequests from '../../src/services/collections/savedRequestService.js';
import { exportCollection } from '../../src/importExport/collectionExporter.js';
import { importCollection } from '../../src/importExport/collectionImporter.js';
import * as folders from '../../src/services/collections/folderService.js';
import { User } from '../../src/models/User.js';
import { TestRun } from '../../src/models/TestRun.js';

/**
 * Two accounts, one database.
 *
 * This is the test the whole of D5 exists to pass. Every case asks the same question
 * from a different angle: can Mallory reach anything of Ada's? A pass here is the
 * difference between multi-user and a shared filing cabinet.
 *
 * Deliberately exercises the services directly rather than over HTTP — the auth gate
 * already has its own test, and what needs proving here is the layer beneath it, where
 * a single missing filter would leak regardless of how good the gate is.
 */

let mongo;
let ada;
let mallory;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );
  ada = await User.create({ email: 'ada@example.com', emailVerified: true, name: 'Ada' });
  mallory = await User.create({ email: 'mallory@example.com', emailVerified: true, name: 'Mallory' });
});

describe('collections', () => {
  it('lists only your own', async () => {
    await collections.createCollection(ada._id, { name: "Ada's API" });
    await collections.createCollection(mallory._id, { name: "Mallory's API" });

    const adaSees = await collections.listCollections(ada._id);
    expect(adaSees.map((c) => c.name)).toEqual(["Ada's API"]);
  });

  it('cannot be read by id across accounts', async () => {
    // The insecure-direct-object-reference case: Mallory has a real id and asks for it.
    const adas = await collections.createCollection(ada._id, { name: "Ada's API" });

    expect(await collections.getCollectionWithRequests(mallory._id, adas._id)).toBeNull();
  });

  it('cannot be updated across accounts', async () => {
    const adas = await collections.createCollection(ada._id, { name: "Ada's API" });

    expect(await collections.updateCollection(mallory._id, adas._id, { name: 'Taken' })).toBeNull();
    const after = await collections.getCollectionWithRequests(ada._id, adas._id);
    expect(after.name).toBe("Ada's API");
  });

  it('cannot be deleted across accounts', async () => {
    const adas = await collections.createCollection(ada._id, { name: "Ada's API" });

    expect(await collections.deleteCollection(mallory._id, adas._id)).toBeNull();
    expect(await collections.getCollectionWithRequests(ada._id, adas._id)).not.toBeNull();
  });

  it('does not leak requests through a collection id', async () => {
    // Even holding Ada's collection id, the child query is scoped too.
    const adas = await collections.createCollection(ada._id, { name: "Ada's API" });
    await savedRequests.createSavedRequest(ada._id, {
      collectionId: adas._id,
      name: 'Secret',
      protocol: 'rest',
      method: 'GET',
      url: 'https://api.example.com/x',
    });

    const mallorySees = await collections.listCollections(mallory._id);
    expect(mallorySees).toEqual([]);
  });
});

describe('saved requests', () => {
  it('hides the stored credentials of another account', async () => {
    // The concrete harm: a saved request carries a bearer token in plaintext.
    const adas = await collections.createCollection(ada._id, { name: "Ada's API" });
    const saved = await savedRequests.createSavedRequest(ada._id, {
      collectionId: adas._id,
      name: 'Authed',
      protocol: 'rest',
      method: 'GET',
      url: 'https://api.example.com/me',
      auth: { type: 'bearer', bearer: { token: 'sk-live-SECRET' } },
    });

    expect(await savedRequests.getSavedRequest(mallory._id, saved._id)).toBeNull();
  });

  it('cannot be updated or deleted across accounts', async () => {
    const adas = await collections.createCollection(ada._id, { name: "Ada's API" });
    const saved = await savedRequests.createSavedRequest(ada._id, {
      collectionId: adas._id,
      name: 'Mine',
      protocol: 'rest',
      method: 'GET',
      url: 'https://api.example.com/x',
    });

    expect(await savedRequests.updateSavedRequest(mallory._id, saved._id, { name: 'Yours' })).toBeNull();
    expect(await savedRequests.deleteSavedRequest(mallory._id, saved._id)).toBeNull();
    expect(await savedRequests.getSavedRequest(ada._id, saved._id)).not.toBeNull();
  });
});

describe('environments and globals', () => {
  it('lists only your own environments', async () => {
    await environments.createEnvironment(ada._id, {
      name: 'Prod',
      variables: [{ key: 'apiKey', value: 'ada-secret', enabled: true }],
    });

    expect(await environments.listEnvironments(mallory._id)).toEqual([]);
  });

  it('cannot read another account’s environment by id', async () => {
    const env = await environments.createEnvironment(ada._id, { name: 'Prod', variables: [] });
    expect(await environments.getEnvironment(mallory._id, env._id)).toBeNull();
  });

  it('gives each account its own globals rather than one shared record', async () => {
    // These used to be a true singleton — findOne({}) with no filter.
    await globals.updateGlobals(ada._id, {
      variables: [{ key: 'token', value: 'ada-token', enabled: true }],
    });
    await globals.updateGlobals(mallory._id, {
      variables: [{ key: 'token', value: 'mallory-token', enabled: true }],
    });

    const adaGlobals = await globals.getGlobals(ada._id);
    const malloryGlobals = await globals.getGlobals(mallory._id);

    expect(adaGlobals.variables[0].value).toBe('ada-token');
    expect(malloryGlobals.variables[0].value).toBe('mallory-token');
  });

  it('resolves variables from your own account only', async () => {
    await globals.updateGlobals(ada._id, {
      variables: [{ key: 'shared', value: 'ada-value', enabled: true }],
    });

    const malloryVars = await loadBaseVariables(mallory._id, null);
    expect(malloryVars.shared).toBeUndefined();
  });
});

describe('mocks', () => {
  it('lists only your own', async () => {
    await mocks.createMock(ada._id, { method: 'GET', path: '/users', body: 'ada' });
    expect(await mocks.listMocks(mallory._id)).toEqual([]);
  });

  it('serves each account’s mocks under its own key, so identical paths do not collide', async () => {
    // Both define GET /users. Without the key namespace one would answer for both.
    await mocks.createMock(ada._id, { method: 'GET', path: '/users', body: 'ada-data' });
    await mocks.createMock(mallory._id, { method: 'GET', path: '/users', body: 'mallory-data' });

    const adaMocks = await mocks.listEnabledMocksByKey(ada.mockKey);
    const malloryMocks = await mocks.listEnabledMocksByKey(mallory.mockKey);

    expect(adaMocks.map((m) => m.body)).toEqual(['ada-data']);
    expect(malloryMocks.map((m) => m.body)).toEqual(['mallory-data']);
  });

  it('returns nothing for an unknown key instead of erroring', async () => {
    // A wrong key must look like "no such mock", not like "no such account" — the
    // difference would let someone probe for valid keys.
    await mocks.createMock(ada._id, { method: 'GET', path: '/users', body: 'ada' });
    expect(await mocks.listEnabledMocksByKey('not-a-real-key')).toEqual([]);
    expect(await mocks.listEnabledMocksByKey(undefined)).toEqual([]);
  });
});

describe('test runs and the dashboard', () => {
  async function seedRun(user, status) {
    return owned(TestRun, user._id).create({
      collectionId: new mongoose.Types.ObjectId(),
      collectionName: 'Suite',
      status,
      startedAt: new Date(),
      completedAt: new Date(),
      requestCount: 1,
      results: [{ requestName: 'x', success: status === 'passed', response: { time: 100 } }],
    });
  }

  it('lists only your own runs', async () => {
    await seedRun(ada, 'passed');
    await seedRun(mallory, 'failed');

    const adaRuns = await testRuns.listTestRuns(ada._id, {});
    expect(adaRuns).toHaveLength(1);
    expect(adaRuns[0].status).toBe('passed');
  });

  it('cannot fetch another account’s run by id', async () => {
    const run = await seedRun(ada, 'passed');
    expect(await testRuns.getTestRun(mallory._id, run._id)).toBeNull();
  });

  it('counts only your own runs in the dashboard', async () => {
    // Aggregations are the quiet failure: an unscoped $match averages everyone's data
    // into a number that looks perfectly plausible.
    await seedRun(ada, 'passed');
    await seedRun(ada, 'passed');
    await seedRun(mallory, 'failed');
    await seedRun(mallory, 'failed');
    await seedRun(mallory, 'failed');

    const adaDash = await getDashboardSummary(ada._id, {});
    expect(adaDash.totalRuns).toBe(2);
    expect(adaDash.passed).toBe(2);
    expect(adaDash.failed).toBe(0);

    const malloryDash = await getDashboardSummary(mallory._id, {});
    expect(malloryDash.totalRuns).toBe(3);
    expect(malloryDash.failed).toBe(3);
  });

  it('keeps the pass rate per account rather than across the database', async () => {
    await seedRun(ada, 'passed');
    await seedRun(mallory, 'failed');

    expect((await getDashboardSummary(ada._id, {})).passRate).toBe(1);
    expect((await getDashboardSummary(mallory._id, {})).passRate).toBe(0);
  });
});

describe('a caller cannot choose the owner', () => {
  it('ignores a userId in the payload on create', async () => {
    // A crafted request body must not be able to file a document into another account,
    // which would be a write-side leak rather than a read-side one.
    const created = await collections.createCollection(ada._id, {
      name: 'Planted',
      userId: mallory._id,
    });

    expect(String(created.userId)).toBe(String(ada._id));
    expect(await collections.listCollections(mallory._id)).toEqual([]);
  });
});

describe('credentials are encrypted at rest', () => {
  it('stores no plaintext token in the database document', async () => {
    // The threat this addresses is a database dump or a stolen backup. So the check is
    // deliberately made against the raw collection, bypassing every service and model
    // getter — this is what someone reading the disk would actually see.
    const adas = await collections.createCollection(ada._id, { name: 'Authed' });
    await savedRequests.createSavedRequest(ada._id, {
      collectionId: adas._id,
      name: 'Secret',
      protocol: 'rest',
      method: 'GET',
      url: 'https://api.example.com/me',
      auth: {
        type: 'oauth2',
        basic: { username: 'ada', password: 'PLAINTEXT-PASSWORD' },
        bearer: { token: 'PLAINTEXT-BEARER' },
        apiKey: { key: 'X-Api-Key', value: 'PLAINTEXT-APIKEY', addTo: 'header' },
        oauth2: {
          clientId: 'public-id',
          clientSecret: 'PLAINTEXT-CLIENTSECRET',
          accessToken: 'PLAINTEXT-ACCESS',
          refreshToken: 'PLAINTEXT-REFRESH',
        },
      },
    });

    const raw = await mongoose.connection.db.collection('requests').findOne({ name: 'Secret' });
    const dumped = JSON.stringify(raw);

    for (const secret of [
      'PLAINTEXT-PASSWORD',
      'PLAINTEXT-BEARER',
      'PLAINTEXT-APIKEY',
      'PLAINTEXT-CLIENTSECRET',
      'PLAINTEXT-ACCESS',
      'PLAINTEXT-REFRESH',
    ]) {
      expect(dumped, `${secret} is readable in the raw document`).not.toContain(secret);
    }

    // Non-secrets stay readable, so the row is still debuggable.
    expect(raw.auth.basic.username).toBe('ada');
    expect(raw.auth.oauth2.clientId).toBe('public-id');
  });

  it('gives the owner their secrets back, decrypted', async () => {
    const adas = await collections.createCollection(ada._id, { name: 'Authed' });
    const created = await savedRequests.createSavedRequest(ada._id, {
      collectionId: adas._id,
      name: 'Secret',
      protocol: 'rest',
      method: 'GET',
      url: 'https://api.example.com/me',
      auth: { type: 'bearer', bearer: { token: 'sk-live-READABLE' } },
    });

    // On create, on fetch by id, and through the sidebar listing — all three paths.
    expect(created.auth.bearer.token).toBe('sk-live-READABLE');

    const fetched = await savedRequests.getSavedRequest(ada._id, created._id);
    expect(fetched.auth.bearer.token).toBe('sk-live-READABLE');

    const [listed] = await collections.listCollections(ada._id);
    expect(listed.requests[0].auth.bearer.token).toBe('sk-live-READABLE');
  });

  it('does not hand another account the ciphertext either', async () => {
    const adas = await collections.createCollection(ada._id, { name: 'Authed' });
    await savedRequests.createSavedRequest(ada._id, {
      collectionId: adas._id,
      name: 'Secret',
      protocol: 'rest',
      method: 'GET',
      url: 'https://api.example.com/me',
      auth: { type: 'bearer', bearer: { token: 'sk-live-READABLE' } },
    });

    expect(await collections.listCollections(mallory._id)).toEqual([]);
  });
});

describe('GraphQL schema cache', () => {
  it('never serves one account’s cached schema to another, even for the same URL', async () => {
    // Introspection often runs with your own credentials against a private API, so the
    // schema it returns is yours. It used to be cached by URL alone and shared.
    const { cacheSchema, getCachedSchema } = await import('../../src/services/graphql/schemaService.js');
    const url = 'https://internal.example.com/graphql';

    await cacheSchema(ada._id, url, { queryType: { name: 'AdaPrivateQuery' } });

    expect(await getCachedSchema(mallory._id, url)).toBeNull();
    expect((await getCachedSchema(ada._id, url)).schema.queryType.name).toBe('AdaPrivateQuery');
  });

  it('lets two accounts cache the same URL separately', async () => {
    const { cacheSchema, getCachedSchema } = await import('../../src/services/graphql/schemaService.js');
    const url = 'https://countries.example.com/graphql';

    await cacheSchema(ada._id, url, { v: 'ada' });
    await cacheSchema(mallory._id, url, { v: 'mallory' });

    expect((await getCachedSchema(ada._id, url)).schema.v).toBe('ada');
    expect((await getCachedSchema(mallory._id, url)).schema.v).toBe('mallory');
  });
});

describe('globals under concurrent first load', () => {
  it('creates exactly one record when several tabs load at once', async () => {
    const { getGlobals } = await import('../../src/services/globals/globalService.js');
    const { Global } = await import('../../src/models/Global.js');
    await Global.init();
    await Global.deleteMany({ userId: ada._id });

    const results = await Promise.all(Array.from({ length: 8 }, () => getGlobals(ada._id)));

    expect(new Set(results.map((g) => String(g._id))).size).toBe(1);
    expect(await Global.countDocuments({ userId: ada._id })).toBe(1);
  });
});

describe('export and import', () => {
  // These live outside services/, so they were missed when accounts arrived: export
  // looked the collection up with the wrong arguments (so found nothing) and import
  // crashed. The round trip is the test that would have caught it.
  async function adasCollectionWithAFolder() {
    const col = await collections.createCollection(ada._id, { name: "Ada's API" });
    const folder = await folders.createFolder(ada._id, { collectionId: col._id, name: 'Users' });
    await savedRequests.createSavedRequest(ada._id, {
      name: 'Get user', collectionId: col._id, folderId: folder._id, protocol: 'rest', method: 'GET', url: 'https://example.com/users/1',
    });
    return col;
  }

  it('round-trips a collection, folders included, within one account', async () => {
    const col = await adasCollectionWithAFolder();
    const file = await exportCollection(ada._id, col._id);
    expect(file.collection.requests).toHaveLength(1);
    expect(file.collection.requests[0].folderPath).toBe('Users');

    const copy = await importCollection(ada._id, file, { name: 'Copy' });
    expect(copy.name).toBe('Copy');
    expect(copy.requests).toHaveLength(1);
    expect(copy.folders.map((f) => f.name)).toEqual(['Users']);
    expect((await collections.listCollections(ada._id)).map((c) => c.name).sort()).toEqual(["Ada's API", 'Copy']);
  });

  it("will not export someone else's collection", async () => {
    const col = await adasCollectionWithAFolder();
    expect(await exportCollection(mallory._id, col._id)).toBeNull();
  });

  it("files an import under the importer's account only", async () => {
    const col = await adasCollectionWithAFolder();
    const file = await exportCollection(ada._id, col._id);
    await importCollection(mallory._id, file);

    expect(await collections.listCollections(mallory._id)).toHaveLength(1);
    expect(await collections.listCollections(ada._id)).toHaveLength(1);
  });
});
