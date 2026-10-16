import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { findOrCreateFromGoogle, buildAuthorizationUrl, isGoogleConfigured } from '../../src/services/accounts/googleAuth.js';
import * as accounts from '../../src/services/accounts/accountService.js';
import { setMailTransport } from '../../src/services/accounts/mailer.js';
import { User } from '../../src/models/User.js';
import { PendingSignup } from '../../src/models/PendingSignup.js';



/**
 * Account linking.
 *
 * This is where a system offering both passwords and Google gets breached, so every
 * rule has a test naming the attack it stops. The profiles here stand in for what
 * Google returns; the network call is not the interesting part, the decision is.
 */

let mongo;
let sent = [];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  setMailTransport(async (m) => {
    sent.push(m);
  });
}, 60_000);

afterAll(async () => {
  setMailTransport(null);
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  sent = [];
  await User.deleteMany({});
  await PendingSignup.deleteMany({});
});

/** A first Google sign-up: emailed like any other, and the account made from the link. */
async function googleSignUp(profile = googleProfile()) {
  const found = await findOrCreateFromGoogle(profile);
  expect(found.user).toBeNull();
  await accounts.registerWithGoogle(profile);
  await new Promise((r) => setTimeout(r, 20)); // the email is sent in the background
  return accounts.verifyEmail(tokenFromLastEmail());
}

const googleProfile = (overrides = {}) => ({
  googleId: 'google-sub-12345',
  email: 'ada@example.com',
  emailVerified: true,
  name: 'Ada Lovelace',
  avatarUrl: 'https://example.com/ada.png',
  ...overrides,
});

function tokenFromLastEmail() {
  return (sent[sent.length - 1]?.text ?? '').match(/token=([A-Za-z0-9_-]+)/)?.[1];
}

describe('signing in with Google for the first time', () => {
  it('makes no account straight away: it emails a link, like every sign-up', async () => {
    const { user } = await findOrCreateFromGoogle(googleProfile());
    expect(user).toBeNull();
    await accounts.registerWithGoogle(googleProfile());
    await new Promise((r) => setTimeout(r, 20));
    expect(await User.countDocuments()).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ada@example.com');
  });

  it('creates a verified account with no password once the link is clicked', async () => {
    const user = await googleSignUp();

    expect(user.email).toBe('ada@example.com');
    expect(user.emailVerified).toBe(true);
    expect(user.toPublicJSON().hasPassword).toBe(false);
    expect(user.toPublicJSON().hasGoogle).toBe(true);
    // Google gives the real name, so there is nothing to confirm: no welcome step.
    expect(user.toPublicJSON().needsWelcome).toBe(false);
  });

  it('gives the new account its own mock key', async () => {
    const user = await googleSignUp();
    expect(user.mockKey).toBeTruthy();
  });

  it('signs straight in to that account next time, rather than duplicating', async () => {
    const first = await googleSignUp();
    const second = await findOrCreateFromGoogle(googleProfile());

    expect(String(second.user._id)).toBe(String(first._id));
    expect(await User.countDocuments({})).toBe(1);
  });

  it('follows the Google id, not the address, when an address changes', async () => {
    // Someone changes their Google email. Same sub, so it is the same person.
    await googleSignUp();
    const { user } = await findOrCreateFromGoogle(googleProfile({ email: 'ada.lovelace@example.com' }));

    expect(await User.countDocuments({})).toBe(1);
    expect(user.googleId).toBe('google-sub-12345');
  });
});

describe('Google must have proved the address', () => {
  it('refuses a profile Google has not verified', async () => {
    // An unverified Google address proves nothing, and accepting it would let someone
    // attach an address they do not own — then link to a real account through it.
    await expect(findOrCreateFromGoogle(googleProfile({ emailVerified: false }))).rejects.toThrow(
      /unverified/i,
    );
    expect(await User.countDocuments({})).toBe(0);
  });

  it('refuses a profile with no address or no subject', async () => {
    await expect(findOrCreateFromGoogle(googleProfile({ email: '' }))).rejects.toThrow();
    await expect(findOrCreateFromGoogle(googleProfile({ googleId: null }))).rejects.toThrow();
  });
});

