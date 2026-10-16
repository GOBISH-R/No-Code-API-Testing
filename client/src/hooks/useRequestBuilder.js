import { useMemo, useState } from 'react';
import { createId } from '../utils/id.js';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function emptyRow() {
  return { id: createId(), key: '', value: '', enabled: true };
}

// A multipart field. File rows carry the picked file's contents (`data`, base64) only
// while it is in this tab: it is sent with each request and never saved.
function emptyFormRow() {
  return { id: createId(), key: '', value: '', enabled: true, type: 'text', fileName: '', fileType: '', fileSize: 0 };
}

function formRowsFromSaved(rows) {
  if (!rows || rows.length === 0) return [emptyFormRow()];
  return rows.map((row) => ({
    id: createId(),
    key: row.key || '',
    value: row.value || '',
    enabled: row.enabled ?? true,
    type: row.type === 'file' ? 'file' : 'text',
    fileName: row.fileName || '',
    fileType: row.fileType || '',
    fileSize: row.fileSize || 0,
    // Present only when this came from somewhere that still holds the bytes.
    ...(typeof row.data === 'string' ? { data: row.data } : {}),
  }));
}

/** The request without file contents — what is saved. The server would drop them anyway. */
export function withoutFileData(request) {
  if (!request.body?.form) return request;
  return {
    ...request,
    body: { ...request.body, form: request.body.form.map(({ data: _data, ...row }) => row) },
  };
}

function createInitialRequest() {
  return {
    protocol: 'rest',
    method: 'GET',
    url: '',
    params: [emptyRow()],
    headers: [emptyRow()],
    body: { mode: 'none', raw: '', rows: [emptyRow()], form: [emptyFormRow()] },
    graphql: { query: '', variables: '', operationName: '' },
    // WebSocket reuses url/params/headers/auth above — a handshake authenticates
    // exactly like an HTTP request — and adds only what is genuinely connection-specific.
    websocket: {
      subprotocols: '',
      reconnect: { enabled: false, maxRetries: 3, delayMs: 1000 },
      heartbeat: { enabled: false, intervalMs: 30000, timeoutMs: 10000 },
      graphql: { enabled: false, query: '', variables: '', operationName: '', timeoutMs: 10000 },
      steps: [],
    },
    auth: {
      type: 'none',
      basic: { username: '', password: '' },
      bearer: { token: '' },
      apiKey: { key: '', value: '', addTo: 'header' },
      oauth2: {
        grantType: 'clientCredentials',
        tokenUrl: '',
        clientId: '',
        clientSecret: '',
        scope: '',
        authUrl: '',
        redirectUri: '',
        accessToken: '',
        refreshToken: '',
        expiresAt: 0,
      },
    },
  };
}

function rowsFromSaved(rows) {
  if (!rows || rows.length === 0) return [emptyRow()];
  return rows.map((row) => ({
    id: createId(),
    key: row.key || '',
    value: row.value || '',
    enabled: row.enabled ?? true,
  }));
}

