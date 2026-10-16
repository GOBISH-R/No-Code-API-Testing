/** Most matches highlighted at once; beyond this the count is shown as "1000+". */
const MAX_MATCHES = 1000;

/**
 * Where `query` occurs in `text`, case-insensitively, as [start, end) pairs.
 * @returns {{ matches: [number, number][], capped: boolean }}
 */
export function findMatches(text, query, limit = MAX_MATCHES) {
  const matches = [];
  if (!query) return { matches, capped: false };

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    if (matches.length === limit) return { matches, capped: true };
    matches.push([at, at + needle.length]);
    from = at + needle.length;
  }
  return { matches, capped: false };
}

/**
 * Splits text into plain and matched segments, in order, for rendering highlights.
 * @returns {{ text: string, match: number | null }[]} match is the match's index
 */
export function segment(text, matches) {
  const parts = [];
  let cursor = 0;
  matches.forEach(([start, end], index) => {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), match: null });
    parts.push({ text: text.slice(start, end), match: index });
    cursor = end;
  });
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: null });
  return parts;
}
