import crypto from 'node:crypto';
import { WebSocket } from 'ws';
import { assertPublicWebSocketUrl } from './wsUrlValidator.js';
import { ValidationError } from '../../utils/errors.js';

// A persistent connection is the opposite of the one-shot HTTP model the rest of this
// backend uses, so every dimension that could grow without bound is capped here.
export const LIMITS = {
  // Two ceilings: one per account, so a single user cannot take every slot and lock
  // everybody else out, and one for the whole process, which bounds memory and file
  // descriptors however many people are signed in.
  MAX_CONNECTIONS_PER_USER: 10,
  MAX_CONNECTIONS: 200,
  CONNECT_TIMEOUT_MS: 10_000,
  // Closed after this long with no traffic in either direction.
  IDLE_TIMEOUT_MS: 5 * 60 * 1000,
  // Absolute ceiling regardless of activity — a chatty socket must still not live forever.
  MAX_LIFETIME_MS: 30 * 60 * 1000,
  MAX_MESSAGE_BYTES: 1024 * 1024,
  // Hard ceiling on reconnects regardless of what the caller asks for: the failure
  // mode to avoid is a test that retries forever against a server that is simply down.
  MAX_RECONNECT_ATTEMPTS: 10,
  DEFAULT_RECONNECT_ATTEMPTS: 3,
  DEFAULT_RECONNECT_DELAY_MS: 1000,
  MAX_RECONNECT_DELAY_MS: 30_000,
  DEFAULT_HEARTBEAT_INTERVAL_MS: 30_000,
  DEFAULT_HEARTBEAT_TIMEOUT_MS: 10_000,
};

export const STATES = {
  CONNECTING: 'connecting',
  OPEN: 'open',
  CLOSING: 'closing',
  CLOSED: 'closed',
  ERROR: 'error',
  // Between a dropped socket and the next attempt.
  RECONNECTING: 'reconnecting',
};

const connections = new Map();
// Open connections per owner, kept alongside the map so the per-user check is O(1)
// rather than a scan of every connection on the server.
const perOwner = new Map();

export function connectionCount(ownerId) {
  if (ownerId === undefined) return connections.size;
  return perOwner.get(String(ownerId)) || 0;
}

function releaseOwnerSlot(entry) {
  if (!entry.ownerKey) return;
  const left = (perOwner.get(entry.ownerKey) || 1) - 1;
  if (left > 0) perOwner.set(entry.ownerKey, left);
  else perOwner.delete(entry.ownerKey);
  entry.ownerKey = null;
}

// Metadata only — never the socket itself, so callers cannot bypass the manager.
// (An earlier getConnection() returning the raw entry was removed for exactly that
// reason: it handed out the live socket and let callers skip the limits and cleanup.)
export function describeConnection(id) {
  const entry = connections.get(id);
  if (!entry) return null;

  return {
    id: entry.id,
    url: entry.url,
    state: entry.state,
    protocol: entry.protocol,
    createdAt: entry.createdAt,
    lastActivityAt: entry.lastActivityAt,
    messagesSent: entry.messagesSent,
    messagesReceived: entry.messagesReceived,
    // Surfaced so a run can report "this step only passed after 2 reconnects".
    reconnectAttempts: entry.reconnectAttempts,
    closeCode: entry.closeCode,
    closeReason: entry.closeReason,
  };
}

function normalizeReconnect(config = {}) {
  const enabled = Boolean(config.enabled);
  const requested = Number(config.maxRetries);
  const maxRetries = Number.isFinite(requested) && requested >= 0
    ? Math.min(requested, LIMITS.MAX_RECONNECT_ATTEMPTS)
    : LIMITS.DEFAULT_RECONNECT_ATTEMPTS;

  const requestedDelay = Number(config.delayMs);
  const delayMs = Number.isFinite(requestedDelay) && requestedDelay > 0
    ? Math.min(requestedDelay, LIMITS.MAX_RECONNECT_DELAY_MS)
    : LIMITS.DEFAULT_RECONNECT_DELAY_MS;

  return { enabled, maxRetries, delayMs };
}

