import { describe, it, expect } from 'vitest';
import { dayLabel, displayUrl, filterHistory, groupByDay } from './historyGroups.js';

const now = new Date(2026, 9, 14, 10, 0); // 14 Oct 2026, 10:00 local

describe('dayLabel', () => {
  it('names today and yesterday by calendar day, not by 24-hour window', () => {
    expect(dayLabel(new Date(2026, 9, 14, 0, 1), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 13, 23, 59), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 9, 13, 0, 0), now)).toBe('Yesterday');
  });

  it('shows a date for anything older, with the year only when it differs', () => {
    expect(dayLabel(new Date(2026, 9, 10), now)).not.toMatch(/2026/);
    expect(dayLabel(new Date(2025, 11, 31), now)).toMatch(/2025/);
  });
});

describe('groupByDay', () => {
  it('keeps the newest-first order and starts a group at each new day', () => {
    const entries = [
      { _id: 'a', createdAt: new Date(2026, 9, 14, 9).toISOString() },
      { _id: 'b', createdAt: new Date(2026, 9, 14, 8).toISOString() },
      { _id: 'c', createdAt: new Date(2026, 9, 13, 22).toISOString() },
      { _id: 'd', createdAt: new Date(2026, 9, 1, 12).toISOString() },
    ];
    const groups = groupByDay(entries, now);
    expect(groups.map((g) => g.label).slice(0, 2)).toEqual(['Today', 'Yesterday']);
    expect(groups.map((g) => g.entries.map((e) => e._id))).toEqual([['a', 'b'], ['c'], ['d']]);
  });

  it('returns no groups for no entries', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe('filterHistory', () => {
  const entries = [
    { method: 'GET', url: 'https://api.test/users' },
    { method: 'POST', url: 'https://api.test/orders' },
    { method: 'DELETE', url: 'https://other.test/posts/1' },
  ];

  it('matches part of the URL, ignoring case', () => {
    expect(filterHistory(entries, 'API.TEST').map((e) => e.method)).toEqual(['GET', 'POST']);
  });

  it('matches a whole method name as well as the URL', () => {
    expect(filterHistory(entries, 'post').map((e) => e.method)).toEqual(['POST', 'DELETE']);
    expect(filterHistory(entries, 'delete').map((e) => e.method)).toEqual(['DELETE']);
  });

  it('finds a send by one of its params', () => {
    const withParams = [
      ...entries,
      { method: 'GET', url: 'https://api.test/users', params: [{ key: 'page', value: '2', enabled: true }] },
    ];
    expect(filterHistory(withParams, 'page=2')).toHaveLength(1);
  });

  it('returns everything for an empty query', () => {
    expect(filterHistory(entries, '  ')).toBe(entries);
  });
});

describe('displayUrl', () => {
  it('appends enabled params with a key, keeping any query already in the URL', () => {
    const params = [
      { key: 'page', value: '2', enabled: true },
      { key: 'off', value: '1', enabled: false },
      { key: ' ', value: 'x', enabled: true },
      { key: 'id', value: '{{userId}}', enabled: true },
    ];
    expect(displayUrl({ url: 'https://a.test/u', params })).toBe('https://a.test/u?page=2&id={{userId}}');
    expect(displayUrl({ url: 'https://a.test/u?x=1', params })).toBe('https://a.test/u?x=1&page=2&id={{userId}}');
    expect(displayUrl({ url: 'https://a.test/u' })).toBe('https://a.test/u');
  });
});
