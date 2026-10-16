import dotenv from 'dotenv';
dotenv.config();

import http from 'node:http';

import app from './app.js';
import { connectDB } from './config/db.js';
import { checkConfig } from './config/validateConfig.js';
import { attachWebSocketGateway, GATEWAY_PATH } from './services/websocket/gateway.js';
import { buildSessionMiddleware } from './config/session.js';
import { installMailTransport } from './services/accounts/smtpTransport.js';
import { startMonitorScheduler } from './services/monitors/monitorScheduler.js';

const PORT = process.env.PORT || 5000;

// Node terminates the process by default on both of these. For an interactive testing
// tool that is the worst possible outcome: one stray rejection anywhere would kill the
// backend mid-session and lose the in-memory dev database with it. Express already
// funnels errors thrown inside request handlers to errorHandler.js, so anything
// reaching here came from outside the request lifecycle (a stray timer or socket
// event) and is far more likely to be an isolated bug than genuine state corruption.
// Deliberate tradeoff: log loudly, stay up.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] The server is still running.', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] The server is still running.', err);
});

async function start() {
  // Before anything else: a production deployment missing its configuration should
  // never reach the point of listening and looking healthy.
  for (const warning of checkConfig()) console.warn(`[config] ${warning}`);

  await connectDB();

  // Before listening, so a bad SMTP password is in the startup log rather than in a
  // support message from the first person who could not sign up.
  await installMailTransport();

  // Runs collections on their monitors' schedules.
  startMonitorScheduler();

  // An explicit http.Server (rather than app.listen) is what lets the WebSocket
  // gateway share this port: `ws` needs the server's 'upgrade' event, which
  // app.listen does not expose. Express routing is unchanged.
  const server = http.createServer(app);
  // The gateway authenticates its own upgrades, so it needs the same session
  // middleware the HTTP side uses — a WebSocket has no route to hang middleware off.
  attachWebSocketGateway(server, {
    clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
    sessionMiddleware: buildSessionMiddleware(),
  });

  // Failing to bind is not the "isolated bug" the handlers above are there to survive:
  // the process cannot serve anything, so staying alive only produces a zombie that
  // looks healthy to a supervisor and never answers. It must die so it can be restarted.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[server] Port ${PORT} is already in use. Stop the other process or set PORT.`);
    } else {
      console.error('[server] Could not start:', err);
    }
    process.exit(1);
  });

  server.listen(PORT, () => {
    console.log(`[server] Listening on http://localhost:${PORT}`);
    console.log(`[server] WebSocket gateway at ws://localhost:${PORT}${GATEWAY_PATH}`);
  });
}

start().catch((err) => {
  // Anything thrown before the server is listening — a failed database connection,
  // a bad config — is equally fatal for the same reason.
  console.error('[server] Startup failed:', err);
  process.exit(1);
});
