import crypto from 'node:crypto';

// A WebSocket exchange is a stream, not a request/response pair: one send may produce
// no replies, one reply, or many, and the server may speak first. Every frame in
// either direction therefore becomes an item in a single ordered log rather than being
// paired up with anything.
export const DIRECTIONS = {
  SENT: 'sent',
  RECEIVED: 'received',
  // Lifecycle events (connected, closed, errors) share the log so the sequence reads
  // in the order it actually happened.
  SYSTEM: 'system',
};

export const MESSAGE_TYPES = {
  TEXT: 'text',
  JSON: 'json',
  BINARY: 'binary',
};

/**
 * Classifies a payload. JSON is detected rather than declared, because what a server
 * sends is not something the tester gets to configure — and a JSON frame should be
 * pretty-printable in the log without the user having to label it.
 */
export function detectType(payload, isBinary = false) {
  if (isBinary) return MESSAGE_TYPES.BINARY;
  if (typeof payload !== 'string') return MESSAGE_TYPES.TEXT;

  const trimmed = payload.trim();
  // Only objects and arrays count: treating the bare text "12" or "null" as JSON would
  // be technically true and practically useless.
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return MESSAGE_TYPES.TEXT;

  try {
    JSON.parse(trimmed);
    return MESSAGE_TYPES.JSON;
  } catch {
    return MESSAGE_TYPES.TEXT;
  }
}

export function payloadSize(payload, isBinary = false) {
  if (isBinary) return payload?.length ?? 0;
  return Buffer.byteLength(typeof payload === 'string' ? payload : '', 'utf8');
}

/**
 * Builds one entry in the message log.
 *
 * Binary frames are recorded — their direction, size and timing are real test signal —
 * but their contents are not decoded, since text and JSON are the supported surface.
 */
export function createMessage({ connectionId, direction, payload = '', isBinary = false, event = null }) {
  const type = detectType(payload, isBinary);

  return {
    id: crypto.randomUUID(),
    connectionId: connectionId ?? null,
    direction,
    timestamp: Date.now(),
    type,
    payload: type === MESSAGE_TYPES.BINARY ? null : payload,
    size: payloadSize(payload, isBinary),
    // Only set for SYSTEM entries: 'open' | 'closed' | 'error'.
    event,
  };
}

export function systemMessage(connectionId, event, text) {
  return createMessage({ connectionId, direction: DIRECTIONS.SYSTEM, payload: text, event });
}
