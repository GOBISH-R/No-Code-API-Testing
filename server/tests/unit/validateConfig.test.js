import { describe, it, expect } from 'vitest';
import { checkConfig } from '../../src/config/validateConfig.js';

// A production environment with everything set. Individual tests remove one key to
// prove it is required, so anything added to REQUIRED_IN_PRODUCTION belongs here too.
const production = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://user:pw@cluster.example.net/app',
  CLIENT_URL: 'https://app.example.com',
  SESSION_SECRET: 'f'.repeat(64),
  ENCRYPTION_KEY: 'a1b2c3d4'.repeat(8),
  MAIL_FROM: 'noreply@example.com',
  SMTP_URL: 'smtps://user:pw@smtp.example.com',
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
};

describe('checkConfig outside production', () => {
  it('requires nothing, so local development runs with no database', () => {
    expect(checkConfig({ NODE_ENV: 'development' })).toEqual([]);
    expect(checkConfig({})).toEqual([]);
    expect(checkConfig({ NODE_ENV: 'test' })).toEqual([]);
  });
});

describe('checkConfig in production', () => {
  it('passes a fully configured environment with no warnings', () => {
    expect(checkConfig(production)).toEqual([]);
  });

  it('refuses to start without a database URI', () => {
    // Otherwise the server boots, reports healthy, and fails every real request.
    const { MONGODB_URI: _omitted, ...env } = production;
    expect(() => checkConfig(env)).toThrow(/MONGODB_URI/);
  });

  it('refuses to start without a CORS origin', () => {
    const { CLIENT_URL: _omitted, ...env } = production;
    expect(() => checkConfig(env)).toThrow(/CLIENT_URL/);
  });

  it('names every missing variable at once, not just the first', () => {
    const error = () => checkConfig({ NODE_ENV: 'production' });
    expect(error).toThrow(/MONGODB_URI/);
    expect(error).toThrow(/CLIENT_URL/);
  });

  it('treats a blank value as missing', () => {
    expect(() => checkConfig({ ...production, CLIENT_URL: '   ' })).toThrow(/CLIENT_URL/);
  });

  it('warns when CLIENT_URL was left pointing at the dev server', () => {
    // The .env.example value, copied and never edited — a very common deploy mistake.
    const warnings = checkConfig({ ...production, CLIENT_URL: 'http://localhost:5173' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/only permits a browser on this machine/);
  });

  it('warns about a localhost database but does not refuse to start', () => {
    const warnings = checkConfig({
      ...production,
      MONGODB_URI: 'mongodb://127.0.0.1:27017/app',
    });
    expect(warnings.some((w) => /localhost/.test(w))).toBe(true);
  });

  it('does not mistake a malformed URL for a local one', () => {
    expect(checkConfig({ ...production, CLIENT_URL: 'not-a-url' })).toEqual([]);
  });
});

describe('checkConfig — account authentication secrets', () => {
  const full = {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb+srv://user:pw@cluster.example.net/app',
    CLIENT_URL: 'https://app.example.com',
    SESSION_SECRET: 'a'.repeat(64),
    ENCRYPTION_KEY: 'a1b2c3d4'.repeat(8),
    MAIL_FROM: 'noreply@example.com',
    SMTP_URL: 'smtps://user:pw@smtp.example.com',
    GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'secret',
  };

  it('accepts a fully configured environment', () => {
    expect(checkConfig(full)).toEqual([]);
  });

  it('refuses to start without a session secret', () => {
    const { SESSION_SECRET: _omitted, ...env } = full;
    expect(() => checkConfig(env)).toThrow(/SESSION_SECRET/);
  });

  it('refuses a well-known placeholder secret', () => {
    // Anyone could forge a session cookie for any account with one of these.
    for (const weak of ['secret', 'changeme', 'keyboard cat', 'CHANGEME']) {
      expect(() => checkConfig({ ...full, SESSION_SECRET: weak })).toThrow(/placeholder/i);
    }
  });

  it('refuses a short secret', () => {
    expect(() => checkConfig({ ...full, SESSION_SECRET: 'x'.repeat(20) })).toThrow(/at least 32/);
  });

  it('refuses to start without a mail transport', () => {
    // Password reset that silently goes nowhere is worse than refusing to boot.
    const { SMTP_URL: _omitted, ...env } = full;
    expect(() => checkConfig(env)).toThrow(/SMTP_URL/);
  });

  it('refuses half-configured Google sign-in', () => {
    // Set only one and it fails at the callback — for the user, not at startup.
    const { GOOGLE_CLIENT_SECRET: _a, ...noSecret } = full;
    expect(() => checkConfig(noSecret)).toThrow(/both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/);

    const { GOOGLE_CLIENT_ID: _b, ...noId } = full;
    expect(() => checkConfig(noId)).toThrow(/both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/);
  });

  it('treats Google sign-in as optional, warning when it is absent', () => {
    const { GOOGLE_CLIENT_ID: _a, GOOGLE_CLIENT_SECRET: _b, ...env } = full;
    const warnings = checkConfig(env);
    expect(warnings.some((w) => /Google sign-in is not configured/.test(w))).toBe(true);
  });
});

describe('checkConfig — the credential encryption key', () => {
  const full = {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb+srv://user:pw@cluster.example.net/app',
    CLIENT_URL: 'https://app.example.com',
    SESSION_SECRET: 'a'.repeat(64),
    ENCRYPTION_KEY: 'a1b2c3d4'.repeat(8),
    MAIL_FROM: 'noreply@example.com',
    SMTP_URL: 'smtps://user:pw@smtp.example.com',
    GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'secret',
  };

  it('refuses to start without one', () => {
    const { ENCRYPTION_KEY: _omitted, ...env } = full;
    expect(() => checkConfig(env)).toThrow(/ENCRYPTION_KEY/);
  });

  it('refuses a key that is not 32 bytes of hex', () => {
    // Checked at startup, not on first save — otherwise the failure surfaces to a user
    // trying to store a token, rather than to whoever deployed it.
    expect(() => checkConfig({ ...full, ENCRYPTION_KEY: 'too-short' })).toThrow(/64 hex/);
    expect(() => checkConfig({ ...full, ENCRYPTION_KEY: 'z'.repeat(64) })).toThrow(/64 hex/);
    expect(() => checkConfig({ ...full, ENCRYPTION_KEY: 'ab'.repeat(20) })).toThrow(/64 hex/);
  });

  it('refuses to share a key with SESSION_SECRET', () => {
    // One secret doing two jobs means a leak of either compromises both.
    const shared = 'a1b2c3d4'.repeat(8);
    expect(() => checkConfig({ ...full, SESSION_SECRET: shared, ENCRYPTION_KEY: shared })).toThrow(
      /must be different keys/i,
    );
  });

  it('accepts a distinct, well-formed key', () => {
    expect(checkConfig(full)).toEqual([]);
  });
});
