import mongoose from 'mongoose';

const { Schema } = mongoose;

const websocketResultSchema = new Schema(
  {
    connectMs: Number,
    messagesSent: Number,
    messagesReceived: Number,
    reconnectAttempts: Number,
    durationMs: Number,
    // Per-step send/wait/assert detail, shaped by wsStepRunner.
    steps: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

// One step's outcome within a run. Keeps a response *summary* (status/time/size) rather
// than the full body/headers — the assertions/captures are the actual test signal, and
// this avoids a run's document size depending on arbitrary external API responses.
const testResultSchema = new Schema(
  {
    requestId: { type: Schema.Types.ObjectId, ref: 'Request' },
    requestName: { type: String, default: '' },
    // Absent on runs recorded before WebSocket existed, which is why it defaults to
    // 'rest' rather than being required — old runs must keep rendering.
    protocol: { type: String, default: 'rest' },
    method: { type: String, default: '' },
    url: { type: String, default: '' },
    // Which dataset row produced this result. Null on an ordinary run — and on every
    // run recorded before data-driven testing existed, which is why reports treat null
    // as "not iterated" rather than as iteration zero.
    iteration: { type: Number, default: null },
    // e.g. `email=ada@example.com`, so a failure names the row rather than its index.
    iterationLabel: { type: String, default: '' },
    success: { type: Boolean, required: true }, // did the HTTP execution itself succeed
    error: { type: String, default: null },
    response: {
      status: Number,
      time: Number,
      size: Number,
    },
    // WebSocket-only detail, and null on every other protocol rather than an empty
    // object — a REST result carrying a hollow `websocket` field would be noise that
    // reports then have to defend against. `response.time` above is still populated
    // for WebSocket steps so the dashboard's average spans every protocol.
    websocket: { type: websocketResultSchema, default: null },
    assertions: { type: Schema.Types.Mixed, default: null },
    captures: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const testRunSchema = new Schema(
  {
    /**
     * The account this belongs to.
     *
     * Required and indexed: every query filters on it, and a document without an owner
     * is unreachable by design rather than visible to everyone.
     */
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    collectionId: { type: Schema.Types.ObjectId, ref: 'Collection', required: true, index: true },
    collectionName: { type: String, default: '' },
    environmentId: { type: Schema.Types.ObjectId, ref: 'Environment', default: null },
    status: { type: String, enum: ['passed', 'failed', 'error'], required: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, required: true },
    // Denormalized from results.length so a history list can show step count without
    // fetching the (potentially much larger) embedded results array.
    requestCount: { type: Number, required: true },
    // 1 for an ordinary run, so history and dashboards can treat every run uniformly
    // without checking whether a dataset was involved.
    iterationCount: { type: Number, default: 1 },
    // Who started it: a person pressing Run, or a monitor on its schedule. Runs recorded
    // before monitors existed have no value and read as manual.
    trigger: { type: String, enum: ['manual', 'monitor'], default: 'manual' },
    monitorId: { type: Schema.Types.ObjectId, ref: 'Monitor', default: null },
    monitorName: { type: String, default: '' },
    results: [testResultSchema],
  },
  { timestamps: true },
);

// Compound indexes matching the list queries: owner first (every query filters on it),
// then the sort key, so a user's list is read in order from the index rather than
// sorted in memory after scanning.
testRunSchema.index({ userId: 1, startedAt: -1 });
testRunSchema.index({ userId: 1, collectionId: 1, startedAt: -1 });
// A monitor's own runs, newest first — read when trimming them to the newest N.
testRunSchema.index({ userId: 1, monitorId: 1, startedAt: -1 });

export const TestRun = mongoose.model('TestRun', testRunSchema);
