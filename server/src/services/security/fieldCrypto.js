import crypto from 'node:crypto';

/**
 * Encrypting the credentials a saved request carries.
 *
 * What this protects against: a database dump, a stolen backup, a misconfigured
 * cluster. Those hand over every user's API keys in cleartext today. What it does
 * *not* protect against is the signed-in owner reading their own secrets — they need
 * them to edit the request, and the server decrypts on their behalf.
 *
 * Applied explicitly in the service layer rather than as Mongoose getters/setters,
 * which would be tidier but wrong here: getters do not run on `.lean()` queries, and
 * most reads in this codebase are lean. Schema getters would have returned ciphertext
 * to the UI on exactly the paths that matter most.
 */

const ALGORITHM = 'aes-256-gcm';

/**
 * Version marker.
 *
 * Present so two things are possible: telling ciphertext from the plaintext already in
 * the database (so existing rows keep working and re-encrypt on next write), and
 * changing algorithm later without guessing at what old values are.
 */
const PREFIX = 'enc:v1:';

const GENERATE_KEY_HINT =
  'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';

/**
 * A development-only key.
 *
 * Fixed so encrypted rows survive a restart while you work, and named to be
 * unmistakable if it ever appears somewhere it should not. Production cannot reach it:
 * checkConfig refuses to start without a real ENCRYPTION_KEY.
 */
const DEV_KEY = crypto
  .createHash('sha256')
  .update('insecure-development-only-encryption-key-do-not-deploy')
  .digest();

function resolveKey() {
  const configured = process.env.ENCRYPTION_KEY?.trim();
  if (!configured) return DEV_KEY;

  const key = Buffer.from(configured, 'hex');
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be 32 bytes as 64 hex characters; got ${configured.length} characters. ` +
        `Generate one: ${GENERATE_KEY_HINT}`,
    );
  }
  return key;
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encrypts one string. Idempotent, so re-saving an unchanged request does not
 * double-encrypt a value that came back from the database already encrypted.
 */
export function encryptField(value) {
  if (typeof value !== 'string' || value === '') return value;
  if (isEncrypted(value)) return value;

  // 12 bytes is the standard GCM nonce length, and it is random per value — reusing a
  // nonce under one key is the way AES-GCM fails catastrophically.
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, resolveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

  // GCM's tag authenticates the ciphertext: tampering is detected on decrypt rather
  // than silently producing different plaintext.
  const tag = cipher.getAuthTag();

  return PREFIX + [iv, tag, ciphertext].map((b) => b.toString('base64')).join(':');
}

/**
 * Decrypts one string.
 *
 * Anything without the marker is returned unchanged — that is the rows written before
 * this existed, and refusing them would break every request saved so far.
 *
 * A value that *is* marked but will not decrypt throws. That means the key is wrong or
 * the data was tampered with, and both deserve a loud failure: returning '' would look
 * like "this request has no token" and send an unauthenticated request instead.
 */
export function decryptField(value) {
  if (!isEncrypted(value)) return value;

  const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Stored credential is malformed and cannot be decrypted.');
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, resolveKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error(
      'A stored credential could not be decrypted. ENCRYPTION_KEY has changed, or the value was altered.',
    );
  }
}

/**
 * The credential fields inside a request's auth block.
 *
 * Listed explicitly rather than encrypting the whole object: `type`, `username` and
 * `addTo` are not secrets, and encrypting them would make the data unreadable for
 * debugging while protecting nothing. A new secret-bearing field must be added here —
 * tests/unit/fieldCrypto.test.js holds this list against the schema and fails if one
 * appears that is not covered.
 */
export const ENCRYPTED_AUTH_PATHS = [
  ['basic', 'password'],
  ['bearer', 'token'],
  ['apiKey', 'value'],
  ['oauth2', 'clientSecret'],
  ['oauth2', 'accessToken'],
  ['oauth2', 'refreshToken'],
];

function mapAuthSecrets(auth, transform) {
  if (!auth || typeof auth !== 'object') return auth;

  // Shallow-cloned per group so the caller's object is never mutated — these are
  // sometimes Mongoose documents being read, and sometimes request bodies.
  const next = { ...auth };
  for (const [group, field] of ENCRYPTED_AUTH_PATHS) {
    const current = auth[group]?.[field];
    if (typeof current !== 'string' || current === '') continue;
    next[group] = { ...next[group], [field]: transform(current) };
  }
  return next;
}

export function encryptAuth(auth) {
  return mapAuthSecrets(auth, encryptField);
}

export function decryptAuth(auth) {
  return mapAuthSecrets(auth, decryptField);
}

/** Encrypts a whole saved-request payload on its way to the database. */
export function encryptRequestSecrets(request) {
  if (!request) return request;
  return { ...request, auth: encryptAuth(request.auth) };
}

/** Decrypts a saved request on its way out, for its owner. */
export function decryptRequestSecrets(request) {
  if (!request) return request;
  return { ...request, auth: decryptAuth(request.auth) };
}
