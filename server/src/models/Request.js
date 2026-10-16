import mongoose from 'mongoose';

const { Schema } = mongoose;

// Mirrors the request-configuration shape used throughout the app (Request Builder,
// /api/requests/execute) so saved requests round-trip without transformation.

export const keyValueRowSchema = new Schema(
  {
    key: { type: String, default: '' },
    value: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
);

// `raw` backs the json/text modes (the literal text the user typed); `rows` backs
// urlencoded, which is key/value shaped like params and headers. Only the field
// belonging to the active mode is ever sent — see buildAxiosConfig.
/**
 * One multipart/form-data field: text, or a file.
 *
 * A file row keeps only what describes the file — name, type, size — never its bytes.
 * The browser sends the bytes with each send and they are used once; a saved request,
 * a history entry or an export holds no file content (the schema has nowhere to put
 * it, so it is dropped on save), and the file is picked again after reopening.
 */
const formRowSchema = new Schema(
  {
    key: { type: String, default: '' },
    value: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    type: { type: String, enum: ['text', 'file'], default: 'text' },
    fileName: { type: String, default: '' },
    fileType: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
  },
  { _id: false },
);

export const bodySchema = new Schema(
  {
    mode: { type: String, enum: ['none', 'json', 'urlencoded', 'text', 'formdata'], default: 'none' },
    raw: { type: String, default: '' },
    rows: [keyValueRowSchema],
    // Backs the formdata mode.
    form: [formRowSchema],
  },
  { _id: false },
);

export const authSchema = new Schema(
  {
    type: { type: String, enum: ['none', 'basic', 'bearer', 'apiKey', 'oauth2'], default: 'none' },
    basic: {
      username: { type: String, default: '' },
      password: { type: String, default: '' },
    },
    bearer: {
      token: { type: String, default: '' },
    },
    apiKey: {
      key: { type: String, default: '' },
      value: { type: String, default: '' },
      addTo: { type: String, enum: ['header', 'query'], default: 'header' },
    },
    // Two grant types. Client Credentials (default) is fetched fresh on every send —
    // no user, no browser. Authorization Code needs a one-time browser consent step
    // (see oauth.controller.js), so its resulting accessToken/refreshToken are stored
    // here and reused until they expire, rather than re-fetched per send.
    oauth2: {
      grantType: {
        type: String,
        enum: ['clientCredentials', 'authorizationCode'],
        default: 'clientCredentials',
      },
      tokenUrl: { type: String, default: '' },
      clientId: { type: String, default: '' },
      clientSecret: { type: String, default: '' },
      scope: { type: String, default: '' },
      authUrl: { type: String, default: '' },
      redirectUri: { type: String, default: '' },
      accessToken: { type: String, default: '' },
      refreshToken: { type: String, default: '' },
      expiresAt: { type: Number, default: 0 },
    },
  },
  { _id: false },
);

export const assertionSchema = new Schema(
  {
    source: { type: String, enum: ['status', 'json', 'header', 'time'], required: true },
    operator: { type: String, required: true },
    expected: { type: String, default: '' },
    path: { type: String, default: '' },
    headerName: { type: String, default: '' },
  },
  { _id: false },
);

export const captureSchema = new Schema(
  {
    source: { type: String, enum: ['status', 'json', 'header', 'time'], required: true },
    variableName: { type: String, required: true, trim: true },
    path: { type: String, default: '' },
    headerName: { type: String, default: '' },
  },
  { _id: false },
);

// GraphQL is always sent as a POST with a JSON body the execution engine builds from
// these three fields — `method`/`body` above are unused in this mode (see
// executionEngine.js). variables is stored as a raw JSON string, the same convention
// body.raw already uses, rather than a parsed object, so it round-trips through the
// same "raw text the user typed" path as everything else.
export const graphqlSchema = new Schema(
  {
    query: { type: String, default: '' },
    variables: { type: String, default: '' },
    operationName: { type: String, default: '' },
  },
  { _id: false },
);

// WebSocket assertions read different things from a connection than an HTTP response
// does, so they carry their own source list. The *shape* is identical to the HTTP
// assertion above because it is evaluated by the same engine — only what can be
// pointed at differs.
const wsAssertionSchema = new Schema(
  {
    source: {
      type: String,
      enum: ['message', 'json', 'messageType', 'messageSize', 'messageCount', 'connection', 'closeCode', 'closeReason'],
      required: true,
    },
    operator: { type: String, required: true },
    expected: { type: String, default: '' },
    path: { type: String, default: '' },
  },
  { _id: false },
);

const wsCaptureSchema = new Schema(
  {
    source: {
      type: String,
      enum: ['message', 'json', 'messageType', 'messageSize', 'messageCount', 'connection', 'closeCode', 'closeReason'],
      required: true,
    },
    variableName: { type: String, required: true, trim: true },
    path: { type: String, default: '' },
  },
  { _id: false },
);

// One send/wait/assert/capture cycle. A WebSocket step is a *script* rather than a
// single exchange: a realistic test subscribes, waits for an acknowledgement, sends
// again and checks what comes back, all over one connection.
const wsStepSchema = new Schema(
  {
    name: { type: String, default: '' },
    send: { type: String, default: '' },
    waitFor: {
      strategy: { type: String, default: 'next' },
      value: { type: String, default: '' },
      path: { type: String, default: '' },
      timeoutMs: { type: Number, default: 10000 },
    },
    assertions: [wsAssertionSchema],
    captures: [wsCaptureSchema],
  },
  { _id: false },
);

const websocketSchema = new Schema(
  {
    subprotocols: { type: String, default: '' },
    reconnect: {
      enabled: { type: Boolean, default: false },
      maxRetries: { type: Number, default: 3 },
      delayMs: { type: Number, default: 1000 },
    },
    heartbeat: {
      enabled: { type: Boolean, default: false },
      intervalMs: { type: Number, default: 30000 },
      timeoutMs: { type: Number, default: 10000 },
    },
    // GraphQL subscriptions ride on this same WebSocket transport via the graphql-ws
    // subprotocol. Queries and mutations stay on HTTP — only subscriptions need a
    // persistent connection.
    graphql: {
      enabled: { type: Boolean, default: false },
      query: { type: String, default: '' },
      variables: { type: String, default: '' },
      operationName: { type: String, default: '' },
      timeoutMs: { type: Number, default: 10000 },
    },
    steps: [wsStepSchema],
  },
  { _id: false },
);

const requestSchema = new Schema(
  {
    /**
     * The account this belongs to.
     *
     * Required and indexed: every query filters on it, and a document without an owner
     * is unreachable by design rather than visible to everyone.
     */
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    collectionId: { type: Schema.Types.ObjectId, ref: 'Collection', required: true, index: true },
    // null / absent means the request sits at the collection's root. Requests saved
    // before folders existed have no folderId and therefore render at the root.
    folderId: { type: Schema.Types.ObjectId, ref: 'Folder', default: null, index: true },
    name: { type: String, required: true, trim: true },
    protocol: { type: String, enum: ['rest', 'graphql', 'websocket'], default: 'rest' },
    // A WebSocket connection has no HTTP method, so the requirement is conditional
    // rather than absolute. REST and GraphQL are unaffected.
    method: {
      type: String,
      enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      required: function requiresMethod() {
        return this.protocol !== 'websocket';
      },
    },
    url: { type: String, required: true },
    params: [keyValueRowSchema],
    headers: [keyValueRowSchema],
    body: { type: bodySchema, default: () => ({}) },
    graphql: { type: graphqlSchema, default: () => ({}) },
    websocket: { type: websocketSchema, default: () => ({}) },
    auth: { type: authSchema, default: () => ({}) },
    assertions: [assertionSchema],
    captures: [captureSchema],
  },
  { timestamps: true },
);

// Compound indexes matching the list queries: owner first (every query filters on it),
// then the sort key, so a user's list is read in order from the index rather than
// sorted in memory after scanning.
requestSchema.index({ userId: 1, collectionId: 1, createdAt: 1 });
requestSchema.index({ userId: 1, createdAt: 1 });

export const Request = mongoose.model('Request', requestSchema);
