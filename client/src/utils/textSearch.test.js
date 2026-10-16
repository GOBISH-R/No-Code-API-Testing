import { describe, it, expect } from 'vitest';
import { findMatches, segment } from './textSearch.js';
import { responseFileName } from './download.js';

describe('findMatches', () => {
  it('finds every occurrence, ignoring case', () => {
    expect(findMatches('Ann and ANNA', 'ann').matches).toEqual([[0, 3], [8, 11]]);
  });

  it('does not overlap matches', () => {
    expect(findMatches('aaaa', 'aa').matches).toEqual([[0, 2], [2, 4]]);
  });

  it('returns nothing for an empty query or no match', () => {
    expect(findMatches('text', '').matches).toEqual([]);
    expect(findMatches('text', 'zzz').matches).toEqual([]);
  });

  it('stops at the limit and says it did', () => {
    const { matches, capped } = findMatches('x'.repeat(50), 'x', 10);
    expect(matches).toHaveLength(10);
    expect(capped).toBe(true);
    expect(findMatches('xxx', 'x', 3).capped).toBe(false);
  });
});

describe('segment', () => {
  it('splits text into plain and matched parts, in order, losing nothing', () => {
    const text = '{"id": 1, "idx": 2}';
    const { matches } = findMatches(text, 'id');
    const parts = segment(text, matches);
    expect(parts.map((p) => p.text).join('')).toBe(text);
    expect(parts.filter((p) => p.match !== null).map((p) => p.match)).toEqual([0, 1]);
  });

  it('handles matches at the very start and end', () => {
    expect(segment('abcab', [[0, 2], [3, 5]])).toEqual([
      { text: 'ab', match: 0 },
      { text: 'c', match: null },
      { text: 'ab', match: 1 },
    ]);
  });
});

describe('responseFileName', () => {
  it('picks the extension from the content type', () => {
    expect(responseFileName(200, 'application/json; charset=utf-8')).toBe('response-200.json');
    expect(responseFileName(404, 'text/html')).toBe('response-404.html');
    expect(responseFileName(200, 'application/xml')).toBe('response-200.xml');
    expect(responseFileName(200, 'text/plain')).toBe('response-200.txt');
    expect(responseFileName(200, '')).toBe('response-200.txt');
  });

  it('treats a body that parsed as JSON as JSON, whatever the header said', () => {
    expect(responseFileName(201, 'text/plain', true)).toBe('response-201.json');
  });
});
