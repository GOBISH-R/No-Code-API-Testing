import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { serveClient } from '../../src/config/serveClient.js';

let dist;

beforeAll(() => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dist, 'favicon.svg'), '<svg/>');
});

afterAll(() => fs.rmSync(dist, { recursive: true, force: true }));

function appWithSite() {
  const app = express();
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  expect(serveClient(app, { distDir: dist })).toBe(true);
  app.use((_req, res) => res.status(404).json({ message: 'Not found' }));
  return app;
}

describe('serving the built website (production)', () => {
  it('serves the site for the home page and for any page address the browser router owns', async () => {
    const app = appWithSite();
    for (const url of ['/', '/app', '/login', '/verify-email?token=abc', '/reset-confirm?token=x&answer=yes']) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(200);
      expect(res.text).toContain('<div id="root">');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('caches hashed build files for a year, other files not at all', async () => {
    const app = appWithSite();
    const asset = await request(app).get('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    const icon = await request(app).get('/favicon.svg');
    expect(icon.headers['cache-control']).toBe('no-cache');
  });

  it('never answers for the server’s own paths', async () => {
    const app = appWithSite();
    expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok' });
    for (const url of ['/api/nope', '/mock/abc/users/1', '/ws-gateway']) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(404);
      expect(res.text).not.toContain('<div id="root">');
    }
  });

  it('does nothing when the site has not been built', () => {
    const app = express();
    expect(serveClient(app, { distDir: path.join(dist, 'missing') })).toBe(false);
  });
});
