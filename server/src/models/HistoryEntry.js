import mongoose from 'mongoose';
import {
  keyValueRowSchema,
  bodySchema,
  authSchema,
  graphqlSchema,
  assertionSchema,
  captureSchema,
} from './Request.js';

const { Schema } = mongoose;

/**
 * Days a history entry is kept. Matches the per-account cap in historyService: history is
 * a scratchpad of recent sends, not an archive — saving to a collection is how a request
 * is kept for good.
 */
const HISTORY_RETENTION_DAYS = 30;

/**
 * One request the user sent by hand from the builder.
 *
 * Stores the request exactly as it was typed — {{variables}} unresolved — so reopening
 * it behaves like the original, and so values that live in environments are never
 * copied in here. Auth secrets are encrypted the same way saved requests are. The
 * response is reduced to a summary, as a test run does: bodies from arbitrary APIs
 * have no place in a list that is read on every page load.
 */
const historyEntrySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    protocol: { type: String, enum: ['rest', 'graphql'], default: 'rest' },
    method: { type: String, enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], required: true },
    url: { type: String, required: true },
    params: [keyValueRowSchema],
    headers: [keyValueRowSchema],
    body: { type: bodySchema, default: () => ({}) },
    graphql: { type: graphqlSchema, default: () => ({}) },
    auth: { type: authSchema, default: () => ({}) },
    assertions: [assertionSchema],
    captures: [captureSchema],
    // Set when the body was too large to keep; the entry reopens without it.
    bodyOmitted: { type: Boolean, default: false },

    // What came back. `status` is null when the request never got a response
    // (DNS failure, refused connection, timeout) — `error` then says why.
    status: { type: Number, default: null },
    time: { type: Number, default: null },
    size: { type: Number, default: null },
    error: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The list query: one account's entries, newest first.
historyEntrySchema.index({ userId: 1, createdAt: -1 });
// Old entries expire on their own, so an account that stops trimming still shrinks.
historyEntrySchema.index({ createdAt: 1 }, { expireAfterSeconds: HISTORY_RETENTION_DAYS * 24 * 60 * 60 });

export const HistoryEntry = mongoose.model('HistoryEntry', historyEntrySchema);
