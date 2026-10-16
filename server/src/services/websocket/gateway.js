import { WebSocketServer } from 'ws';
import * as manager from './connectionManager.js';
import { buildHandshake } from './handshake.js';
import { createMessage, systemMessage, DIRECTIONS } from './messageEngine.js';
import { resolveRequestVariables } from '../variables/variableContext.js';
import { membership } from '../workspaces/workspaceService.js';
import { User } from '../../models/User.js';
import { sessionIsCurrent } from '../../middleware/authenticate.js';
import { resolveTextValue } from '../variables/variableResolver.js';
import { ValidationError } from '../../utils/errors.js';

export const GATEWAY_PATH = '/ws-gateway';

/**
 * Reads the session off an upgrade request.
 *
 * express-session is ordinary middleware, so it is invoked directly with a stub
 * response. Any failure resolves to "nobody", which the caller turns into a 401 —
 * an error here must never read as success.
 */
function authenticateUpgrade(sessionMiddleware, request, done) {
  if (!sessionMiddleware) return done(null);

  try {
    return sessionMiddleware(request, {}, async () => {
      const userId = request.session?.userId;
      if (!userId) return done(null);
      // The same rules as every HTTP request: the account still exists, is confirmed,
      // and this session began after its last password change.
      try {
        const user = await User.findById(userId).select('emailVerified passwordSetAt').lean();
        return done(user?.emailVerified && sessionIsCurrent(request.session, user) ? userId : null);
      } catch {
        return done(null);
      }
    });
  } catch {
    return done(null);
  }
}

/**
 * Why a gateway at all: a browser cannot set custom headers on a WebSocket handshake
 * (the WebSocket API has no such option), so header-based authentication is only
 * possible if the server performs the handshake. Proxying also keeps the SSRF guard
 * server-side and means the Collection Runner and manual testing share one client.
 */

// The browser-facing socket is an open relay to arbitrary external servers, so it must
// only accept the app's own origin — otherwise any page the user visits could drive it.
export function isAllowedOrigin(origin, allowed) {
  // Non-browser clients (curl, tests, the runner) send no Origin header.
  if (!origin) return true;
  return origin === allowed;
}

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

/**
 * Whose environments and globals a message's variables come from: the person's own, or
 * — when the message names a workspace — that workspace's, after the same membership
 * check the HTTP routes make. Connection limits stay with the person (client.userId).
 */
async function scopeFor(client, workspaceId) {
  if (!workspaceId) return client.userId;
  const found = await membership(client.userId, workspaceId);
  if (!found) throw new ValidationError('You are not a member of that workspace.');
  return found.workspace._id;
}

