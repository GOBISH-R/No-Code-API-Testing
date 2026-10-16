import mongoose from 'mongoose';

const { Schema } = mongoose;

// A cached introspection result, keyed by the *resolved* endpoint URL.
//
// Resolved rather than templated on purpose: `{{baseUrl}}/graphql` pointing at staging
// and at production are genuinely different schemas, and keying on the resolved URL
// keeps them separate instead of letting one overwrite the other.
//
// `schema` holds the raw introspection `__schema` object rather than anything derived,
// because every consumer (viewer, validation, autocomplete, docs) rebuilds its own
// representation from it via graphql's buildClientSchema.
const graphqlSchemaSchema = new Schema(
  {
    /**
     * Whose cache entry this is. Introspection is often run with the user's own
     * credentials against a private API, so one user's cached schema must never be
     * served to another — even for the same URL.
     */
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true },
    schema: { type: Schema.Types.Mixed, required: true },
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// One entry per user per endpoint — the pair, not the endpoint alone, is unique.
graphqlSchemaSchema.index({ userId: 1, endpoint: 1 }, { unique: true });

export const GraphQLSchemaCache = mongoose.model('GraphQLSchemaCache', graphqlSchemaSchema);
