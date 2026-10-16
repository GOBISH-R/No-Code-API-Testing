import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// The limits on sign-up and sign-in have their own tests (rateLimits.test.js). Here
// every request comes from the same address, so they would stop the flows under test.
vi.mock('express-rate-limit', () => ({
  default: () => (_req, _res, next) => next(),
  rateLimit: () => (_req, _res, next) => next(),
  ipKeyGenerator: (ip) => ip,
}));
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import * as accounts from '../../src/services/accounts/accountService.js';
import { setMailTransport } from '../../src/services/accounts/mailer.js';
import { User } from '../../src/models/User.js';
import { PendingSignup } from '../../src/models/PendingSignup.js';
import { ValidationError } from '../../src/utils/errors.js';



/**
 * The account flows, against a real database.
 *
 * The rest of the suite is deliberately database-free, but these behaviours are
 * inseparable from persistence — "is this token single-use" is a question about what
 * survives a write. An in-memory MongoDB keeps it hermetic and offline.
 *
 * Emails are captured rather than sent, which also makes the tokens readable: the raw
 * token only ever exists in the message, by design.
 */

let mongo;
let sent = [];
// Flipped by tests to stand in for a mail server that refuses (as on a host blocking SMTP).
let mailDown = false;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  setMailTransport(async (message) => {
    if (mailDown) throw new Error('connect ETIMEDOUT smtp.example.com:465');
    sent.push(message);
    return { captured: true };
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

/** Pulls the token out of the most recent captured email. */
function tokenFromLastEmail() {
  const body = sent[sent.length - 1]?.text ?? '';
  return body.match(/token=([A-Za-z0-9_-]+)/)?.[1];
}

async function registerAndVerify(email = 'ada@example.com', password = 'correct horse battery') {
  await accounts.registerWithPassword({ email, password, name: 'Ada' });
  return accounts.verifyEmail(tokenFromLastEmail());
}

describe('signing up', () => {
  it('makes no account until the link is clicked — only a pending sign-up and an email', async () => {
    await accounts.registerWithPassword({
      email: 'ada@example.com',
      password: 'correct horse battery',
      name: 'Ada',
    });
    await new Promise((r) => setTimeout(r, 20)); // the email is sent in the background

    expect(await User.countDocuments()).toBe(0);
    expect(await PendingSignup.countDocuments({ email: 'ada@example.com' })).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/confirm/i);

    const user = await accounts.verifyEmail(tokenFromLastEmail());
    expect(user.emailVerified).toBe(true);
    expect(await User.countDocuments()).toBe(1);
    expect(await PendingSignup.countDocuments()).toBe(0);
  });

  it('normalizes the address, so Ada@Example.COM is the same account', async () => {
    await registerAndVerify('  Ada@Example.COM ');
    expect(await User.findOne({ email: 'ada@example.com' })).not.toBeNull();
  });

  it('never stores the password itself, pending or verified', async () => {
    await accounts.registerWithPassword({ email: 'ada@example.com', password: 'correct horse battery' });
    const pending = await PendingSignup.findOne({ email: 'ada@example.com' }).select('+passwordHash');
    expect(pending.passwordHash).toMatch(/^\$2[aby]\$/);
    await accounts.verifyEmail(tokenFromLastEmail());
    const user = await User.findOne({ email: 'ada@example.com' }).select('+passwordHash');
    expect(user.passwordHash).not.toContain('correct horse battery');
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('refuses a second account for an address already taken', async () => {
    await registerAndVerify();

    await expect(
      accounts.registerWithPassword({ email: 'ada@example.com', password: 'a totally different one' }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    expect(await User.countDocuments({ email: 'ada@example.com' })).toBe(1);
  });
  it('does not let a second signup overwrite the first account’s password', async () => {
    // The takeover this prevents: sign up as someone who already has an account and
    // have your password silently replace theirs.
    await registerAndVerify();
    await accounts
      .registerWithPassword({ email: 'ada@example.com', password: 'attacker chosen pw' })
      .catch(() => {});

    await expect(
      accounts.loginWithPassword({ email: 'ada@example.com', password: 'attacker chosen pw' }),
    ).rejects.toThrow(ValidationError);
    await expect(
      accounts.loginWithPassword({ email: 'ada@example.com', password: 'correct horse battery' }),
    ).resolves.toBeTruthy();
  });
  it('reports hasPassword truthfully even when the hash was not selected', async () => {
    // passwordHash is select:false, so a code path that did not ask for it used to see
    // undefined and report hasPassword:false for an account that had one.
    const user = await registerAndVerify();
    expect(user.toPublicJSON().hasPassword).toBe(true);
  });
});

describe('signing in', () => {
  it('treats an unconfirmed sign-up as no account at all', async () => {
    await accounts.registerWithPassword({
      email: 'ada@example.com',
      password: 'correct horse battery',
    });
    expect(await User.countDocuments()).toBe(0);

    await expect(
      accounts.loginWithPassword({ email: 'ada@example.com', password: 'correct horse battery' }),
    ).rejects.toThrow(/No account exists with this email/);
  });
  it('succeeds once confirmed', async () => {
    await registerAndVerify();
    const user = await accounts.loginWithPassword({
      email: 'ada@example.com',
      password: 'correct horse battery',
    });
    expect(user.emailVerified).toBe(true);
  });

  it('says plainly whether the address has no account or the password is wrong', async () => {
    // Sign-up already says "already exists", so a vague message here would hide nothing
    // from an attacker and only confuse the person typing.
    await registerAndVerify();

    await expect(accounts.loginWithPassword({ email: 'nobody@example.com', password: 'not the password' }))
      .rejects.toThrow(/No account exists with this email/);
    await expect(accounts.loginWithPassword({ email: 'ada@example.com', password: 'not the password' }))
      .rejects.toThrow(/Incorrect password/);
  });

  it('points a Google-only account to Google', async () => {
    await User.create({ email: 'g@example.com', emailVerified: true, googleId: 'g-1', name: 'G' });
    await expect(accounts.loginWithPassword({ email: 'g@example.com', password: 'whatever it is' }))
      .rejects.toThrow(/signs in with Google/);
  });
});

describe('confirming an address', () => {
  it('consumes the token, so the link works exactly once', async () => {
    await accounts.registerWithPassword({ email: 'ada@example.com', password: 'correct horse battery' });
    const token = tokenFromLastEmail();

    await accounts.verifyEmail(token);
    // Used up: a second use changes nothing, and says the address is confirmed already.
    await expect(accounts.verifyEmail(token)).rejects.toMatchObject({ code: 'ALREADY_VERIFIED' });
    expect((await User.findOne({ email: 'ada@example.com' })).emailVerified).toBe(true);
  });

  it('rejects a token that was never issued', async () => {
    await expect(accounts.verifyEmail('made-up-token')).rejects.toThrow(/no longer valid/i);
    await expect(accounts.verifyEmail('')).rejects.toThrow(/no longer valid/i);
  });

  it('rejects an expired token', async () => {
    await accounts.registerWithPassword({ email: 'ada@example.com', password: 'correct horse battery' });
    const token = tokenFromLastEmail();
    await PendingSignup.updateOne(
      { email: 'ada@example.com' },
      { tokenExpiresAt: new Date(Date.now() - 1000) },
    );

    await expect(accounts.verifyEmail(token)).rejects.toThrow(/expired/i);
  });

  it('stores the token only as a hash', async () => {
    await accounts.registerWithPassword({ email: 'ada@example.com', password: 'correct horse battery' });
    const token = tokenFromLastEmail();

    const pending = await PendingSignup.findOne({ email: 'ada@example.com' }).select('+tokenHash');
    expect(pending.tokenHash).toBeTruthy();
    expect(pending.tokenHash).not.toBe(token);
  });
});

describe('the name typed at sign-up', () => {
  it('may not hold line breaks or other control characters (it goes into email subjects)', async () => {
    await expect(
      accounts.registerWithPassword({ email: 'ada@example.com', password: 'correct horse battery', name: 'Ada\nBcc: x' }),
    ).rejects.toThrow(ValidationError);
  });

  it('is stored as given, and is the name the verification email greets', async () => {
    const user = await accounts.registerWithPassword({
      email: 'g1828@example.com', password: 'correct horse battery', name: '  Gobish R  ',
    });
    await new Promise((r) => setTimeout(r, 20)); // the email is sent in the background
    expect(user.name).toBe('Gobish R');
    expect(sent[sent.length - 1].text).toMatch(/^Hi Gobish R,/);
    expect(sent[sent.length - 1].html).toContain('Hi Gobish R,');
  });

  it('refuses a name over 80 characters', async () => {
    await expect(
      accounts.registerWithPassword({ email: 'x@example.com', password: 'correct horse battery', name: 'x'.repeat(81) }),
    ).rejects.toThrow(/under 80/);
    expect(await User.countDocuments({})).toBe(0);
  });
});

describe('the welcome step after sign-up', () => {
  const signUp = async () => {
    await accounts.registerWithPassword({ email: 'ada.lovelace@example.com', password: 'correct horse battery' });
    return accounts.verifyEmail(tokenFromLastEmail());
  };

  it('is pending on a new account, and public JSON says so', async () => {
    const user = await signUp();
    expect(user.toPublicJSON().needsWelcome).toBe(true);
  });

  it('is marked done, and never changes the name', async () => {
    const user = await signUp();
    await accounts.completeWelcome(user, { name: 'Someone Else' });

    const stored = await User.findById(user._id);
    expect(stored.name).toBe('Ada Lovelace');
    expect(stored.needsWelcome).toBe(false);
  });

  it('is never shown to accounts that existed before it', async () => {
    // A document written without the field, as older accounts were.
    await User.collection.insertOne({ email: 'old@example.com', mockKey: 'legacykey123', name: 'Old' });
    const legacy = await User.findOne({ email: 'old@example.com' });
    expect(legacy.toPublicJSON().needsWelcome).toBe(false);
  });
});

describe('"Stay signed in"', () => {
  const setCookie = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('vats.sid='));

  it('ticked (the default): the cookie survives closing the browser', async () => {
    const { default: app } = await import('../../src/app.js');
    const request = (await import('supertest')).default;
    await accounts.registerWithPassword({ email: 'ada@example.com', password: 'correct horse battery' });
    await accounts.verifyEmail(tokenFromLastEmail());

    const res = await request(app)
      .post('/api/accounts/login')
      .send({ email: 'ada@example.com', password: 'correct horse battery' })
      .expect(200);
    expect(setCookie(res)).toMatch(/Expires=/i);
  });

  it('unticked: a browser-session cookie with no expiry, dropped when the browser closes', async () => {
    const { default: app } = await import('../../src/app.js');
    const request = (await import('supertest')).default;
    await accounts.registerWithPassword({ email: 'ada@example.com', password: 'correct horse battery' });
    await accounts.verifyEmail(tokenFromLastEmail());

    const res = await request(app)
      .post('/api/accounts/login')
      .send({ email: 'ada@example.com', password: 'correct horse battery', remember: false })
      .expect(200);
    expect(setCookie(res)).toBeTruthy();
    expect(setCookie(res)).not.toMatch(/Expires=|Max-Age=/i);
  });
});

describe('only verified addresses get in', () => {
  const password = 'correct horse battery';
  let app;
  let request;

  beforeAll(async () => {
    app = (await import('../../src/app.js')).default;
    request = (await import('supertest')).default;
  });

  /**
   * A browser left waiting on its link. The account is made through the service and
   * the wait started by signing in: the HTTP sign-up route is rate-limited per address,
   * and every test here comes from the same one. (Sign-in also awaits its email, so the
   * link is in the inbox by the time this returns.)
   */
  // A browser that has just signed up and is waiting on the emailed link.
  async function waitingBrowser(extra = {}) {
    const browser = request.agent(app);
    const res = await browser.post('/api/accounts/register').send({ email: 'ada@example.com', password, ...extra });
    expect(res.status).toBe(202);
    return browser;
  }

  it('sign-up does not sign in: it waits for the emailed link', async () => {
    const browser = request.agent(app);
    const res = await browser.post('/api/accounts/register').send({ email: 'ada@example.com', password });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'verification_sent', email: 'ada@example.com' });
    await browser.get('/api/accounts/me').expect(401);
    await browser.get('/api/collections').expect(401);
    expect((await browser.get('/api/accounts/pending')).body.status).toBe('waiting');
  });

  it('lets the waiting browser in once the link is clicked, on any device', async () => {
    const browser = await waitingBrowser();
    // The link is opened somewhere else entirely, e.g. on a phone.
    await accounts.verifyEmail(tokenFromLastEmail());

    const res = await browser.get('/api/accounts/pending');
    expect(res.body.status).toBe('verified');
    expect(res.body.user.email).toBe('ada@example.com');
    await browser.get('/api/accounts/me').expect(200);
  });

  it('the waiting tab finishes when the link is opened in another tab of the same browser', async () => {
    const browser = await waitingBrowser();
    // Opening the link in a second tab signs this browser in and ends the wait...
    const link = tokenFromLastEmail();
    await browser.post('/api/accounts/verify-email').send({ token: link }).expect(200);

    // ...and the first tab, asking again, is told it is done rather than sent away.
    const res = await browser.get('/api/accounts/pending');
    await browser.get('/api/accounts/me').expect(200);
    expect(res.body.status).toBe('verified');
    expect(res.body.user.email).toBe('ada@example.com');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('the link opened on another device verifies, signs that device in to nothing, and lets the waiting browser in', async () => {
    const computer = await waitingBrowser();
    const phone = request.agent(app);
    const res = await phone.post('/api/accounts/verify-email').send({ token: tokenFromLastEmail() }).expect(200);
    expect(res.body).toEqual({ verified: true, sameBrowser: false });
    await phone.get('/api/accounts/me').expect(401);

    expect((await computer.get('/api/accounts/pending')).body.status).toBe('verified');
    await computer.get('/api/accounts/me').expect(200);
  });

  it('reports an expired link after ten minutes, and Resend starts the wait again', async () => {
    const browser = await waitingBrowser();
    // Wind the link's expiry back past its ten minutes.
    await PendingSignup.updateOne({ email: 'ada@example.com' }, { tokenExpiresAt: new Date(Date.now() - 1000) });

    expect((await browser.get('/api/accounts/pending')).body.status).toBe('expired');
    await expect(accounts.verifyEmail(tokenFromLastEmail())).rejects.toThrow(/expired/i);

    expect((await browser.post('/api/accounts/pending/resend')).body.status).toBe('waiting');
    expect((await browser.get('/api/accounts/pending')).body.status).toBe('waiting');
    await accounts.verifyEmail(tokenFromLastEmail());
    expect((await browser.get('/api/accounts/pending')).body.status).toBe('verified');
  });

  it('issues links that last ten minutes', async () => {
    await accounts.registerWithPassword({ email: 'ada@example.com', password });
    const pending = await PendingSignup.findOne({ email: 'ada@example.com' });
    const minutes = (pending.tokenExpiresAt - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(9.9);
    expect(minutes).toBeLessThanOrEqual(10);
  });

  it('never lets in a browser that did not ask for that link', async () => {
    await waitingBrowser();
    await accounts.verifyEmail(tokenFromLastEmail());

    const stranger = request.agent(app);
    expect((await stranger.get('/api/accounts/pending')).body.status).toBe('none');
    await stranger.get('/api/accounts/me').expect(401);
  });

  it('signing up again replaces an unconfirmed sign-up: the first browser and link stop working', async () => {
    const browserA = await waitingBrowser();
    const linkForA = tokenFromLastEmail();

    const browserB = request.agent(app);
    const res = await browserB
      .post('/api/accounts/register')
      .send({ email: 'ada@example.com', password: 'a different good password', name: 'Ada B' });
    expect(res.status).toBe(202);
    expect(await PendingSignup.countDocuments({ email: 'ada@example.com' })).toBe(1);
    expect(await User.countDocuments()).toBe(0);

    await expect(accounts.verifyEmail(linkForA)).rejects.toThrow(/no longer valid/i);
    expect((await browserA.get('/api/accounts/pending')).body.status).toBe('gone');

    await accounts.verifyEmail(tokenFromLastEmail());
    expect((await browserB.get('/api/accounts/pending')).body.status).toBe('verified');
    const user = await accounts.loginWithPassword({ email: 'ada@example.com', password: 'a different good password' });
    expect(user.name).toBe('Ada B');
  });

  it('signing in to an unconfirmed sign-up reports no account, and sends nothing', async () => {
    await accounts.registerWithPassword({ email: 'ada@example.com', password });
    await new Promise((r) => setTimeout(r, 20)); // let the sign-up email land
    const before = sent.length;

    const browser = request.agent(app);
    const res = await browser.post('/api/accounts/login').send({ email: 'ada@example.com', password });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/No account exists with this email/);
    await browser.get('/api/accounts/me').expect(401);
    expect(sent.length).toBe(before);
  });

  it('Resend retires the previous link, and the newest one lets the browser in', async () => {
    const browser = await waitingBrowser();
    const oldLink = tokenFromLastEmail();

    expect((await browser.post('/api/accounts/pending/resend')).body.status).toBe('waiting');
    const newLink = tokenFromLastEmail();
    expect(newLink).not.toBe(oldLink);
    await expect(accounts.verifyEmail(oldLink)).rejects.toThrow(/no longer valid/i);

    await accounts.verifyEmail(newLink);
    expect((await browser.get('/api/accounts/pending')).body.status).toBe('verified');
  });

  it('keeps "Stay signed in" unticked through the wait', async () => {
    const browser = await waitingBrowser({ remember: false });
    await accounts.verifyEmail(tokenFromLastEmail());

    const res = await browser.get('/api/accounts/pending');
    const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('vats.sid='));
    expect(cookie).toBeTruthy();
    expect(cookie).not.toMatch(/Expires=|Max-Age=/i);
  });

  it('still refuses a second sign-up for a confirmed account', async () => {
    await registerAndVerify();
    const res = await request(app)
      .post('/api/accounts/register')
      .send({ email: 'ada@example.com', password: 'another good password' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already exists/i);
  });
});

describe('the edges of signing in and out', () => {
  const password = 'correct horse battery';
  let app;
  let request;

  beforeAll(async () => {
    app = (await import('../../src/app.js')).default;
    request = (await import('supertest')).default;
  });
  const signedInBrowser = async () => {
    const browser = request.agent(app);
    await browser.post('/api/accounts/login').send({ email: 'ada@example.com', password }).expect(200);
    return browser;
  };

  it('"Use a different email" stops this browser waiting, so a reload does not resume it', async () => {
    const browser = request.agent(app);
    await browser.post('/api/accounts/register').send({ email: 'ada@example.com', password }).expect(202);
    expect((await browser.get('/api/accounts/pending')).body.status).toBe('waiting');

    await browser.delete('/api/accounts/pending').expect(204);
    expect((await browser.get('/api/accounts/pending')).body.status).toBe('none');
  });

  it('a link opened a second time is no longer valid', async () => {
    await accounts.registerWithPassword({ email: 'ada@example.com', password });
    const link = tokenFromLastEmail();
    await accounts.verifyEmail(link);

    const again = await request(app).post('/api/accounts/verify-email').send({ token: link });
    expect(again.status).toBe(400);
    expect(again.body).toMatchObject({ code: 'ALREADY_VERIFIED', message: 'This link is no longer valid.' });

    // A link that never existed is still just not valid.
    const bogus = await request(app).post('/api/accounts/verify-email').send({ token: 'not-a-real-token' });
    expect(bogus.body.code).toBeUndefined();
  });
});

describe('when an account appears while a link waits', () => {
  it('a password sign-up does not replace it: the link reports the account exists', async () => {
    await accounts.registerWithPassword({ email: 'ada@example.com', password: 'correct horse battery' });
    const link = tokenFromLastEmail();
    // Meanwhile the same address became an account another way.
    await User.create({ email: 'ada@example.com', emailVerified: true, name: 'Ada', googleId: 'g-1' });

    await expect(accounts.verifyEmail(link)).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    expect(await User.countDocuments()).toBe(1);
    expect(await PendingSignup.countDocuments()).toBe(0);
  });

  it('signing up for a taken address sends no link at all', async () => {
    await registerAndVerify();
    const before = sent.length;
    await expect(
      accounts.registerWithPassword({ email: 'ada@example.com', password: 'another good password' }),
    ).rejects.toThrow('An account with this email already exists.');
    expect(sent.length).toBe(before);
    expect(await PendingSignup.countDocuments()).toBe(0);
  });
});

describe('forgot password: "Is this you?" by email, the new password on the sign-in page', () => {
  const password = 'correct horse battery';
  const CHROME_ON_WINDOWS =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  let app;
  let request;

  beforeAll(async () => {
    app = (await import('../../src/app.js')).default;
    request = (await import('supertest')).default;
  });

  /** Presses "Forgot password?" in a fresh browser; returns it and the emailed token. */
  async function askForReset(browser = request.agent(app)) {
    const res = await browser
      .post('/api/accounts/forgot-password')
      .set('User-Agent', CHROME_ON_WINDOWS)
      .send({ email: 'ada@example.com' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'confirmation_sent', email: 'ada@example.com' });
    return { browser, token: tokenFromLastEmail() };
  }

  const answer = (token, value, browser = request.agent(app)) =>
    browser.post('/api/accounts/reset/answer').send({ token, answer: value });
  const statusOf = async (browser) => (await browser.get('/api/accounts/reset/pending')).body.status;

  it('emails "Is this you?" with Yes and No, the browser and the time, and the page waits', async () => {
    await registerAndVerify();
    const { browser, token } = await askForReset();

    const email = sent.at(-1);
    expect(email.subject).toMatch(/is this you/i);
    expect(email.text).toContain('Chrome on Windows');
    expect(email.text).toMatch(/answer=yes/);
    expect(email.text).toMatch(/answer=no/);
    expect(email.text).toMatch(/UTC/);
    expect(await statusOf(browser)).toBe('waiting');
    expect(token).toBeTruthy();
  });

  it('says there is no account — for an unknown address and for a sign-up never verified', async () => {
    await accounts.registerWithPassword({ email: 'pending@example.com', password });
    await new Promise((r) => setTimeout(r, 20));
    const before = sent.length;
    for (const email of ['nobody@example.com', 'pending@example.com']) {
      const res = await request(app).post('/api/accounts/forgot-password').send({ email });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('No account exists with this email.');
    }
    expect(sent.length).toBe(before);
  });

  it('Yes lets the asking page set the password: it is signed in, and every other browser is signed out', async () => {
    await registerAndVerify('ada@example.com', password);
    const laptop = request.agent(app);
    await laptop.post('/api/accounts/login').send({ email: 'ada@example.com', password }).expect(200);
    await new Promise((r) => setTimeout(r, 5)); // the reset happens strictly later

    const { browser, token } = await askForReset();
    // Not before the email is answered.
    const early = await browser.post('/api/accounts/reset/complete').send({ password: 'a brand new passphrase' });
    expect(early.status).toBe(400);
    expect(early.body.code).toBe('RESET_NOT_CONFIRMED');

    // "Yes, it's me", pressed on the phone the email was read on.
    const yes = await answer(token, 'yes');
    expect(yes.body).toEqual({ answer: 'yes', sameBrowser: false });
    expect(await statusOf(browser)).toBe('confirmed');

    await browser.post('/api/accounts/reset/complete').send({ password: 'a brand new passphrase' }).expect(200);
    await browser.get('/api/collections').expect(200);
    await laptop.get('/api/collections').expect(401);

    await request(app).post('/api/accounts/login').send({ email: 'ada@example.com', password }).expect(401);
    await request(app)
      .post('/api/accounts/login')
      .send({ email: 'ada@example.com', password: 'a brand new passphrase' })
      .expect(200);

    // Single use.
    expect((await answer(token, 'yes')).body.code).toBe('RESET_LINK_INVALID');
  });

  it('the email alone never sets a password: only the browser that asked can', async () => {
    await registerAndVerify();
    const { token } = await askForReset();
    const elsewhere = request.agent(app);
    await answer(token, 'yes', elsewhere).expect(200);

    const res = await elsewhere.post('/api/accounts/reset/complete').send({ password: 'a brand new passphrase' });
    expect(res.status).toBe(400);
    await request(app).post('/api/accounts/login').send({ email: 'ada@example.com', password }).expect(200);
  });

  it('No cancels it: the page is told, and the password stays the same', async () => {
    await registerAndVerify();
    const { browser, token } = await askForReset();

    expect((await answer(token, 'no')).body.answer).toBe('no');
    expect(await statusOf(browser)).toBe('denied');
    expect(await statusOf(browser)).toBe('none'); // told once, then this browser stops waiting

    const late = await answer(token, 'yes');
    expect(late.status).toBe(400);
    expect(late.body.message).toBe('This link is no longer valid.');
    expect((await browser.post('/api/accounts/reset/complete').send({ password: 'a brand new passphrase' })).status).toBe(400);
    await request(app).post('/api/accounts/login').send({ email: 'ada@example.com', password }).expect(200);
  });

  it('one press spends the email: neither button works again, and the first answer stands', async () => {
    await registerAndVerify();
    const { browser, token } = await askForReset();
    await answer(token, 'yes').expect(200);

    for (const again of ['no', 'yes']) {
      const res = await answer(token, again);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('This link is no longer valid.');
    }
    expect(await statusOf(browser)).toBe('confirmed');
  });

  it('tells the page behind the button when it is the browser that asked', async () => {
    await registerAndVerify();
    const { browser, token } = await askForReset();
    expect((await answer(token, 'yes', browser)).body).toEqual({ answer: 'yes', sameBrowser: true });
  });

  it('Resend sends a new email, and the old one’s buttons stop working', async () => {
    await registerAndVerify();
    const { browser, token: first } = await askForReset();
    const res = await browser.post('/api/accounts/reset/pending/resend').expect(200);
    expect(res.body.status).toBe('waiting');
    const second = tokenFromLastEmail();
    expect(second).not.toBe(first);

    expect((await answer(first, 'yes')).body.code).toBe('RESET_LINK_INVALID');
    await answer(second, 'yes').expect(200);
    expect(await statusOf(browser)).toBe('confirmed');
  });

  it('a newer request replaces the older one; the older page stops waiting', async () => {
    await registerAndVerify();
    const { browser: older } = await askForReset();
    await askForReset();
    expect(await statusOf(older)).toBe('gone');
  });

  it('runs out after fifteen minutes', async () => {
    await registerAndVerify();
    const { browser, token } = await askForReset();
    await User.updateOne({ email: 'ada@example.com' }, { resetTokenExpiresAt: new Date(Date.now() - 1000) });

    expect(await statusOf(browser)).toBe('expired');
    expect((await answer(token, 'yes')).body.code).toBe('RESET_EXPIRED');
  });

  it('still applies the password rules', async () => {
    await registerAndVerify();
    const { browser, token } = await askForReset();
    await answer(token, 'yes').expect(200);
    expect((await browser.post('/api/accounts/reset/complete').send({ password: 'short' })).status).toBe(400);
    // The request is still open: a good password works after a bad one.
    await browser.post('/api/accounts/reset/complete').send({ password: 'a brand new passphrase' }).expect(200);
  });

  it('"Back to sign in" stops this browser waiting', async () => {
    await registerAndVerify();
    const { browser } = await askForReset();
    await browser.delete('/api/accounts/reset/pending').expect(204);
    expect(await statusOf(browser)).toBe('none');
  });
});

describe('when the mail server is down (e.g. SMTP blocked by the host)', () => {
  const password = 'correct horse battery';
  let app;
  let request;

  beforeAll(async () => {
    app = (await import('../../src/app.js')).default;
    request = (await import('supertest')).default;
  });

  afterEach(() => {
    mailDown = false;
  });

  it('sign-up says the email could not be sent, instead of waiting for one that never left', async () => {
    mailDown = true;
    const browser = request.agent(app);
    const res = await browser.post('/api/accounts/register').send({ email: 'ada@example.com', password });
    expect(res.status).toBe(503);
    expect(res.body.message).toBe('We couldn’t send the email right now. Try again in a moment.');
    expect((await browser.get('/api/accounts/pending')).body.status).toBe('none');

    // Once mail works again, signing up simply sends the link.
    mailDown = false;
    await browser.post('/api/accounts/register').send({ email: 'ada@example.com', password }).expect(202);
    expect((await browser.get('/api/accounts/pending')).body.status).toBe('waiting');
  });

  it('a failed Resend changes nothing: the page keeps waiting and the emailed link still works', async () => {
    const browser = request.agent(app);
    await browser.post('/api/accounts/register').send({ email: 'ada@example.com', password }).expect(202);
    const link = tokenFromLastEmail();

    mailDown = true;
    const resend = await browser.post('/api/accounts/pending/resend');
    expect(resend.status).toBe(503);
    expect(resend.body.message).toBe('We couldn’t send the email right now. Try again in a moment.');

    // The bug this guards against: the wait used to end ("gone") and the box vanished.
    expect((await browser.get('/api/accounts/pending')).body.status).toBe('waiting');
    mailDown = false;
    await browser.post('/api/accounts/verify-email').send({ token: link }).expect(200);
    expect((await browser.get('/api/accounts/pending')).body.status).toBe('verified');
  });

  it('a failed password-reset Resend keeps the request and its emailed link', async () => {
    await registerAndVerify('ada@example.com', password);
    const browser = request.agent(app);
    await browser.post('/api/accounts/forgot-password').send({ email: 'ada@example.com' }).expect(202);
    const link = tokenFromLastEmail();

    mailDown = true;
    expect((await browser.post('/api/accounts/reset/pending/resend')).status).toBe(503);
    expect((await browser.get('/api/accounts/reset/pending')).body.status).toBe('waiting');

    mailDown = false;
    await request(app).post('/api/accounts/reset/answer').send({ token: link, answer: 'yes' }).expect(200);
    expect((await browser.get('/api/accounts/reset/pending')).body.status).toBe('confirmed');
  });

  it('Forgot password says the email could not be sent', async () => {
    await registerAndVerify('ada@example.com', password);
    mailDown = true;
    const res = await request(app).post('/api/accounts/forgot-password').send({ email: 'ada@example.com' });
    expect(res.status).toBe(503);
  });
});
