import { assertPublicUrl } from '../execution/urlValidator.js';
import { ValidationError } from '../../utils/errors.js';

// ws:// and wss:// are HTTP and HTTPS at the transport level — the handshake is an
// ordinary HTTP upgrade request — so the same SSRF rules apply and the same guard
// should enforce them.
const SCHEME_EQUIVALENT = { 'ws:': 'http:', 'wss:': 'https:' };

/**
 * Validates a WebSocket target with the *existing* SSRF guard.
 *
 * Deliberately an adapter rather than a copy: the private-range, loopback,
 * link-local and DNS-resolution rules live in one place (urlValidator.js), so a
 * future hardening fix there protects WebSocket automatically. This only translates
 * the scheme so that guard can read the URL, then hands back the original ws:// URL
 * for the connection itself.
 */
export async function assertPublicWebSocketUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ValidationError('Invalid WebSocket URL. Include the protocol, e.g. wss://example.com/socket');
  }

  const equivalent = SCHEME_EQUIVALENT[parsed.protocol];
  if (!equivalent) {
    throw new ValidationError('Only ws and wss URLs are allowed.');
  }

  // Validate the HTTP-equivalent form; every hostname/IP rule is inherited from there.
  const httpForm = new URL(parsed.toString());
  httpForm.protocol = equivalent;
  await assertPublicUrl(httpForm.toString());

  return parsed;
}
