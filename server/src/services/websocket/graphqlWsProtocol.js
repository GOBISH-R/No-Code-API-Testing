import crypto from 'node:crypto';

/**
 * The `graphql-ws` protocol (graphql-transport-ws), which is how GraphQL subscriptions
 * are carried over a WebSocket.
 *
 * It is a small state machine layered on top of the raw socket:
 *
 *   connection_init  ->  connection_ack
 *   subscribe        ->  next, next, next …  ->  complete
 *
 * Kept as pure message builders and a classifier so the sequence can be tested without
 * a socket, and so the transport underneath stays the ordinary connection manager.
 */

export const SUBPROTOCOL = 'graphql-ws';

const CLIENT_TYPES = {
  CONNECTION_INIT: 'connection_init',
  SUBSCRIBE: 'subscribe',
  COMPLETE: 'complete',
  PING: 'ping',
  PONG: 'pong',
};

const SERVER_TYPES = {
  CONNECTION_ACK: 'connection_ack',
  NEXT: 'next',
  ERROR: 'error',
  COMPLETE: 'complete',
  PING: 'ping',
  PONG: 'pong',
};

export function connectionInit(payload) {
  // `payload` carries connection params — where a server expects auth outside the
  // handshake headers, this is where it goes.
  return JSON.stringify(payload ? { type: CLIENT_TYPES.CONNECTION_INIT, payload } : { type: CLIENT_TYPES.CONNECTION_INIT });
}

export function subscribe({ id, query, variables, operationName }) {
  const payload = { query };
  if (variables !== undefined && variables !== null && variables !== '') payload.variables = variables;
  if (operationName?.trim()) payload.operationName = operationName.trim();

  return JSON.stringify({ id: id || crypto.randomUUID(), type: CLIENT_TYPES.SUBSCRIBE, payload });
}

export function complete(id) {
  return JSON.stringify({ id, type: CLIENT_TYPES.COMPLETE });
}

export function pong(payload) {
  return JSON.stringify(payload ? { type: CLIENT_TYPES.PONG, payload } : { type: CLIENT_TYPES.PONG });
}

/**
 * Interprets one frame from the server.
 *
 * Anything unrecognised is reported rather than ignored, because a server speaking a
 * different subprotocol (the older subscriptions-transport-ws, say) otherwise looks
 * like silence.
 */
export function classifyServerFrame(raw) {
  let frame;
  try {
    frame = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
  } catch {
    return { kind: 'invalid', error: 'Server sent a frame that is not JSON.' };
  }

  if (!frame || typeof frame !== 'object' || typeof frame.type !== 'string') {
    return { kind: 'invalid', error: 'Server sent a frame with no type.' };
  }

  switch (frame.type) {
    case SERVER_TYPES.CONNECTION_ACK:
      return { kind: 'ack' };
    case SERVER_TYPES.NEXT:
      return { kind: 'next', id: frame.id, payload: frame.payload };
    case SERVER_TYPES.ERROR:
      return { kind: 'error', id: frame.id, errors: frame.payload };
    case SERVER_TYPES.COMPLETE:
      return { kind: 'complete', id: frame.id };
    case SERVER_TYPES.PING:
      return { kind: 'ping', payload: frame.payload };
    case SERVER_TYPES.PONG:
      return { kind: 'pong' };
    default:
      return { kind: 'unknown', type: frame.type };
  }
}

// GraphQL reports subscribe-time problems as an array of error objects.
export function describeErrors(errors) {
  if (!Array.isArray(errors)) return 'The server rejected the subscription.';
  const messages = errors.map((e) => e?.message).filter(Boolean);
  return messages.length ? messages.join('; ') : 'The server rejected the subscription.';
}
