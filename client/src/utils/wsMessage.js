// Client-side helpers for composing and displaying WebSocket messages. The message
// *model* is produced by the server (messageEngine.js); this only formats it and
// supports the composer.

const PLACEHOLDER_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function isValidJson(text) {
  if (!text.trim()) return true;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// Pretty-prints a JSON payload; returns the original text unchanged if it will not
// parse, so the Format button can never destroy what someone is mid-way through typing.
export function formatJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * Lists the {{placeholders}} in a draft message and, where possible, what they will
 * become.
 *
 * Deliberately not a full preview: global and environment variables are resolved on
 * the server at send time, so the browser only genuinely knows the runtime ones.
 * Showing a confident preview of values we cannot see would be a lie — unknown
 * placeholders are reported as resolved-at-send instead.
 */
export function describePlaceholders(text, runtimeVariables = {}) {
  const found = new Map();

  for (const match of String(text || '').matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (found.has(name)) continue;
    found.set(name, {
      name,
      known: Object.prototype.hasOwnProperty.call(runtimeVariables, name),
      value: runtimeVariables[name],
    });
  }

  return [...found.values()];
}

export function messageDirectionLabel(direction) {
  switch (direction) {
    case 'sent':
      return 'Sent';
    case 'received':
      return 'Received';
    default:
      return 'System';
  }
}

// Time-of-day only: a message log is read relative to the other messages around it,
// not as an absolute date.
export function formatMessageTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Pretty-print JSON payloads for display; leave everything else exactly as received.
export function displayPayload(message) {
  if (!message) return '';
  if (message.type === 'binary') return '(binary frame — contents not decoded)';
  if (message.type === 'json') return formatJson(message.payload ?? '');
  return message.payload ?? '';
}