function normalizeHeartbeat(config = {}) {
  const enabled = Boolean(config.enabled);
  const interval = Number(config.intervalMs);
  const timeout = Number(config.timeoutMs);

  return {
    enabled,
    intervalMs: Number.isFinite(interval) && interval > 0 ? interval : LIMITS.DEFAULT_HEARTBEAT_INTERVAL_MS,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : LIMITS.DEFAULT_HEARTBEAT_TIMEOUT_MS,
  };
}

function clearTimers(entry) {
  clearTimeout(entry.idleTimer);
  clearTimeout(entry.lifetimeTimer);
  clearTimeout(entry.reconnectTimer);
  clearInterval(entry.heartbeatTimer);
  clearTimeout(entry.pongTimer);
  entry.idleTimer = null;
  entry.lifetimeTimer = null;
  entry.reconnectTimer = null;
  entry.heartbeatTimer = null;
  entry.pongTimer = null;
}

/**
 * Throws away a socket we are replacing or abandoning.
 *
 * Detaching the listeners first is the important part: terminating a socket fires its
 * own 'close' event, and without this that event looks exactly like the peer dropping
 * us — so a *deliberate* reconnect would trigger a second, competing automatic
 * reconnect and burn through the retry budget.
 */
function discardSocket(entry) {
  const socket = entry.socket;
  if (!socket) return;

  try {
    socket.removeAllListeners?.();
  } catch {
    // Nothing to detach.
  }
  try {
    socket.terminate?.();
  } catch {
    // Already gone.
  }
  entry.socket = null;
}

function stopHeartbeat(entry) {
  clearInterval(entry.heartbeatTimer);
  clearTimeout(entry.pongTimer);
  entry.heartbeatTimer = null;
  entry.pongTimer = null;
}

function finalize(entry, state) {
  if (entry.state === STATES.CLOSED || entry.state === STATES.ERROR) return;
  entry.state = state;
  clearTimers(entry);
  connections.delete(entry.id);
  releaseOwnerSlot(entry);
}

function touch(entry) {
  entry.lastActivityAt = Date.now();
  clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    entry.listeners.onClose?.({ code: 4000, reason: 'Idle timeout', local: true });
    forceClose(entry.id, 'Idle timeout');
  }, LIMITS.IDLE_TIMEOUT_MS);
  entry.idleTimer.unref?.();
}

/**
 * Protocol-level keepalive.
 *
 * Uses WebSocket ping/pong frames rather than an application-level "ping" message:
 * a heartbeat is a property of the connection, not of whatever protocol the target
 * speaks, and inventing an application message would both pollute the message log and
 * confuse a server that does not expect it.
 */
function startHeartbeat(entry) {
  if (!entry.heartbeat.enabled) return;
  stopHeartbeat(entry);

  entry.heartbeatTimer = setInterval(() => {
    if (entry.state !== STATES.OPEN) return;

    try {
      entry.socket.ping?.();
    } catch {
      return;
    }

    // No pong within the window means the peer is gone even though the socket still
    // looks open — precisely the dead connection this exists to detect.
    clearTimeout(entry.pongTimer);
    entry.pongTimer = setTimeout(() => {
      entry.listeners.onHeartbeatTimeout?.({ id: entry.id });
      handleDrop(entry, 4002, 'Heartbeat timeout');
    }, entry.heartbeat.timeoutMs);
    entry.pongTimer.unref?.();
  }, entry.heartbeat.intervalMs);

  entry.heartbeatTimer.unref?.();
}

function shouldReconnect(entry) {
  if (entry.intentionalClose) return false;
  if (!entry.reconnect.enabled) return false;
  return entry.reconnectAttempts < entry.reconnect.maxRetries;
}

// A socket died unexpectedly: either schedule a reconnect or finish the connection.
function handleDrop(entry, code, reason) {
  stopHeartbeat(entry);
  discardSocket(entry);

  if (!shouldReconnect(entry)) {
    entry.closeCode = code;
    entry.closeReason = reason;
    const wasExhausted = entry.reconnect.enabled && entry.reconnectAttempts >= entry.reconnect.maxRetries;
    finalize(entry, STATES.CLOSED);
    entry.listeners.onClose?.({
      code,
      reason: wasExhausted ? `${reason} (reconnect attempts exhausted)` : reason,
      local: false,
    });
    return;
  }

  entry.reconnectAttempts += 1;
  entry.state = STATES.RECONNECTING;
  entry.listeners.onReconnecting?.({
    id: entry.id,
    attempt: entry.reconnectAttempts,
    maxRetries: entry.reconnect.maxRetries,
    delayMs: entry.reconnect.delayMs,
  });

  entry.reconnectTimer = setTimeout(() => {
    // The entry may have been closed while the timer was pending.
    if (!connections.has(entry.id)) return;
    attachSocket(entry);
  }, entry.reconnect.delayMs);
  entry.reconnectTimer.unref?.();
}

