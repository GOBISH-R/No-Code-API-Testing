import { describe, it, expect } from 'vitest';
import { fromNow, intervalLabel, MONITOR_INTERVALS } from './relativeTime.js';

const now = Date.UTC(2026, 9, 14, 12, 0, 0);
const MIN = 60 * 1000;

describe('fromNow', () => {
  it('describes the past and the future in short units', () => {
    expect(fromNow(now - 20 * 1000, now)).toBe('just now');
    expect(fromNow(now + 20 * 1000, now)).toBe('in under a minute');
    expect(fromNow(now - 5 * MIN, now)).toBe('5 min ago');
    expect(fromNow(now + 14 * MIN, now)).toBe('in 14 min');
    expect(fromNow(now - 3 * 60 * MIN, now)).toBe('3 h ago');
    expect(fromNow(now + 2 * 24 * 60 * MIN, now)).toBe('in 2 d');
  });

  it('accepts ISO strings, as the API sends them', () => {
    expect(fromNow(new Date(now - 2 * MIN).toISOString(), now)).toBe('2 min ago');
  });
});

describe('monitor intervals', () => {
  it('match what the server accepts, in order', () => {
    expect(MONITOR_INTERVALS.map((i) => i.minutes)).toEqual([5, 15, 30, 60, 360, 720, 1440]);
  });

  it('read naturally', () => {
    expect(intervalLabel(60)).toBe('Every hour');
    expect(intervalLabel(1440)).toBe('Every day');
  });
});
