import session from 'express-session';
import MongoStore from 'connect-mongo';


/**
 * Session configuration.
 *
 * Sessions rather than a JWT in localStorage, for two reasons that matter here:
 * a server-side session can be revoked (sign out everywhere, a compromised account
 * locked immediately), and an httpOnly cookie is not readable by script, so an XSS bug
 * cannot walk off with the credential. A token in localStorage gives up both.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * DAY_MS;

/**
 * Chooses where sessions are kept.
 *
 * MongoStore is given a URL rather than mongoose's client because this runs at import
 * time, before connectDB() — asking mongoose for a client here would throw. With a URL
 * connect-mongo dials lazily on first use, which is exactly the timing we need.
 *
 * With no database configured it falls back to express-session's in-memory store. That
 * is the offline-development and test path: sessions vanish on restart, which is fine
 * when there is no database to persist anything else to either. Production cannot
 * reach this branch — checkConfig refuses to start without MONGODB_URI.
 */
function buildStore() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return undefined; // express-session's MemoryStore

  return MongoStore.create({
    mongoUrl: uri,
    ttl: SESSION_TTL_MS / 1000,
    // Only rewrite the store if a session is more than a day past its last touch, so
    // `rolling` does not mean a database write on every single request.
    touchAfter: DAY_MS / 1000,
    collectionName: 'sessions',
  });
}

/**
 * A development-only signing key.
 *
 * Fixed rather than random so sessions survive a restart while you work. It is safe
 * only because production refuses to start without a real SESSION_SECRET — and it is
 * named to be unmistakable if it ever shows up somewhere it should not.
 */
const DEV_SECRET = 'insecure-development-only-session-secret-do-not-deploy';

export function buildSessionMiddleware() {
  const isProduction = process.env.NODE_ENV === 'production';

  return session({
    name: 'vats.sid',
    secret: process.env.SESSION_SECRET || DEV_SECRET,
    // Nothing to write unless the session changed — avoids a store write per request.
    resave: false,
    // No cookie for anonymous visitors; one is issued when they actually sign in.
    saveUninitialized: false,
    rolling: true, // active use extends the session rather than expiring mid-work
    store: buildStore(),
    cookie: {
      httpOnly: true, // script cannot read it, so XSS cannot steal the session
      secure: isProduction, // HTTPS only in production; plain http locally
      // 'lax' rather than 'strict': the Google sign-in redirect arrives as a
      // cross-site GET, and 'strict' would withhold the cookie and break the callback.
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
    },
  });
}

/**
 * Replaces the session id while keeping its contents.
 *
 * Called on every sign-in. Without it an attacker who can set a victim's cookie before
 * they log in still holds a valid session afterwards — session fixation.
 */
export function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    const data = { ...req.session };
    req.session.regenerate((err) => {
      if (err) return reject(err);
      Object.assign(req.session, data);
      return req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

export function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}
