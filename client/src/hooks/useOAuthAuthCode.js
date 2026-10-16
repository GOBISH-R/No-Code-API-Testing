import { useCallback, useState } from 'react';
import { apiOrigin } from '../services/api.js';
import { getAuthorizationUrl, refreshAccessToken } from '../services/oauthService.js';

// Drives the OAuth 2.0 Authorization Code handshake from the Auth tab: open a popup at
// the provider's consent screen, wait for the backend's callback page to post the
// result back, and hand the resulting token to the caller to store on the request.
// Kept separate from AuthEditor.jsx (UI) and oauthService.js (plain HTTP calls) so the
// popup/postMessage orchestration has one clear home.
export function useOAuthAuthCode(oauth2, setOAuth2) {
  const [status, setStatus] = useState('idle'); // idle | connecting | connected | error
  const [error, setError] = useState('');

  const connect = useCallback(async () => {
    setStatus('connecting');
    setError('');

    // Opened synchronously, inside the click handler's own call stack — a popup opened
    // after an `await` (e.g. once the authorize-url fetch resolves) loses the browser's
    // "user gesture" context and gets blocked, even for a real click in a real browser.
    const popup = window.open('about:blank', 'oauth-authcode', 'width=520,height=680');
    if (!popup) {
      setStatus('error');
      setError('Popup blocked — allow popups for this site and try again.');
      return;
    }

    try {
      const { authorizationUrl, redirectUri } = await getAuthorizationUrl({
        authUrl: oauth2.authUrl,
        tokenUrl: oauth2.tokenUrl,
        clientId: oauth2.clientId,
        clientSecret: oauth2.clientSecret,
        scope: oauth2.scope,
      });
      setOAuth2({ redirectUri });
      popup.location.href = authorizationUrl;

      await new Promise((resolve, reject) => {
        let settled = false;

        const finish = (fn) => {
          if (settled) return;
          settled = true;
          window.removeEventListener('message', onMessage);
          clearInterval(watchClosed);
          fn();
        };

        const onMessage = (event) => {
          // The popup is served by our own backend, so only accept messages from it —
          // not from an unrelated window that happens to hold a reference to this one.
          if (event.origin !== apiOrigin || event.data?.type !== 'oauth-authcode-result') return;
          if (event.data.success) {
            setOAuth2({
              accessToken: event.data.accessToken || '',
              refreshToken: event.data.refreshToken || '',
              expiresAt: event.data.expiresIn ? Date.now() + event.data.expiresIn * 1000 : 0,
            });
            finish(resolve);
          } else {
            finish(() => reject(new Error(event.data.error || 'Authorization failed.')));
          }
        };
        window.addEventListener('message', onMessage);

        // The user may close the popup without finishing consent — don't hang forever.
        const watchClosed = setInterval(() => {
          if (popup.closed) {
            finish(() => reject(new Error('The authorization window was closed before completing.')));
          }
        }, 500);
      });

      setStatus('connected');
    } catch (err) {
      if (!popup.closed) popup.close();
      setStatus('error');
      setError(err.response?.data?.message || err.message || 'Authorization failed.');
    }
  }, [oauth2, setOAuth2]);

  const refresh = useCallback(async () => {
    setStatus('connecting');
    setError('');
    try {
      const result = await refreshAccessToken({
        tokenUrl: oauth2.tokenUrl,
        clientId: oauth2.clientId,
        clientSecret: oauth2.clientSecret,
        refreshToken: oauth2.refreshToken,
        scope: oauth2.scope,
      });
      setOAuth2({
        accessToken: result.accessToken || '',
        refreshToken: result.refreshToken || oauth2.refreshToken,
        expiresAt: result.expiresIn ? Date.now() + result.expiresIn * 1000 : 0,
      });
      setStatus('connected');
    } catch (err) {
      setStatus('error');
      setError(err.response?.data?.message || err.message || 'Refresh failed.');
    }
  }, [oauth2, setOAuth2]);

  const clear = useCallback(() => {
    setStatus('idle');
    setError('');
    setOAuth2({ accessToken: '', refreshToken: '', expiresAt: 0 });
  }, [setOAuth2]);

  return { status, error, connect, refresh, clear };
}
