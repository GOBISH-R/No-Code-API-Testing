import { describe, it, expect } from 'vitest';
import { assertPublicWebSocketUrl } from '../../src/services/websocket/wsUrlValidator.js';
import { ValidationError } from '../../src/utils/errors.js';

// The point of these: WebSocket must inherit the *existing* SSRF rules, not a second
// copy of them. Every case here mirrors one the HTTP guard already enforces.

describe('assertPublicWebSocketUrl — scheme handling', () => {
  it('accepts ws:// against a public host', async () => {
    const url = await assertPublicWebSocketUrl('ws://example.com/socket');
    expect(url.protocol).toBe('ws:');
  });

  it('accepts wss:// against a public host', async () => {
    const url = await assertPublicWebSocketUrl('wss://example.com/socket');
    expect(url.protocol).toBe('wss:');
  });

  it('returns the original ws URL, not the http form used for validation', async () => {
    // The connection must be made over ws://, so translation is internal only.
    const url = await assertPublicWebSocketUrl('wss://example.com/socket?a=1');
    expect(url.toString()).toBe('wss://example.com/socket?a=1');
  });

  it('preserves path, query and port', async () => {
    const url = await assertPublicWebSocketUrl('wss://example.com:8443/a/b?x=1');
    expect(url.pathname).toBe('/a/b');
    expect(url.search).toBe('?x=1');
    expect(url.port).toBe('8443');
  });

  it('rejects http/https — those belong to the HTTP executor', async () => {
    await expect(assertPublicWebSocketUrl('https://example.com')).rejects.toThrow(/only ws and wss/i);
  });

  it('rejects other schemes', async () => {
    await expect(assertPublicWebSocketUrl('file:///etc/passwd')).rejects.toThrow(/only ws and wss/i);
  });

  it('rejects a malformed URL', async () => {
    await expect(assertPublicWebSocketUrl('not-a-url')).rejects.toThrow(/valid WebSocket URL/i);
    await expect(assertPublicWebSocketUrl('')).rejects.toThrow();
  });
});

describe('assertPublicWebSocketUrl — SSRF rules are inherited', () => {
  it('blocks localhost', async () => {
    await expect(assertPublicWebSocketUrl('ws://localhost:8080/socket')).rejects.toThrow(/local|internal/i);
  });

  it('blocks loopback IPs', async () => {
    await expect(assertPublicWebSocketUrl('ws://127.0.0.1/socket')).rejects.toThrow(/private|internal/i);
  });

  it('blocks IPv6 loopback', async () => {
    await expect(assertPublicWebSocketUrl('ws://[::1]/socket')).rejects.toThrow(/private|internal/i);
  });

  it('blocks cloud metadata', async () => {
    await expect(assertPublicWebSocketUrl('ws://169.254.169.254/socket')).rejects.toThrow(/private|internal/i);
  });

  it('blocks RFC1918 ranges', async () => {
    await expect(assertPublicWebSocketUrl('ws://10.0.0.5/s')).rejects.toThrow(/private|internal/i);
    await expect(assertPublicWebSocketUrl('ws://192.168.1.5/s')).rejects.toThrow(/private|internal/i);
    await expect(assertPublicWebSocketUrl('ws://172.16.0.5/s')).rejects.toThrow(/private|internal/i);
  });

  it('blocks .local hostnames', async () => {
    await expect(assertPublicWebSocketUrl('ws://printer.local/s')).rejects.toThrow(/local|internal/i);
  });

  it('always throws ValidationError, so controllers map it to 400', async () => {
    await expect(assertPublicWebSocketUrl('ws://127.0.0.1/s')).rejects.toThrow(ValidationError);
  });
});
