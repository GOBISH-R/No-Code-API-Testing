import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

// The backend origin, e.g. for validating the origin of a postMessage sent by a popup
// window it opened (see useOAuthAuthCode.js) — that popup is served from this origin.
export const apiOrigin = new URL(baseURL, window.location.href).origin;

const api = axios.create({
  baseURL,
  // Longer than the backend's own 15s target-request timeout, so we don't cut off
  // a request that's still legitimately waiting on the backend's execution result.
  timeout: 20000,
  /**
   * Send the session cookie.
   *
   * The client and API are different origins (different ports in development, possibly
   * different subdomains in production), and without this the browser omits the cookie
   * entirely — every request would arrive anonymous and be refused. The server sets the
   * matching `cors({ credentials: true })`.
   */
  withCredentials: true,
});

/**
 * The team workspace requests act in, or null for the person's own data.
 *
 * Sent as a header on every call rather than threaded through each service, so no
 * request can forget it. The server checks membership and role on every request; this
 * only says which workspace is meant.
 */
let workspaceId = null;
let onLostAccess = null;

export function setWorkspace(id) {
  workspaceId = id || null;
}

export function currentWorkspace() {
  return workspaceId;
}

/** Called when the server says we are no longer a member — e.g. we were removed. */
export function onWorkspaceAccessLost(fn) {
  onLostAccess = fn;
}

api.interceptors.request.use((config) => {
  if (workspaceId) config.headers['X-Workspace-Id'] = workspaceId;
  return config;
});

let onSessionEnded = null;

/** Called when a signed-in request comes back 401: signed out elsewhere, or expired. */
export function onSignedOutByServer(fn) {
  onSessionEnded = fn;
}

api.interceptors.response.use(undefined, (error) => {
  if (error.response?.data?.code === 'NOT_A_MEMBER' && onLostAccess) onLostAccess();
  // The account endpoints answer 401 as an ordinary "not signed in" (e.g. /me on load);
  // anywhere else it means the session this page relied on is gone.
  const url = error.config?.url ?? '';
  if (error.response?.status === 401 && !url.startsWith('/accounts/') && onSessionEnded) onSessionEnded();
  return Promise.reject(error);
});

export default api;