describe('linking to an existing password account', () => {
  it('links when the address was already confirmed, keeping the password', async () => {
    await accounts.registerWithPassword({
      email: 'ada@example.com',
      password: 'correct horse battery',
      name: 'Ada',
    });
    await accounts.verifyEmail(tokenFromLastEmail());

    const { user, linked } = await findOrCreateFromGoogle(googleProfile());

    expect(linked).toBe(true);
    expect(await User.countDocuments({})).toBe(1);

    // Both methods now work for the same person.
    expect(user.toPublicJSON().hasPassword).toBe(true);
    expect(user.toPublicJSON().hasGoogle).toBe(true);
    await expect(
      accounts.loginWithPassword({ email: 'ada@example.com', password: 'correct horse battery' }),
    ).resolves.toBeTruthy();
  });

  it('a password planted by an unverified sign-up never reaches the account', async () => {
    // The attack: Mallory signs up as ada@example.com with a password she chooses, but
    // cannot click the link — it went to Ada. No account exists, only a pending sign-up.
    await accounts.registerWithPassword({ email: 'ada@example.com', password: 'mallory chosen pw', name: 'Not Ada' });
    const plantedToken = tokenFromLastEmail();
    expect(await User.countDocuments()).toBe(0);

    // Ada signs up with Google: that replaces the pending sign-up, and her link makes the account.
    const user = await googleSignUp();
    expect(user.toPublicJSON().hasPassword).toBe(false);
    await expect(
      accounts.loginWithPassword({ email: 'ada@example.com', password: 'mallory chosen pw' }),
    ).rejects.toThrow();
    // And Mallory's link died with her sign-up.
    await expect(accounts.verifyEmail(plantedToken)).rejects.toThrow(/no longer valid/i);
  });

  it('does not overwrite a name the account already had', async () => {
    await accounts.registerWithPassword({
      email: 'ada@example.com',
      password: 'correct horse battery',
      name: 'Ada L.',
    });
    await accounts.verifyEmail(tokenFromLastEmail());

    const { user } = await findOrCreateFromGoogle(googleProfile({ name: 'Ada Lovelace' }));
    expect(user.name).toBe('Ada L.');
  });

  it('replaces a name guessed from the email with the real one from Google', async () => {
    await accounts.registerWithPassword({ email: 'ada@example.com', password: 'correct horse battery' });
    await accounts.verifyEmail(tokenFromLastEmail());

    const { user } = await findOrCreateFromGoogle(googleProfile({ name: 'Ada Lovelace' }));
    expect(user.name).toBe('Ada Lovelace');
  });

  it('keeps one account, not two, for the same person', async () => {
    await accounts.registerWithPassword({ email: 'ada@example.com', password: 'correct horse battery' });
    await accounts.verifyEmail(tokenFromLastEmail());
    await findOrCreateFromGoogle(googleProfile());

    expect(await User.countDocuments({})).toBe(1);
  });

  it('does not link across different addresses', async () => {
    await accounts.registerWithPassword({ email: 'ada@example.com', password: 'correct horse battery' });
    await accounts.verifyEmail(tokenFromLastEmail());

    const { user } = await findOrCreateFromGoogle(googleProfile({ email: 'grace@example.com' }));
    expect(user).toBeNull(); // a new sign-up for grace@, not a link to ada@

    await googleSignUp(googleProfile({ email: 'grace@example.com' }));
    expect(await User.countDocuments({})).toBe(2);
  });
});

describe('the authorization request', () => {
  const ORIGINAL = { ...process.env };
  afterAll(() => {
    process.env.GOOGLE_CLIENT_ID = ORIGINAL.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = ORIGINAL.GOOGLE_CLIENT_SECRET;
  });

  it('refuses to start when Google is not configured', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(isGoogleConfigured()).toBe(false);
    expect(() => buildAuthorizationUrl()).toThrow(/not configured/i);
  });

  it('carries state and a PKCE challenge, and never the verifier', () => {
    process.env.GOOGLE_CLIENT_ID = 'test-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

    const { url, state, codeVerifier } = buildAuthorizationUrl();
    const params = new URL(url).searchParams;

    // state is the CSRF defence; the challenge is the hash, and the verifier it was
    // derived from must never leave the server.
    expect(params.get('state')).toBe(state);
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toBeTruthy();
    expect(params.get('code_challenge')).not.toBe(codeVerifier);
    expect(url).not.toContain(codeVerifier);

    // And the secret is never in a URL the browser follows.
    expect(url).not.toContain('test-secret');
  });

  it('produces a different state and verifier every time', () => {
    process.env.GOOGLE_CLIENT_ID = 'test-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

    const a = buildAuthorizationUrl();
    const b = buildAuthorizationUrl();
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});
