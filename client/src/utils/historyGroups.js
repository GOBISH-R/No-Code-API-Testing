function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Today", "Yesterday", or the date — the headings Postman's history uses. */
export function dayLabel(date, now = new Date()) {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * Groups entries (already newest first) under day headings, keeping their order.
 * @returns {{ label: string, entries: object[] }[]}
 */
export function groupByDay(entries, now = new Date()) {
  const groups = [];
  for (const entry of entries) {
    const label = dayLabel(new Date(entry.createdAt), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

/** The URL as it was sent: the address plus its enabled params, the way Postman lists it. */
export function displayUrl(entry) {
  const query = (entry.params || [])
    .filter((p) => p.enabled !== false && p.key?.trim())
    .map((p) => `${p.key.trim()}=${p.value ?? ''}`)
    .join('&');
  if (!query) return entry.url;
  return `${entry.url}${entry.url.includes('?') ? '&' : '?'}${query}`;
}

/** Case-insensitive match on the URL (params included) and the method. */
export function filterHistory(entries, query) {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) => displayUrl(e).toLowerCase().includes(q) || e.method.toLowerCase() === q,
  );
}
