import { describe, it, expect } from 'vitest';
import { redactUrl, REDACTED } from '../../src/utils/redactUrl.js';

// The Google callback used to be logged verbatim, one-time code and all.
describe('redactUrl', () => {
  it('hides the Google callback code and state but keeps the rest readable', () => {
    const logged = redactUrl(
      '/api/accounts/google/callback?state=2bOkz4bQK&iss=https%3A%2F%2Faccounts.google.com&code=4%2F0ATsMZqAn&scope=email+profile',
    );
    expect(logged).toBe(
      `/api/accounts/google/callback?state=${REDACTED}&iss=https%3A%2F%2Faccounts.google.com&code=${REDACTED}&scope=email+profile`,
    );
    expect(logged).not.toContain('4%2F0ATsMZqAn');
    expect(logged).not.toContain('2bOkz4bQK');
  });

  it('matches parameter names case-insensitively', () => {
    expect(redactUrl('/x?Access_Token=abc&API_KEY=def')).toBe(`/x?Access_Token=${REDACTED}&API_KEY=${REDACTED}`);
  });

  it('leaves URLs without secrets exactly as they arrived', () => {
    expect(redactUrl('/api/test-runs?collectionId=abc&limit=50')).toBe('/api/test-runs?collectionId=abc&limit=50');
    expect(redactUrl('/api/health')).toBe('/api/health');
  });

  it('does not treat a name that merely contains a secret word as sensitive', () => {
    // "keyword" and "codename" are not credentials.
    expect(redactUrl('/x?keyword=a&codename=b')).toBe('/x?keyword=a&codename=b');
  });

  it('survives odd input', () => {
    expect(redactUrl(undefined)).toBe('');
    expect(redactUrl('/x?')).toBe('/x?');
    expect(redactUrl('/x?code')).toBe('/x?code');
    expect(redactUrl('/x?%E0%A4%A=1&code=z')).toBe(`/x?%E0%A4%A=1&code=${REDACTED}`);
  });
});
