import { describe, it, expect } from 'vitest';
import { matchPath, findMatch } from '../../src/services/mocking/mockMatcher.js';

describe('matchPath', () => {
  it('matches an exact path', () => {
    expect(matchPath('/users', '/users')).toBe(true);
    expect(matchPath('/users', '/orders')).toBe(false);
  });

  it('treats a :param segment as a wildcard for exactly one segment', () => {
    expect(matchPath('/users/:id', '/users/1')).toBe(true);
    expect(matchPath('/users/:id', '/users/abc')).toBe(true);
    expect(matchPath('/users/:id', '/users/1/posts')).toBe(false);
    expect(matchPath('/users/:id', '/users')).toBe(false);
  });

  it('ignores leading and trailing slashes', () => {
    expect(matchPath('/users/', 'users')).toBe(true);
  });

  it('matches multiple params', () => {
    expect(matchPath('/users/:id/posts/:postId', '/users/1/posts/9')).toBe(true);
  });
});

describe('findMatch', () => {
  const mocks = [
    { method: 'GET', path: '/users/:id', enabled: true, statusCode: 200 },
    { method: 'POST', path: '/users', enabled: true, statusCode: 201 },
    { method: 'GET', path: '/disabled', enabled: false, statusCode: 200 },
  ];

  it('matches on method and path together', () => {
    expect(findMatch(mocks, 'GET', '/users/1').statusCode).toBe(200);
    expect(findMatch(mocks, 'POST', '/users').statusCode).toBe(201);
  });

  it('does not match the right path with the wrong method', () => {
    expect(findMatch(mocks, 'DELETE', '/users/1')).toBe(null);
  });

  it('skips disabled mocks', () => {
    expect(findMatch(mocks, 'GET', '/disabled')).toBe(null);
  });

  it('returns null when nothing matches', () => {
    expect(findMatch(mocks, 'GET', '/nothing/here')).toBe(null);
    expect(findMatch([], 'GET', '/users/1')).toBe(null);
  });

  it('returns the first match when several mocks overlap', () => {
    const overlapping = [
      { method: 'GET', path: '/users/:id', enabled: true, statusCode: 200 },
      { method: 'GET', path: '/users/1', enabled: true, statusCode: 418 },
    ];
    expect(findMatch(overlapping, 'GET', '/users/1').statusCode).toBe(200);
  });
});
