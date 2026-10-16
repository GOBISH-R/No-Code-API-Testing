import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { executeHttpRequest, phasesFrom } from '../../src/services/execution/requestExecutor.js';

// The executor directly, against a local server: the SSRF guard lives a layer up, in
// executionEngine, so nothing here bypasses it for real traffic.
let server;
let baseUrl;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    // A short pause before answering, so "waiting" is measurably the largest phase.
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Test': 'yes' });
      res.end('{"ok":true}');
    }, 40);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('response timing phases', () => {
  it('breaks a real request into phases that add up to its total', async () => {
    const result = await executeHttpRequest({ method: 'GET', url: `${baseUrl}/x` });
    const { phases, time } = result.meta;

    expect(phases).not.toBeNull();
    // An IP address needs no DNS lookup; plain HTTP has no TLS handshake.
    expect(phases.dns).toBe(0);
    expect(phases.tls).toBe(0);
    expect(phases.wait).toBeGreaterThanOrEqual(35);
    const sum = phases.dns + phases.tcp + phases.tls + phases.wait + phases.download;
    expect(Math.abs(sum - time)).toBeLessThanOrEqual(3);
  });

  it('reports the size of the response head as well as the body', async () => {
    const { response } = await executeHttpRequest({ method: 'GET', url: `${baseUrl}/x` });
    expect(response.size).toBe(11);
    expect(response.headersSize).toBeGreaterThan('content-type: application/json'.length);
  });

  it('opens a fresh connection each time, so phases are never borrowed from another request', async () => {
    const first = await executeHttpRequest({ method: 'GET', url: `${baseUrl}/x` });
    const second = await executeHttpRequest({ method: 'GET', url: `${baseUrl}/x` });
    expect(first.meta.phases).not.toBeNull();
    expect(second.meta.phases).not.toBeNull();
  });
});

describe('phasesFrom', () => {
  it('derives each phase from when the previous one finished', () => {
    expect(phasesFrom({ lookup: 5, connect: 15, secure: 45, firstByte: 145 }, 160)).toEqual({
      dns: 5,
      tcp: 10,
      tls: 30,
      wait: 100,
      download: 15,
    });
  });

  it('gives up rather than guessing when the socket reported too little', () => {
    expect(phasesFrom({}, 100)).toBeNull();
    expect(phasesFrom({ connect: 10 }, 100)).toBeNull();
  });
});
