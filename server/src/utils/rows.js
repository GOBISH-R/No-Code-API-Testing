// Shared by the HTTP execution engine and the WebSocket handshake builder: a
// key/value row list is only ever sent when it is enabled and actually has a key.
export function enabledEntries(rows) {
  const entries = {};
  for (const row of rows || []) {
    if (row?.enabled && row.key?.trim()) {
      entries[row.key.trim()] = row.value ?? '';
    }
  }
  return entries;
}
