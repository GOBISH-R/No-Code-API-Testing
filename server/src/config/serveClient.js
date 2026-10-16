import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

/**
 * In production the server also hands out the built website (client/dist), so the site,
 * its API, the WebSocket gateway and the mock server all share one address.
 *
 * One address matters: the sign-in cookie is SameSite=Lax, and free hosting names
 * (*.onrender.com, *.vercel.app) are separate "sites" to a browser — a website on one
 * and an API on another would never see each other's cookie.
 *
 * In development nothing changes: Vite serves the site on its own port.
 */
export const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../client/dist');

// Paths that belong to the server itself and must never fall through to the website.
const SERVER_PATHS = /^\/(api|mock|ws-gateway)(\/|$)/;

/**
 * Mounts the website if it has been built. Returns whether it did, so start-up can say
 * so (a missing build in production is a deployment mistake worth a loud line).
 */
export function serveClient(app, { distDir = CLIENT_DIST } = {}) {
  const indexFile = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexFile)) return false;

  // Hashed files (assets/*-abc123.js) never change: cache them for a year. Everything
  // else is revalidated, so a new deployment is picked up on the next visit.
  app.use(
    express.static(distDir, {
      index: false,
      setHeaders(res, filePath) {
        const hashed = filePath.includes(`${path.sep}assets${path.sep}`);
        res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );

  // Any other page address (/app, /login, /verify-email?token=…) is the single-page app:
  // the browser's router decides what to show.
  app.get(/.*/, (req, res, next) => {
    if (SERVER_PATHS.test(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(indexFile);
  });

  return true;
}