// Creates the underlying socket and wires its events. Used for the first connect and
// for every reconnect, so both paths behave identically.
function attachSocket(entry) {
  entry.state = STATES.CONNECTING;

  const socket = entry.createSocket(entry.url, entry.subprotocols, entry.headers);
  entry.socket = socket;

  socket.on('open', () => {
    entry.state = STATES.OPEN;
    // `protocol` is what the server actually agreed to, which may be none of the
    // subprotocols requested.
    entry.protocol = socket.protocol || null;
    touch(entry);
    startHeartbeat(entry);
    entry.listeners.onOpen?.({
      id: entry.id,
      protocol: entry.protocol,
      reconnected: entry.reconnectAttempts > 0,
      attempt: entry.reconnectAttempts,
    });
  });

  socket.on('message', (data, isBinary) => {
    entry.messagesReceived += 1;
    touch(entry);
    entry.listeners.onMessage?.({ id: entry.id, data, isBinary });
  });

  // A pong proves the peer is alive; the heartbeat's deadline is cancelled.
  socket.on('pong', () => {
    clearTimeout(entry.pongTimer);
    entry.pongTimer = null;
    touch(entry);
  });

  socket.on('close', (code, reasonBuffer) => {
    const reason = reasonBuffer?.toString?.() || '';

    if (entry.intentionalClose) {
      entry.closeCode = code;
      entry.closeReason = reason;
      finalize(entry, STATES.CLOSED);
      entry.listeners.onClose?.({ code, reason, local: true });
      return;
    }

    handleDrop(entry, code, reason);
  });

  socket.on('error', (err) => {
    const message = err?.message || 'WebSocket error.';
    entry.listeners.onError?.({ id: entry.id, message });

    if (!shouldReconnect(entry)) {
      finalize(entry, STATES.ERROR);
      return;
    }
    handleDrop(entry, 4003, message);
  });
}

/**
 * Opens a connection to a target WebSocket server.
 *
 * `createSocket` exists so lifecycle behaviour can be tested without a network: the
 * default builds a real `ws` client, tests substitute a fake that they drive.
 */
export async function openConnection(
  { url, headers = {}, subprotocols = [], reconnect, heartbeat } = {},
  listeners = {},
  { createSocket, ownerId } = {},
) {
  const ownerKey = ownerId ? String(ownerId) : null;
  if (ownerKey && connectionCount(ownerKey) >= LIMITS.MAX_CONNECTIONS_PER_USER) {
    throw new ValidationError(
      `Too many open WebSocket connections (limit ${LIMITS.MAX_CONNECTIONS_PER_USER} per account). Close one and try again.`,
    );
  }
  if (connections.size >= LIMITS.MAX_CONNECTIONS) {
    throw new ValidationError('Too many open WebSocket connections on the server right now. Try again shortly.');
  }

  if (!url?.trim()) throw new ValidationError('A WebSocket URL is required.');

  // SSRF guard runs before any socket is created.
  const target = await assertPublicWebSocketUrl(url);

  const id = crypto.randomUUID();
  const entry = {
    id,
    url: target.toString(),
    headers,
    subprotocols,
    state: STATES.CONNECTING,
    protocol: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    messagesSent: 0,
    messagesReceived: 0,
    reconnectAttempts: 0,
    closeCode: null,
    closeReason: null,
    intentionalClose: false,
    reconnect: normalizeReconnect(reconnect),
    heartbeat: normalizeHeartbeat(heartbeat),
    idleTimer: null,
    lifetimeTimer: null,
    reconnectTimer: null,
    heartbeatTimer: null,
    pongTimer: null,
    listeners,
    ownerKey: null,
    socket: null,
    createSocket:
      createSocket ||
      ((targetUrl, protocols, requestHeaders) =>
        new WebSocket(targetUrl, protocols, {
          headers: requestHeaders,
          handshakeTimeout: LIMITS.CONNECT_TIMEOUT_MS,
          maxPayload: LIMITS.MAX_MESSAGE_BYTES,
        })),
  };

  // Re-checked after the await above: two opens racing through the DNS lookup would
  // otherwise both pass the check and overshoot the limit.
  if (ownerKey && connectionCount(ownerKey) >= LIMITS.MAX_CONNECTIONS_PER_USER) {
    throw new ValidationError(
      `Too many open WebSocket connections (limit ${LIMITS.MAX_CONNECTIONS_PER_USER} per account). Close one and try again.`,
    );
  }
  if (connections.size >= LIMITS.MAX_CONNECTIONS) {
    throw new ValidationError('Too many open WebSocket connections on the server right now. Try again shortly.');
  }

  connections.set(id, entry);
  if (ownerKey) {
    entry.ownerKey = ownerKey;
    perOwner.set(ownerKey, connectionCount(ownerKey) + 1);
  }

  entry.lifetimeTimer = setTimeout(() => {
    listeners.onClose?.({ code: 4001, reason: 'Maximum connection lifetime reached', local: true });
    forceClose(id, 'Maximum connection lifetime reached');
  }, LIMITS.MAX_LIFETIME_MS);
  entry.lifetimeTimer.unref?.();

  attachSocket(entry);

  return { id, url: entry.url };
}

