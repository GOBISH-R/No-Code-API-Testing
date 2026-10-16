import { Global } from '../../models/Global.js';
import { owned } from '../owned.js';

/**
 * Global variables are a singleton *per account* — one record each, created on first
 * read. What used to be `findOne({})` is now scoped, which is the whole difference
 * between "the globals" and "everyone's globals".
 */
export async function getGlobals(ownerId) {
  // One atomic upsert rather than read-then-create: two first loads racing each other
  // would otherwise both miss and both insert. The unique index on userId backs this up.
  await owned(Global, ownerId).updateOne(
    {},
    { $setOnInsert: { variables: [] } },
    { upsert: true },
  );
  return owned(Global, ownerId).findOne().lean();
}

export async function updateGlobals(ownerId, { variables }) {
  // upsert with an owner-scoped filter: the owner is in the filter, so a created
  // document carries it too and cannot land in anyone else's account.
  return owned(Global, ownerId).updateOne(
    {},
    { $set: { variables: variables || [] } },
    { upsert: true, runValidators: true },
  ).then(() => getGlobals(ownerId));
}
