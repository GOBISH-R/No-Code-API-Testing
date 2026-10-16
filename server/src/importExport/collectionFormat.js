// The portable on-disk shape for an exported collection. Deliberately carries no
// database ids — an export is a definition, not a copy of our records, so importing
// it anywhere (including back into this same instance) creates fresh documents.

export const FORMAT = 'visual-api-testing-suite.collection';
export const VERSION = 1;

// A hard ceiling on how much one import may create, independent of the global 1mb
// body limit — a small payload could still describe a lot of documents.
export const MAX_IMPORT_REQUESTS = 500;

const ROW_FIELDS = ['key', 'value', 'enabled'];
// A file field travels as its description only: an export never carries file contents.
const FORM_ROW_FIELDS = ['key', 'value', 'enabled', 'type', 'fileName', 'fileType', 'fileSize'];

function pickRows(rows) {
  return (rows || []).map((row) =>
    ROW_FIELDS.reduce((acc, field) => ({ ...acc, [field]: row[field] }), {}),
  );
}

// Folder membership travels as a "/"-separated path rather than an id, for the same
// reason nothing else here carries ids: a path is a definition that survives being
// imported anywhere, while an id is only meaningful in the database it came from.
// Folder names are validated to contain no "/", so a path is unambiguous.
// Omitted (or "") means the request sits at the collection's root — which is exactly
// what older export files, written before folders existed, look like.
export const FOLDER_PATH_SEPARATOR = '/';

// Mongoose documents carry _id/__v/timestamps; strip to just the definition so the
// exported file stays stable and portable.
export function toPortableRequest(request, folderPath = '') {
  return {
    name: request.name,
    folderPath,
    protocol: request.protocol ?? 'rest',
    method: request.method,
    url: request.url,
    params: pickRows(request.params),
    headers: pickRows(request.headers),
    body: {
      mode: request.body?.mode ?? 'none',
      raw: request.body?.raw ?? '',
      rows: pickRows(request.body?.rows),
      form: (request.body?.form || []).map((row) =>
        FORM_ROW_FIELDS.reduce((acc, field) => ({ ...acc, [field]: row[field] }), {}),
      ),
    },
    graphql: {
      query: request.graphql?.query ?? '',
      variables: request.graphql?.variables ?? '',
      operationName: request.graphql?.operationName ?? '',
    },
    websocket: {
      subprotocols: request.websocket?.subprotocols ?? '',
      reconnect: {
        enabled: request.websocket?.reconnect?.enabled ?? false,
        maxRetries: request.websocket?.reconnect?.maxRetries ?? 3,
        delayMs: request.websocket?.reconnect?.delayMs ?? 1000,
      },
      heartbeat: {
        enabled: request.websocket?.heartbeat?.enabled ?? false,
        intervalMs: request.websocket?.heartbeat?.intervalMs ?? 30000,
        timeoutMs: request.websocket?.heartbeat?.timeoutMs ?? 10000,
      },
      graphql: {
        enabled: request.websocket?.graphql?.enabled ?? false,
        query: request.websocket?.graphql?.query ?? '',
        variables: request.websocket?.graphql?.variables ?? '',
        operationName: request.websocket?.graphql?.operationName ?? '',
        timeoutMs: request.websocket?.graphql?.timeoutMs ?? 10000,
      },
      steps: (request.websocket?.steps || []).map((step) => ({
        name: step.name ?? '',
        send: step.send ?? '',
        waitFor: {
          strategy: step.waitFor?.strategy ?? 'next',
          value: step.waitFor?.value ?? '',
          path: step.waitFor?.path ?? '',
          timeoutMs: step.waitFor?.timeoutMs ?? 10000,
        },
        assertions: (step.assertions || []).map((a) => ({
          source: a.source,
          operator: a.operator,
          expected: a.expected ?? '',
          path: a.path ?? '',
        })),
        captures: (step.captures || []).map((c) => ({
          source: c.source,
          variableName: c.variableName,
          path: c.path ?? '',
        })),
      })),
    },
    auth: {
      type: request.auth?.type ?? 'none',
      basic: {
        username: request.auth?.basic?.username ?? '',
        password: request.auth?.basic?.password ?? '',
      },
      bearer: { token: request.auth?.bearer?.token ?? '' },
      apiKey: {
        key: request.auth?.apiKey?.key ?? '',
        value: request.auth?.apiKey?.value ?? '',
        addTo: request.auth?.apiKey?.addTo ?? 'header',
      },
      oauth2: {
        grantType: request.auth?.oauth2?.grantType ?? 'clientCredentials',
        tokenUrl: request.auth?.oauth2?.tokenUrl ?? '',
        clientId: request.auth?.oauth2?.clientId ?? '',
        clientSecret: request.auth?.oauth2?.clientSecret ?? '',
        scope: request.auth?.oauth2?.scope ?? '',
        authUrl: request.auth?.oauth2?.authUrl ?? '',
        redirectUri: request.auth?.oauth2?.redirectUri ?? '',
        accessToken: request.auth?.oauth2?.accessToken ?? '',
        refreshToken: request.auth?.oauth2?.refreshToken ?? '',
        expiresAt: request.auth?.oauth2?.expiresAt ?? 0,
      },
    },
    assertions: (request.assertions || []).map((a) => ({
      source: a.source,
      operator: a.operator,
      expected: a.expected ?? '',
      path: a.path ?? '',
      headerName: a.headerName ?? '',
    })),
    captures: (request.captures || []).map((c) => ({
      source: c.source,
      variableName: c.variableName,
      path: c.path ?? '',
      headerName: c.headerName ?? '',
    })),
  };
}

// Safe for a Content-Disposition filename: a collection name is user-supplied, so it
// must never be able to inject quotes or newlines into a response header.
export function toFileName(collectionName) {
  const slug = String(collectionName || 'collection')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'collection'}.json`;
}
