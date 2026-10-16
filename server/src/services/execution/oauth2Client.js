import axios from 'axios';
import { assertPublicUrl } from './urlValidator.js';
import { ValidationError } from '../../utils/errors.js';

const TOKEN_TIMEOUT_MS = 15000;

function describeFailure(response) {
  const body = response.data;
  if (body && typeof body === 'object') {
    // Most OAuth2 servers return { error, error_description } on failure (RFC 6749 §5.2).
    const detail = body.error_description || body.error;
    if (detail) return detail;
  }
  return typeof body === 'string' && body ? body.slice(0, 200) : `HTTP ${response.status}`;
}

// Client Credentials grant only (RFC 6749 §4.4) — the non-interactive flow: no user,
// no browser redirect. The token URL is user-supplied like any other target, so it
// goes through the same SSRF guard as the real request.
export async function fetchClientCredentialsToken({ tokenUrl, clientId, clientSecret, scope } = {}) {
  if (!tokenUrl?.trim()) {
    throw new ValidationError('OAuth 2.0 token URL is required.');
  }

  const targetUrl = await assertPublicUrl(tokenUrl);

  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  if (scope?.trim()) body.set('scope', scope.trim());

  let response;
  try {
    response = await axios.post(targetUrl.toString(), body.toString(), {
      timeout: TOKEN_TIMEOUT_MS,
      auth: { username: clientId ?? '', password: clientSecret ?? '' },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
    });
  } catch (err) {
    throw new ValidationError(`OAuth 2.0 token request failed: ${err.message}`);
  }

  if (response.status < 200 || response.status >= 300) {
    throw new ValidationError(
      `OAuth 2.0 token request failed with ${response.status}: ${describeFailure(response)}`,
    );
  }

  const accessToken = response.data?.access_token;
  if (!accessToken) {
    throw new ValidationError('OAuth 2.0 token response did not include an access_token.');
  }

  return accessToken;
}

// Shared by the authorization_code exchange and the refresh_token grant below — both
// POST to the same token URL with the same client auth, differing only in which grant
// params they send.
async function requestToken(tokenUrl, clientId, clientSecret, params) {
  const targetUrl = await assertPublicUrl(tokenUrl);

  let response;
  try {
    response = await axios.post(targetUrl.toString(), params.toString(), {
      timeout: TOKEN_TIMEOUT_MS,
      auth: { username: clientId ?? '', password: clientSecret ?? '' },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
    });
  } catch (err) {
    throw new ValidationError(`OAuth 2.0 token request failed: ${err.message}`);
  }

  if (response.status < 200 || response.status >= 300) {
    throw new ValidationError(
      `OAuth 2.0 token request failed with ${response.status}: ${describeFailure(response)}`,
    );
  }

  const accessToken = response.data?.access_token;
  if (!accessToken) {
    throw new ValidationError('OAuth 2.0 token response did not include an access_token.');
  }

  return {
    accessToken,
    refreshToken: response.data?.refresh_token,
    expiresIn: Number.isFinite(response.data?.expires_in) ? response.data.expires_in : undefined,
  };
}

// Authorization Code grant (RFC 6749 §4.1) — the interactive flow: the user consents
// in a browser popup (see oauth.controller.js), the provider redirects back with a
// one-time `code`, and this exchanges it for tokens. `redirectUri` must exactly match
// the one sent in the original authorization request.
export async function exchangeAuthorizationCode({ tokenUrl, clientId, clientSecret, code, redirectUri } = {}) {
  if (!tokenUrl?.trim()) throw new ValidationError('OAuth 2.0 token URL is required.');
  if (!code) throw new ValidationError('OAuth 2.0 authorization code is missing.');

  const params = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri ?? '' });
  return requestToken(tokenUrl, clientId, clientSecret, params);
}

// Refresh Token grant (RFC 6749 §6) — lets the UI obtain a new access token without
// repeating the browser consent step, as long as the provider issued a refresh_token.
export async function refreshAccessToken({ tokenUrl, clientId, clientSecret, refreshToken, scope } = {}) {
  if (!tokenUrl?.trim()) throw new ValidationError('OAuth 2.0 token URL is required.');
  if (!refreshToken?.trim()) throw new ValidationError('No refresh token available.');

  const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  if (scope?.trim()) params.set('scope', scope.trim());
  return requestToken(tokenUrl, clientId, clientSecret, params);
}