// Manages the visual request configuration as structured data — no HTTP calls here.
// This is the same shape sent to POST /api/requests/execute and POST /api/requests (save).
export function useRequestBuilder() {
  const [request, setRequest] = useState(createInitialRequest);

  const setMethod = (method) => setRequest((r) => ({ ...r, method }));
  const setUrl = (url) => setRequest((r) => ({ ...r, url }));

  // GraphQL-over-HTTP is always POST — switching into GraphQL mode fixes the method so
  // the UI and the eventual request match (the backend enforces this too, regardless).
  const setProtocol = (protocol) =>
    setRequest((r) => ({ ...r, protocol, method: protocol === 'graphql' ? 'POST' : r.method }));

  const makeRowHandlers = (field) => ({
    addRow: () =>
      setRequest((r) => ({ ...r, [field]: [...r[field], emptyRow()] })),
    updateRow: (id, patch) =>
      setRequest((r) => ({
        ...r,
        [field]: r[field].map((row) => (row.id === id ? { ...row, ...patch } : row)),
      })),
    removeRow: (id) =>
      setRequest((r) => ({ ...r, [field]: r[field].filter((row) => row.id !== id) })),
  });

  const paramHandlers = useMemo(() => makeRowHandlers('params'), []);
  const headerHandlers = useMemo(() => makeRowHandlers('headers'), []);

  const setBodyMode = (mode) => setRequest((r) => ({ ...r, body: { ...r.body, mode } }));
  const setBodyRaw = (raw) => setRequest((r) => ({ ...r, body: { ...r.body, raw } }));

  // body.rows is nested, so it needs its own handlers rather than makeRowHandlers
  // (which operates on a top-level field).
  const bodyRowHandlers = useMemo(
    () => ({
      addRow: () =>
        setRequest((r) => ({ ...r, body: { ...r.body, rows: [...r.body.rows, emptyRow()] } })),
      updateRow: (id, patch) =>
        setRequest((r) => ({
          ...r,
          body: {
            ...r.body,
            rows: r.body.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
          },
        })),
      removeRow: (id) =>
        setRequest((r) => ({
          ...r,
          body: { ...r.body, rows: r.body.rows.filter((row) => row.id !== id) },
        })),
    }),
    [],
  );

  const formRowHandlers = useMemo(
    () => ({
      addRow: () =>
        setRequest((r) => ({ ...r, body: { ...r.body, form: [...r.body.form, emptyFormRow()] } })),
      updateRow: (id, patch) =>
        setRequest((r) => ({
          ...r,
          body: { ...r.body, form: r.body.form.map((row) => (row.id === id ? { ...row, ...patch } : row)) },
        })),
      removeRow: (id) =>
        setRequest((r) => ({ ...r, body: { ...r.body, form: r.body.form.filter((row) => row.id !== id) } })),
    }),
    [],
  );

  const setGraphQL = (patch) =>
    setRequest((r) => ({ ...r, graphql: { ...r.graphql, ...patch } }));

  const setWebSocket = (patch) =>
    setRequest((r) => ({ ...r, websocket: { ...r.websocket, ...patch } }));

  const setAuthType = (type) => setRequest((r) => ({ ...r, auth: { ...r.auth, type } }));
  const setBasicAuth = (patch) =>
    setRequest((r) => ({ ...r, auth: { ...r.auth, basic: { ...r.auth.basic, ...patch } } }));
  const setBearerAuth = (patch) =>
    setRequest((r) => ({ ...r, auth: { ...r.auth, bearer: { ...r.auth.bearer, ...patch } } }));
  const setApiKeyAuth = (patch) =>
    setRequest((r) => ({ ...r, auth: { ...r.auth, apiKey: { ...r.auth.apiKey, ...patch } } }));
  const setOAuth2Auth = (patch) =>
    setRequest((r) => ({ ...r, auth: { ...r.auth, oauth2: { ...r.auth.oauth2, ...patch } } }));

  // Replaces the whole form with a saved request's configuration (e.g. opening it from a collection).
  const loadRequest = (config) => {
    setRequest({
      protocol: config?.protocol || 'rest',
      method: config?.method || 'GET',
      url: config?.url || '',
      params: rowsFromSaved(config?.params),
      headers: rowsFromSaved(config?.headers),
      body: {
        mode: config?.body?.mode || 'none',
        raw: config?.body?.raw || '',
        rows: rowsFromSaved(config?.body?.rows),
        form: formRowsFromSaved(config?.body?.form),
      },
      graphql: {
        query: config?.graphql?.query || '',
        variables: config?.graphql?.variables || '',
        operationName: config?.graphql?.operationName || '',
      },
      websocket: {
        subprotocols: config?.websocket?.subprotocols || '',
        reconnect: {
          enabled: config?.websocket?.reconnect?.enabled ?? false,
          maxRetries: config?.websocket?.reconnect?.maxRetries ?? 3,
          delayMs: config?.websocket?.reconnect?.delayMs ?? 1000,
        },
        heartbeat: {
          enabled: config?.websocket?.heartbeat?.enabled ?? false,
          intervalMs: config?.websocket?.heartbeat?.intervalMs ?? 30000,
          timeoutMs: config?.websocket?.heartbeat?.timeoutMs ?? 10000,
        },
        graphql: {
          enabled: config?.websocket?.graphql?.enabled ?? false,
          query: config?.websocket?.graphql?.query || '',
          variables: config?.websocket?.graphql?.variables || '',
          operationName: config?.websocket?.graphql?.operationName || '',
          timeoutMs: config?.websocket?.graphql?.timeoutMs ?? 10000,
        },
        steps: (config?.websocket?.steps || []).map((step) => ({ ...step, id: createId() })),
      },
      auth: {
        type: config?.auth?.type || 'none',
        basic: {
          username: config?.auth?.basic?.username || '',
          password: config?.auth?.basic?.password || '',
        },
        bearer: { token: config?.auth?.bearer?.token || '' },
        apiKey: {
          key: config?.auth?.apiKey?.key || '',
          value: config?.auth?.apiKey?.value || '',
          addTo: config?.auth?.apiKey?.addTo || 'header',
        },
        oauth2: {
          grantType: config?.auth?.oauth2?.grantType || 'clientCredentials',
          tokenUrl: config?.auth?.oauth2?.tokenUrl || '',
          clientId: config?.auth?.oauth2?.clientId || '',
          clientSecret: config?.auth?.oauth2?.clientSecret || '',
          scope: config?.auth?.oauth2?.scope || '',
          authUrl: config?.auth?.oauth2?.authUrl || '',
          redirectUri: config?.auth?.oauth2?.redirectUri || '',
          accessToken: config?.auth?.oauth2?.accessToken || '',
          refreshToken: config?.auth?.oauth2?.refreshToken || '',
          expiresAt: config?.auth?.oauth2?.expiresAt || 0,
        },
      },
    });
  };

  const reset = () => setRequest(createInitialRequest());

  return {
    request,
    setMethod,
    setUrl,
    setProtocol,
    params: { rows: request.params, ...paramHandlers },
    headers: { rows: request.headers, ...headerHandlers },
    body: {
      value: request.body,
      setMode: setBodyMode,
      setRaw: setBodyRaw,
      rows: bodyRowHandlers,
      form: formRowHandlers,
    },
    graphql: { value: request.graphql, set: setGraphQL },
    websocket: { value: request.websocket, set: setWebSocket },
    auth: {
      value: request.auth,
      setType: setAuthType,
      setBasic: setBasicAuth,
      setBearer: setBearerAuth,
      setApiKey: setApiKeyAuth,
      setOAuth2: setOAuth2Auth,
    },
    loadRequest,
    reset,
  };
}
