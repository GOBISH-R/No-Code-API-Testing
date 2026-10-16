import mongoose from 'mongoose';
import { GraphQLSchemaCache } from '../../models/GraphQLSchema.js';
import { owned } from '../owned.js';

// A pathological schema could otherwise approach MongoDB's 16MB document ceiling.
// Real-world schemas are far smaller; this refuses the outlier with a clear message
// instead of failing deep inside the driver.
export const MAX_SCHEMA_BYTES = 4 * 1024 * 1024;

export function schemaSizeOf(schema) {
  return Buffer.byteLength(JSON.stringify(schema), 'utf8');
}

// Caching is best-effort: introspection itself must keep working with no database,
// the same way executing a request does. A cache miss only costs a re-fetch.
// Every entry belongs to one account: a schema fetched with your credentials is yours.
export async function cacheSchema(ownerId, endpoint, schema) {
  if (mongoose.connection.readyState !== 1) return null;

  const scope = owned(GraphQLSchemaCache, ownerId);
  await scope.updateOne(
    { endpoint },
    { $set: { schema, fetchedAt: new Date() } },
    { upsert: true, runValidators: true },
  );
  return scope.findOne({ endpoint }).lean();
}

export async function getCachedSchema(ownerId, endpoint) {
  if (mongoose.connection.readyState !== 1) return null;
  return owned(GraphQLSchemaCache, ownerId).findOne({ endpoint }).lean();
}

export async function deleteCachedSchema(ownerId, endpoint) {
  if (mongoose.connection.readyState !== 1) return null;
  return owned(GraphQLSchemaCache, ownerId).findOneAndDelete({ endpoint }).lean();
}
