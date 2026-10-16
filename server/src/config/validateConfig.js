/**
 * Checks the configuration a production deployment cannot run correctly without.
 *
 * Both of these have development-friendly fallbacks elsewhere — a missing database is
 * only a warning, and the CORS origin defaults to the Vite dev server — which is right
 * for local work and actively harmful in production. Unset, they produce a server that
 * starts, reports itself healthy, and then fails every real request: the database calls
 * throw, or the browser is refused by CORS for an origin nobody configured. Failing at
 * startup with the variable's name is far cheaper to diagnose.
 */

const REQUIRED_IN_PRODUCTION = [
  ['MONGODB_URI', 'the database connection string'],
  ['CLIENT_URL', 'the frontend origin allowed by CORS and the WebSocket gateway'],
  ['SESSION_SECRET', 'the key session cookies are signed with'],
  ['MAIL_FROM', 'the address verification and reset emails are sent from'],
  ['SMTP_URL', 'the mail transport, without which password reset silently fails'],
  ['ENCRYPTION_KEY', 'the key stored API credentials are encrypted with'],
];

// A session secret is the key to every account. These are the values that appear in
// tutorials and .env.example files, and one of them reaching production would let
// anyone forge a session cookie for any user.
const UNSAFE_SECRETS = new Set([
  'secret', 'changeme', 'change-me', 'keyboard cat', 'session-secret',
  'your-secret-here', 'supersecret', 'dev', 'development', 'test',
]);

const MIN_SECRET_LENGTH = 32;

// Kept as one constant so the two error paths cannot drift, and so the nested quoting
// lives in exactly one place.
// Reusing one secret for two purposes means a leak of either compromises both.
const SESSION_SECRET_REUSE_CHECK = (env) => (env.SESSION_SECRET || '').trim().toLowerCase();

const GENERATE_SECRET_HINT =
  'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

function isLocal(url) {
  try {
    return LOCAL_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Returns non-fatal warnings, or throws when the process must not start.
 *
 * Outside production this does nothing: local development deliberately runs without a
 * database and against localhost.
 */
export function checkConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return [];

  const missing = REQUIRED_IN_PRODUCTION.filter(([name]) => !env[name]?.trim());
  if (missing.length > 0) {
    const described = missing.map(([name, why]) => `${name} (${why})`).join(', ');
    throw new Error(
      `Missing required production configuration: ${described}. ` +
        'Set it in the environment, or run with NODE_ENV unset for local development.',
    );
  }

  // A weak session secret is not a missing value, so the check above cannot catch it —
  // and it is every bit as fatal.
  const secret = env.SESSION_SECRET.trim();
  if (UNSAFE_SECRETS.has(secret.toLowerCase())) {
    throw new Error(
      'SESSION_SECRET is a well-known placeholder. Anyone could forge a session cookie ' +
        `with it. Generate one: ${GENERATE_SECRET_HINT}`,
    );
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET is ${secret.length} characters; use at least ${MIN_SECRET_LENGTH}. ` +
        `Generate one: ${GENERATE_SECRET_HINT}`,
    );
  }

  // A 32-byte key as 64 hex characters. Checked at startup rather than on first
  // save: discovering a malformed key when someone tries to store a token means the
  // failure surfaces to a user, not to whoever deployed it.
  const encryptionKey = env.ENCRYPTION_KEY.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new Error(
      'ENCRYPTION_KEY must be 32 bytes as 64 hex characters. ' +
        `Generate one: ${GENERATE_SECRET_HINT}`,
    );
  }
  if (encryptionKey.toLowerCase() === SESSION_SECRET_REUSE_CHECK(env)) {
    throw new Error(
      'ENCRYPTION_KEY and SESSION_SECRET must be different keys. Reusing one means a ' +
        'leak of either compromises both sessions and stored credentials.',
    );
  }

  const warnings = [];

  // Google sign-in is optional: configure both halves and the button appears, configure
  // neither and it does not. Exactly one is always a mistake, and it fails at the
  // callback — long after startup, and only for the person trying to sign in.
  const hasGoogleId = Boolean(env.GOOGLE_CLIENT_ID?.trim());
  const hasGoogleSecret = Boolean(env.GOOGLE_CLIENT_SECRET?.trim());
  if (hasGoogleId !== hasGoogleSecret) {
    throw new Error(
      'Google sign-in needs both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither. ' +
        `Currently ${hasGoogleId ? 'only the id' : 'only the secret'} is set.`,
    );
  }
  if (!hasGoogleId) {
    warnings.push('Google sign-in is not configured; only email and password will be offered.');
  }

  // Not fatal — a private deployment may genuinely proxy through localhost — but it is
  // almost always a config file that was copied from .env.example and never edited.
  if (isLocal(env.CLIENT_URL)) {
    warnings.push(
      `CLIENT_URL is "${env.CLIENT_URL}", which only permits a browser on this machine. ` +
        'Set it to the address users actually load the app from.',
    );
  }

  if (isLocal(env.MONGODB_URI) && !env.MONGODB_URI.includes('mongodb+srv')) {
    warnings.push('MONGODB_URI points at localhost — confirm that is the intended database.');
  }

  return warnings;
}
