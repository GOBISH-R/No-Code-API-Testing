import { exchangeAuthorizationCode, refreshAccessToken } from '../services/execution/oauth2Client.js';
import { createPendingAuthorization, consumePendingAuthorization } from '../services/execution/oauthStateStore.js';
import { ValidationError } from '../utils/errors.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// authUrl is never fetched by this server — it's only returned to the frontend so it
// can open it in a popup, so it just needs to be a well-formed http(s) URL. tokenUrl
// IS fetched server-side later (the exchange/refresh calls), and goes through the
// same SSRF guard (assertPublicUrl) every other user-supplied target does.
function assertWellFormedUrl(raw, label) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError(`${label} must be a valid URL, e.g. https://auth.example.com/authorize`);
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new ValidationError(`${label} must use http or https.`);
  }
  return parsed;
}

// The redirect URI must be registered with the OAuth provider ahead of time, so it has
// to be a stable, predictable value — computed from the incoming request rather than
// trusted from client input (which would let a caller redirect the code anywhere).
function redirectUriFor(req) {
  return `${req.protocol}://${req.get('host')}/api/oauth/authcode/callback`;
}

export async function getAuthorizationUrlHandler(req, res, next) {
  try {
    const { authUrl, tokenUrl, clientId, clientSecret, scope } = req.body || {};

    if (!clientId?.trim()) throw new ValidationError('Client ID is required.');
    if (!tokenUrl?.trim()) throw new ValidationError('Token URL is required.');
    const parsedAuthUrl = assertWellFormedUrl(authUrl, 'Auth URL');

    const redirectUri = redirectUriFor(req);
    const state = createPendingAuthorization({
      tokenUrl: tokenUrl.trim(),
      clientId: clientId.trim(),
      clientSecret: clientSecret ?? '',
      redirectUri,
    });

    parsedAuthUrl.searchParams.set('response_type', 'code');
    parsedAuthUrl.searchParams.set('client_id', clientId.trim());
    parsedAuthUrl.searchParams.set('redirect_uri', redirectUri);
    parsedAuthUrl.searchParams.set('state', state);
    if (scope?.trim()) parsedAuthUrl.searchParams.set('scope', scope.trim());

    res.status(200).json({ authorizationUrl: parsedAuthUrl.toString(), redirectUri });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400);
      return next(err);
    }
    next(err);
  }
}

// Escapes for safe embedding inside a JSON literal in an inline <script> — beyond
// JSON.stringify's own quoting, `<` is neutralized so a value like an error message
// can never break out of the script tag (e.g. via "</script>").
function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// This page is loaded by a full top-level navigation (the OAuth provider redirects
// the popup here) — never fetched cross-origin — so it needs no CORS. It exists only
// to hand the result back to the window that opened the popup and then close itself.
function renderCallbackPage(res, clientOrigin, payload) {
  // Helmet's default CSP blocks inline scripts; this response is 100% our own static
  // markup (nothing user-controlled is ever interpolated as script text, only as a
  // JSON value), so a scoped, inline-script-only CSP is safe for this one response.
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'");
  res.status(200).type('html').send(`<!DOCTYPE html>
<html><head><title>Authorizing…</title></head>
<body>
<p>Completing sign-in — this window will close automatically.</p>
<script>
  (function () {
    var target = ${jsonForScript(clientOrigin)};
    var message = Object.assign({ type: 'oauth-authcode-result' }, ${jsonForScript(payload)});
    if (window.opener) {
      window.opener.postMessage(message, target);
    }
    window.close();
  })();
</script>
</body></html>`);
}

export async function authCodeCallbackHandler(req, res) {
  const clientOrigin = process.env.CLIENT_URL || 'http://localhost:5173';
  const { code, state, error, error_description: errorDescription } = req.query;

  const pending = consumePendingAuthorization(state);

  if (error) {
    return renderCallbackPage(res, clientOrigin, {
      success: false,
      error: errorDescription || error,
    });
  }

  if (!pending) {
    return renderCallbackPage(res, clientOrigin, {
      success: false,
      error: 'This authorization session expired or was already used. Click "Get New Access Token" and try again.',
    });
  }

  try {
    const token = await exchangeAuthorizationCode({
      tokenUrl: pending.tokenUrl,
      clientId: pending.clientId,
      clientSecret: pending.clientSecret,
      code,
      redirectUri: pending.redirectUri,
    });
    renderCallbackPage(res, clientOrigin, {
      success: true,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken || '',
      expiresIn: token.expiresIn ?? null,
    });
  } catch (err) {
    renderCallbackPage(res, clientOrigin, {
      success: false,
      error: err.message || 'Token exchange failed.',
    });
  }
}

export async function refreshTokenHandler(req, res, next) {
  try {
    const { tokenUrl, clientId, clientSecret, refreshToken: token, scope } = req.body || {};
    const result = await refreshAccessToken({ tokenUrl, clientId, clientSecret, refreshToken: token, scope });
    res.status(200).json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken || token,
      expiresIn: result.expiresIn ?? null,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400);
      return next(err);
    }
    next(err);
  }
}
