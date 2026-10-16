/**
 * Scoped access to data that belongs to somebody.
 *
 * Every collection, request, folder, environment, global set, mock and test run is
 * owned by exactly one account, and no query may cross that line. Getting that right
 * 50-odd times by remembering to add `userId` to each filter is not a plan — one
 * missed filter and a user reads somebody else's saved bearer tokens.
 *
 * So services never touch an owned model directly. They go through `owned(Model, id)`,
 * which folds the owner into every filter it builds, and `tests/unit/ownership.test.js`
 * fails the build if a service imports an owned model and queries it straight.
 *
 * Two details carry most of the value:
 *
 *  - `findById` is deliberately absent. It cannot be scoped — that is the shape of
 *    every insecure-direct-object-reference bug there is. `byId()` replaces it and
 *    compiles down to findOne({ _id, userId }).
 *  - A missing owner throws. `{ userId: undefined }` is not a filter matching nothing;
 *    Mongoose drops it, and the query quietly returns the entire collection.
 */

function assertOwner(ownerId) {
  if (!ownerId) {
    throw new Error(
      'owned() needs an owner id. An undefined owner does not narrow a query — ' +
        'Mongoose drops the key and the query returns every document.',
    );
  }
  return ownerId;
}

export function owned(Model, ownerId) {
  const userId = assertOwner(ownerId);
  const scope = (filter = {}) => ({ ...filter, userId });

  return {
    find: (filter) => Model.find(scope(filter)),
    findOne: (filter) => Model.findOne(scope(filter)),

    /** The safe replacement for findById. */
    byId: (id) => Model.findOne(scope({ _id: id })),

    countDocuments: (filter) => Model.countDocuments(scope(filter)),
    distinct: (field, filter) => Model.distinct(field, scope(filter)),

    // Writes stamp the owner rather than trusting a caller-supplied one, so a payload
    // carrying someone else's userId cannot plant a document in their account.
    create: (doc) => Model.create({ ...doc, userId }),
    insertMany: (docs) => Model.insertMany(docs.map((d) => ({ ...d, userId }))),

    updateById: (id, update, options = {}) =>
      Model.findOneAndUpdate(scope({ _id: id }), update, { returnDocument: 'after', runValidators: true, ...options }),
    updateOne: (filter, update, options) => Model.updateOne(scope(filter), update, options),
    // A conditional update — e.g. "claim it only if nobody holds it" — still inside the owner.
    findOneAndUpdate: (filter, update, options = {}) =>
      Model.findOneAndUpdate(scope(filter), update, { returnDocument: 'after', runValidators: true, ...options }),
    updateMany: (filter, update, options) => Model.updateMany(scope(filter), update, options),

    deleteById: (id) => Model.findOneAndDelete(scope({ _id: id })),
    deleteMany: (filter) => Model.deleteMany(scope(filter)),
    findOneAndDelete: (filter) => Model.findOneAndDelete(scope(filter)),

    /**
     * Aggregation, with the owner match forced in as the first stage.
     *
     * First matters: a $match after a $group or $lookup filters results that were
     * already computed across everybody's data.
     */
    aggregate: (stages = []) => Model.aggregate([{ $match: { userId } }, ...stages]),
  };
}

/**
 * The models that carry an owner.
 *
 * The guard test reads this list, so adding a model here without giving it a `userId`
 * field — or querying it directly from a service — fails the build.
 */
export const OWNED_MODELS = [
  'Collection',
  'Request',
  'Folder',
  'Environment',
  'Global',
  'MockEndpoint',
  'TestRun',
  'GraphQLSchemaCache',
  'HistoryEntry',
  'Monitor',
];