// Browser -> gateway control messages are parsed here; anything unrecognised is
// answered with an error rather than ignored, so a client bug is visible.
async function handleControlMessage(client, raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return send(client.socket, { type: 'error', message: 'Gateway expects JSON control messages.' });
  }

  try {
    switch (message.type) {
      case 'connect': {
        // Same variable precedence as executing a request: global < environment < runtime.
        const variables = await resolveRequestVariables(
          await scopeFor(client, message.workspaceId),
          message.environmentId,
          message.runtimeVariables,
        );

        const handshake = await buildHandshake(
          {
            url: message.url,
            params: message.params,
            headers: message.headers,
            auth: message.auth,
            subprotocols: message.subprotocols,
          },
          variables,
        );

        const { id } = await manager.openConnection(
          { ...handshake, reconnect: message.reconnect, heartbeat: message.heartbeat },
          {
            onOpen: ({ id: cid, protocol }) => {
              send(client.socket, { type: 'open', connectionId: cid, protocol });
              send(client.socket, {
                type: 'message',
                message: systemMessage(
                  cid,
                  'open',
                  protocol ? `Connected (subprotocol: ${protocol})` : 'Connected',
                ),
              });
            },
            onMessage: ({ id: cid, data, isBinary }) =>
              send(client.socket, {
                type: 'message',
                message: createMessage({
                  connectionId: cid,
                  direction: DIRECTIONS.RECEIVED,
                  payload: isBinary ? data : data.toString(),
                  isBinary: Boolean(isBinary),
                }),
              }),
            onClose: ({ code, reason, local }) => {
              client.connectionIds.delete(id);
              send(client.socket, { type: 'closed', connectionId: id, code, reason, local: Boolean(local) });
              send(client.socket, {
                type: 'message',
                message: systemMessage(
                  id,
                  'closed',
                  `Disconnected — code ${code}${reason ? `: ${reason}` : ''}`,
                ),
              });
            },
            onError: ({ message: errorMessage }) => {
              send(client.socket, { type: 'error', connectionId: id, message: errorMessage });
              send(client.socket, { type: 'message', message: systemMessage(id, 'error', errorMessage) });
            },
            // Reported as system entries so a retry is visible in the log rather than
            // looking like an unexplained gap in the conversation.
            onReconnecting: ({ attempt, maxRetries, delayMs }) =>
              send(client.socket, {
                type: 'message',
                message: systemMessage(
                  id,
                  'reconnecting',
                  `Connection lost — reconnecting (attempt ${attempt} of ${maxRetries}) in ${delayMs}ms`,
                ),
              }),
            onHeartbeatTimeout: () =>
              send(client.socket, {
                type: 'message',
                message: systemMessage(id, 'error', 'Heartbeat timed out — the peer stopped responding'),
              }),
          },
          { ownerId: client.userId },
        );

        client.connectionIds.add(id);
        send(client.socket, { type: 'connecting', connectionId: id });
        return undefined;
      }

      case 'send': {
        // Resolved here rather than in the browser so an outgoing message uses the
        // same global < environment < runtime precedence as everything else.
        const variables = await resolveRequestVariables(
          await scopeFor(client, message.workspaceId),
          message.environmentId,
          message.runtimeVariables,
        );
        const { text: payload, missing } = resolveTextValue(message.payload ?? '', variables);
        if (missing.length > 0) {
          throw new ValidationError(
            `Unresolved variable${missing.length > 1 ? 's' : ''}: ${missing.map((m) => `{{${m}}}`).join(', ')}.`,
          );
        }

        manager.sendMessage(message.connectionId, payload);
        return send(client.socket, {
          type: 'message',
          message: createMessage({
            connectionId: message.connectionId,
            direction: DIRECTIONS.SENT,
            payload,
          }),
        });
      }

      case 'close': {
        manager.closeConnection(message.connectionId);
        return undefined;
      }

      case 'reconnect': {
        manager.reconnect(message.connectionId);
        return send(client.socket, {
          type: 'message',
          message: systemMessage(message.connectionId, 'reconnecting', 'Reconnecting…'),
        });
      }

      case 'status': {
        return send(client.socket, {
          type: 'status',
          connectionId: message.connectionId,
          connection: manager.describeConnection(message.connectionId),
        });
      }

      default:
        return send(client.socket, { type: 'error', message: `Unknown gateway command "${message.type}".` });
    }
  } catch (err) {
    const text = err instanceof ValidationError ? err.message : 'The gateway could not handle that request.';
    return send(client.socket, { type: 'error', connectionId: message.connectionId ?? null, message: text });
  }
}

/**
 * Attaches the gateway to the existing HTTP server.
 *
 * `noServer` + a manual upgrade handler (rather than letting ws own the port) is what
 * keeps Express and the gateway on one port and lets the Origin check run before any
 * socket is created.
 */
export function attachWebSocketGateway(httpServer, { clientUrl, sessionMiddleware } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: manager.LIMITS.MAX_MESSAGE_BYTES });

  httpServer.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }

    if (pathname !== GATEWAY_PATH) {
      // Not ours — close rather than leave the socket hanging.
      socket.destroy();
      return;
    }

    if (!isAllowedOrigin(request.headers.origin, clientUrl)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    /**
     * The upgrade carries cookies, so the session is readable here — and it has to be.
     * This gateway opens outbound connections to arbitrary hosts and resolves the
     * caller's saved variables, so an anonymous upgrade would be both an open relay
     * and a way to read somebody's environment secrets.
     *
     * Running the session middleware by hand is the standard way to authenticate a
     * WebSocket: there is no route to hang normal middleware off.
     */
    authenticateUpgrade(sessionMiddleware, request, (userId) => {
      if (!userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request, userId));
    });
  });

  wss.on('connection', (socket, _request, userId) => {
    // Each browser session owns its connections, so dropping the tab tears down the
    // target sockets it opened instead of leaking them. `userId` is captured from the
    // authenticated upgrade, never from anything the client sends afterwards.
    const client = { socket, connectionIds: new Set(), userId };

    socket.on('message', (raw) => {
      handleControlMessage(client, raw).catch((err) => {
        send(socket, { type: 'error', message: err?.message || 'Gateway failure.' });
      });
    });

    socket.on('close', () => manager.closeAll([...client.connectionIds]));
    socket.on('error', () => manager.closeAll([...client.connectionIds]));

    send(socket, { type: 'ready', limits: manager.LIMITS });
  });

  return wss;
}
