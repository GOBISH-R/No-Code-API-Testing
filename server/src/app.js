import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { redactUrl } from './utils/redactUrl.js';

import healthRoutes from './routes/health.routes.js';
import requestsRoutes from './routes/requests.routes.js';
import collectionsRoutes from './routes/collections.routes.js';
import environmentsRoutes from './routes/environments.routes.js';
import globalsRoutes from './routes/globals.routes.js';
import mocksRoutes from './routes/mocks.routes.js';
import oauthRoutes from './routes/oauth.routes.js';
import foldersRoutes from './routes/folders.routes.js';
import graphqlRoutes from './routes/graphql.routes.js';
import mockServerRoutes from './routes/mockServer.routes.js';
import testRunsRoutes from './routes/testRuns.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import accountsRoutes from './routes/accounts.routes.js';
import historyRoutes from './routes/history.routes.js';
import monitorsRoutes from './routes/monitors.routes.js';
import workspacesRoutes from './routes/workspaces.routes.js';
import { buildSessionMiddleware } from './config/session.js';
import { attachUser, requireAuth } from './middleware/authenticate.js';
import { workspaceScope } from './middleware/workspaceScope.js';
import { apiLimiter, parseTrustProxy } from './middleware/rateLimits.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { serveClient } from './config/serveClient.js';

const app = express();
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

// Helmet's defaults, plus Google's image servers: an account that signs in with Google
// shows its Google profile picture, which the default `img-src 'self'` would block.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: { 'img-src': ["'self'", 'data:', 'https://*.googleusercontent.com'] },
    },
  }),
);
// Sending a request may carry up to 5 MB of files for a multipart body, base64-encoded;
// everything else stays at 1 MB. Saved requests never hold file contents.
const sendBodyParser = express.json({ limit: '8mb' });
const bodyParser = express.json({ limit: '1mb' });
app.use((req, res, next) =>
  (req.path === '/api/requests/execute' ? sendBodyParser : bodyParser)(req, res, next),
);

if (process.env.NODE_ENV !== 'production') {
  // Same shape as morgan's 'dev' format, but with secrets in the query string replaced —
  // the Google callback carries a one-time code and state that do not belong in a log.
  morgan.token('safe-url', (req) => redactUrl(req.originalUrl || req.url));
  app.use(morgan(':method :safe-url :status :response-time ms - :res[content-length]'));
}

// Management API: only our own frontend manages requests/collections/mocks/etc.
// `credentials` is required for the session cookie to travel cross-origin — the client
// runs on a different port in development and may on a different subdomain in
// production, and without it the browser sends the request without the cookie.
app.use('/api', cors({ origin: clientUrl, credentials: true }));

// Sessions, then the account they identify. Both run before any route so that
// `req.user` is populated everywhere, including on the public ones.
app.use('/api', buildSessionMiddleware());
app.use('/api', attachUser);
// After attachUser so a signed-in request is counted against its account, not its IP.
app.use('/api', apiLimiter);

// Public: health is for monitoring, and the account routes are how you sign in — a
// login endpoint behind requireAuth would be a locked door with the key inside.
app.use('/api/health', healthRoutes);
app.use('/api/accounts', accountsRoutes);

/**
 * Everything past this line requires an account.
 *
 * Mounted as a gate rather than repeated per router, so a new route file is protected
 * by default. Forgetting to add auth is the common mistake; this makes forgetting the
 * safe direction.
 *
 * Note that this only proves *somebody* is signed in. It does not prove the document
 * they asked for is theirs — that is ownership scoping, enforced at each query.
 */
app.use('/api', requireAuth);

/**
 * Shareable data: these act in the workspace named by the X-Workspace-Id header, or the
 * person's own data without one. workspaceScope checks membership and role first.
 */
app.use('/api/requests', workspaceScope, requestsRoutes);
app.use('/api/collections', workspaceScope, collectionsRoutes);
app.use('/api/environments', workspaceScope, environmentsRoutes);
app.use('/api/globals', workspaceScope, globalsRoutes);
app.use('/api/folders', workspaceScope, foldersRoutes);
app.use('/api/graphql', workspaceScope, graphqlRoutes);
app.use('/api/test-runs', workspaceScope, testRunsRoutes);
app.use('/api/dashboard', workspaceScope, dashboardRoutes);
app.use('/api/monitors', workspaceScope, monitorsRoutes);

// Personal, whichever workspace is open: never scoped.
app.use('/api/mocks', mocksRoutes);
app.use('/api/oauth', oauthRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/workspaces', workspacesRoutes);

// Mock server: the whole point is to be hit by whatever client is under test, not
// just our own frontend, so it gets a permissive CORS policy instead of the
// management API's locked-down one.
app.use('/mock', cors());
app.use('/mock', mockServerRoutes);

// Production: the same server hands out the built website, at the same address as the
// API — see config/serveClient.js for why that matters.
if (process.env.NODE_ENV === 'production' && !serveClient(app)) {
  console.warn('[server] client/dist was not found, so the website is not being served. Run the client build.');
}

app.use(notFound);
app.use(errorHandler);

export default app;
