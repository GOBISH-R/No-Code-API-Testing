import dns from 'node:dns/promises';
import net from 'node:net';
import { ValidationError } from '../../utils/errors.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain']);

function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIPv6(address) {
  const lower = address.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local (fc00::/7)
  if (lower.startsWith('::ffff:')) {
    const embeddedIpv4 = lower.split(':').pop();
    if (net.isIPv4(embeddedIpv4)) return isPrivateIPv4(embeddedIpv4);
  }
  return false;
}

// Resolves the hostname and rejects targets on private/loopback/link-local networks —
// resolving (rather than trusting the literal hostname) is what stops DNS-rebinding SSRF.
export async function assertPublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ValidationError('Invalid URL. Include the protocol, e.g. https://api.example.com');
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new ValidationError('Only http and https URLs are allowed.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.local')) {
    throw new ValidationError('Requests to local/internal hosts are not allowed.');
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new ValidationError('Could not resolve the target host.');
  }

  if (addresses.length === 0) {
    throw new ValidationError('Could not resolve the target host.');
  }

  for (const { address, family } of addresses) {
    const isPrivate = family === 6 ? isPrivateIPv6(address) : isPrivateIPv4(address);
    if (isPrivate) {
      throw new ValidationError('Requests to private/internal IP addresses are not allowed.');
    }
  }

  return parsed;
}
