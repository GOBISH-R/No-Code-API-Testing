import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { owned, OWNED_MODELS } from '../../src/services/owned.js';
import mongoose from 'mongoose';

// Importing the models registers their schemas, which the field check below reads.
import '../../src/models/Collection.js';
import '../../src/models/Request.js';
import '../../src/models/Folder.js';
import '../../src/models/Environment.js';
import '../../src/models/Global.js';
import '../../src/models/MockEndpoint.js';
import '../../src/models/TestRun.js';
import '../../src/models/GraphQLSchema.js';
import '../../src/models/HistoryEntry.js';
import '../../src/models/Monitor.js';

/**
 * The guard that makes an unscoped query fail the build.
 *
 * There are ~50 places that read or write owned data, and a single one without an
 * owner filter means a user reads somebody else's saved bearer tokens. Reviewing for
 * that by eye, forever, is not a control. These tests are.
 */

const SRC = path.resolve(import.meta.dirname, '../../src');

function readJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push({ path: full, source: fs.readFileSync(full, 'utf8') });
  }
  return out;
}

// Query methods that return or modify documents. If one of these is called straight on
// an owned model, nothing is filtering by owner.
const QUERY_METHODS = [
  'find', 'findOne', 'findById', 'findByIdAndUpdate', 'findByIdAndDelete',
  'findOneAndUpdate', 'findOneAndDelete', 'updateOne', 'updateMany',
  'deleteOne', 'deleteMany', 'countDocuments', 'aggregate', 'create', 'insertMany',
];

describe('every owned model carries an owner', () => {
  it.each(OWNED_MODELS)('%s has a required, indexed userId', (name) => {
    const schema = mongoose.model(name).schema;
    const userId = schema.path('userId');

    expect(userId, `${name} has no userId field`).toBeDefined();
    expect(userId.options.required, `${name}.userId must be required`).toBe(true);
    // Without an index every scoped query becomes a collection scan.
    expect(userId.options.index, `${name}.userId must be indexed`).toBe(true);
  });
});

describe('every owned model can list one account’s data from an index', () => {
  it.each(OWNED_MODELS)('%s has a compound index led by userId (or is one per account)', (name) => {
    const schema = mongoose.model(name).schema;
    // A model with a unique userId holds a single document per account; there is no
    // list to sort.
    if (schema.path('userId').options.unique) return;

    // The single-field userId index finds a user's documents; the compound one lets
    // them come back already sorted. Without it every list sorts in memory, and the
    // cost grows with the account rather than the page.
    const compound = schema
      .indexes()
      .filter(([fields]) => Object.keys(fields)[0] === 'userId' && Object.keys(fields).length > 1);
    expect(compound.length, `${name} needs an index like { userId: 1, createdAt: -1 }`).toBeGreaterThan(0);
  });
});

describe('owned() refuses to build an unscoped query', () => {
  it('throws when the owner is missing', () => {
    // The failure this prevents is the quiet one: `{ userId: undefined }` is not a
    // filter that matches nothing — Mongoose drops the key and returns everything.
    const Collection = mongoose.model('Collection');
    for (const missing of [undefined, null, '', 0, false]) {
      expect(() => owned(Collection, missing)).toThrow(/owner id/i);
    }
  });

  it('does not expose findById, which cannot be scoped', () => {
    // findById(id) is the shape of every insecure-direct-object-reference bug there
    // is. byId() replaces it and compiles to findOne({ _id, userId }).
    const scope = owned(mongoose.model('Collection'), new mongoose.Types.ObjectId());
    expect(scope.findById).toBeUndefined();
    expect(typeof scope.byId).toBe('function');
  });

  it('stamps the owner on writes rather than trusting the payload', () => {
    const ownerId = new mongoose.Types.ObjectId();
    const scope = owned(mongoose.model('Collection'), ownerId);

    // A create() carrying somebody else's userId must not be able to file the document
    // under their account. The helper spreads its own owner last.
    const Model = mongoose.model('Collection');
    const original = Model.create;
    let received;
    Model.create = async (doc) => {
      received = doc;
      return doc;
    };
    scope.create({ name: 'x', userId: 'an-attackers-id' });
    Model.create = original;

    expect(String(received.userId)).toBe(String(ownerId));
  });
});

/**
 * Deliberate cross-account reads, each one named and justified. Anything not listed here
 * still fails the test below. Keep this list short: every entry is a place where a
 * missing condition would reach another account's data.
 */
const CROSS_ACCOUNT_ALLOWED = {
  // The monitor scheduler has to find due monitors across every account. It only claims
  // one (a conditional update on that monitor's id) and then runs it as its owner via
  // owned() — see monitorScheduler.js and the tests in monitors.test.js.
  [path.join('monitors', 'monitorScheduler.js')]: ['Monitor.findOne', 'Monitor.findOneAndUpdate'],
};

describe('services never query an owned model directly', () => {
  const serviceFiles = readJsFiles(path.join(SRC, 'services'))
    // owned.js is the helper itself; it is the one place allowed to touch a model.
    .filter((f) => !f.path.endsWith(`${path.sep}owned.js`));

  it('finds no direct Model.query() call outside owned.js', () => {
    const offenders = [];

    for (const file of serviceFiles) {
      for (const model of OWNED_MODELS) {
        // The local identifier a model is imported under, e.g.
        // `import { Request as SavedRequest }`.
        const importMatch = file.source.match(
          new RegExp(`import\\s*\\{[^}]*\\b${model}\\b(?:\\s+as\\s+(\\w+))?[^}]*\\}`),
        );
        if (!importMatch) continue;
        const local = importMatch[1] || model;

        for (const method of QUERY_METHODS) {
          const direct = new RegExp(`\\b${local}\\.${method}\\s*\\(`);
          const allowed = CROSS_ACCOUNT_ALLOWED[path.relative(path.join(SRC, 'services'), file.path)] || [];
          if (direct.test(file.source) && !allowed.includes(`${local}.${method}`)) {
            offenders.push(`${path.relative(SRC, file.path)}: ${local}.${method}()`);
          }
        }
      }
    }

    expect(
      offenders,
      `These bypass owned() and are therefore unscoped:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
