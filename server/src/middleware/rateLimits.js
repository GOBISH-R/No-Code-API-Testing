import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Rate limits for a multi-user deployment.
 *
 * Counting by IP alone breaks in both directions once many people use the app: a whole
 * office behind one NAT shares a single budget and locks itself out, while one person
 * rotating addresses gets a fresh budget each time. So a signed-in request is counted
 * against its account, and only anonymous traffic falls back to the IP.
 *
 * `ipKeyGenerator` collapses an IPv6 address to its /56, since a single client
 * typically controls a whole block and would otherwise get unlimited keys.
 */
export function accountOrIpKey(req) {
  const userId = req.user?._id ?? req.session?.userId;
  return userId ? `user:${userId}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

export const API_LIMITS = {
  WINDOW_MS: 15 * 60 * 1000,
  // Somebody working in the app — opening collections, sending requests, running
  // suites — makes far more calls than an anonymous visitor ever should.
  SIGNED_IN: 1500,
  ANONYMOUS: 300,
  EXECUTE_PER_MINUTE: 60,
};

const common = {
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: accountOrIpKey,
  message: { status: 'error', message: 'Too many requests. Slow down and try again shortly.' },
};

/** The general /api budget. Must be mounted after the session and attachUser. */
export const apiLimiter = rateLimit({
  ...common,
  windowMs: API_LIMITS.WINDOW_MS,
  limit: (req) => (req.user ? API_LIMITS.SIGNED_IN : API_LIMITS.ANONYMOUS),
});

/** Tighter: every call here makes an outbound HTTP request on the user's behalf. */
export const executeLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: API_LIMITS.EXECUTE_PER_MINUTE,
});

/**
 * How many reverse proxies sit in front of this server.
 *
 * Behind a load balancer every request arrives from the balancer's address, so without
 * this all users share one rate-limit bucket. But trusting X-Forwarded-For when there
 * is no proxy lets any client claim to be any address and dodge the limits — so it is
 * off unless configured, and only a hop count is accepted, never "trust everything".
 */
export function parseTrustProxy(value) {
  if (value === undefined || value === null || String(value).trim() === '') return false;
  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
    throw new Error('TRUST_PROXY must be the number of proxies in front of the server (0–10).');
  }
  return hops === 0 ? false : hops;
}

const EMAIL_LIMITS = {
  // One email a minute for the same thing: a second "Create account", "Forgot password?"
  // or "Resend" inside the minute is refused rather than sending another copy.
  PER_MINUTE: 1,
  // And a ceiling per network, so nobody can mail a long list of addresses one by one.
  PER_HOUR_PER_IP: 20,
};

const TOO_MANY_EMAILS = { status: 'error', message: 'Too many requests. Try again later.' };

// Only emails actually sent count: "No account exists" or a mistyped address does not
// use up the minute.
const emailCommon = {
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  message: TOO_MANY_EMAILS,
};

const emailHourlyCap = rateLimit({
  ...emailCommon,
  windowMs: 60 * 60 * 1000,
  limit: EMAIL_LIMITS.PER_HOUR_PER_IP,
  keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? '')}`,
});

/** The address typed into the form — sign-up and Forgot password. */
export const byEmailAddress = (req) => `email:${String(req.body?.email ?? '').trim().toLowerCase()}`;
/** This browser's session — Resend, where the address is the one already waiting. */
export const byBrowser = (req) => `browser:${req.sessionID ?? ''}`;

/**
 * The limits for an endpoint that sends an email: once a minute per `keyFor` (each
 * endpoint keeps its own count), within the shared hourly ceiling for the network.
 */
export function emailLimits(keyFor) {
  const perMinute = rateLimit({
    ...emailCommon,
    windowMs: 60 * 1000,
    limit: EMAIL_LIMITS.PER_MINUTE,
    keyGenerator: keyFor,
  });
  return [perMinute, emailHourlyCap];
}