export function sendMessage(id, payload) {
  const entry = connections.get(id);
  if (!entry) throw new ValidationError('That connection is no longer open.');
  if (entry.state !== STATES.OPEN) throw new ValidationError(`The connection is ${entry.state}, not open.`);

  const size = Buffer.byteLength(typeof payload === 'string' ? payload : '', 'utf8');
  if (size > LIMITS.MAX_MESSAGE_BYTES) {
    throw new ValidationError(`Message exceeds the ${LIMITS.MAX_MESSAGE_BYTES / 1024 / 1024}MB limit.`);
  }

  entry.socket.send(payload);
  entry.messagesSent += 1;
  touch(entry);
  return { size };
}

/**
 * Reconnects on demand.
 *
 * Deliberately resets the attempt counter: a person clicking "Reconnect" is making a
 * fresh decision, not continuing an automatic retry run that already gave up.
 */
export function reconnect(id) {
  const entry = connections.get(id);
  if (!entry) throw new ValidationError('That connection is no longer open.');

  clearTimeout(entry.reconnectTimer);
  stopHeartbeat(entry);
  // Discard before clearing the flag, so the old socket's own close event cannot be
  // mistaken for the peer dropping us.
  discardSocket(entry);
  entry.intentionalClose = false;
  entry.reconnectAttempts = 0;

  attachSocket(entry);
  return true;
}

// Graceful: sends a close frame and lets the peer acknowledge. Marked intentional so
// auto-reconnect does not immediately undo it.
export function closeConnection(id, reason = 'Client closed the connection') {
  const entry = connections.get(id);
  if (!entry) return false;

  entry.intentionalClose = true;
  entry.state = STATES.CLOSING;
  clearTimeout(entry.reconnectTimer);
  stopHeartbeat(entry);

  try {
    entry.socket.close(1000, reason);
  } catch {
    forceClose(id, reason);
  }
  return true;
}

// Immediate: used for timeouts and shutdown, where waiting for a peer that may never
// answer is exactly the problem being solved.
export function forceClose(id, reason = 'Connection terminated') {
  const entry = connections.get(id);
  if (!entry) return false;

  entry.intentionalClose = true;
  try {
    entry.socket?.terminate?.();
  } catch {
    // The socket may already be gone; finalizing below is what matters.
  }
  finalize(entry, STATES.CLOSED);
  return Boolean(reason);
}

// Used when the browser that owns these connections disconnects, and on shutdown —
// otherwise a dropped tab would leave target connections open indefinitely.
export function closeAll(ids) {
  const targets = ids ?? [...connections.keys()];
  for (const id of targets) forceClose(id, 'Gateway closed');
  return targets.length;
}
