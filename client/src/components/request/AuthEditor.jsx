import { useOAuthAuthCode } from '../../hooks/useOAuthAuthCode.js';
import PasswordInput from '../common/PasswordInput.jsx';

const AUTH_TYPES = [
  { value: 'none', label: 'No Auth' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'apiKey', label: 'API Key' },
  { value: 'oauth2', label: 'OAuth 2.0' },
];

function formatExpiry(expiresAt) {
  if (!expiresAt) return 'expiry unknown';
  const diffMs = expiresAt - Date.now();
  if (diffMs <= 0) return 'expired';
  return `expires ${new Date(expiresAt).toLocaleTimeString()}`;
}

export default function AuthEditor({ auth }) {
  const oauthFlow = useOAuthAuthCode(auth.value.oauth2, auth.setOAuth2);
  return (
    <div className="auth-editor">
      <select
        className="auth-editor__type"
        value={auth.value.type}
        onChange={(e) => auth.setType(e.target.value)}
      >
        {AUTH_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      {auth.value.type === 'basic' && (
        <div className="auth-editor__fields">
          <label>
            Username
            <input
              type="text"
              value={auth.value.basic.username}
              onChange={(e) => auth.setBasic({ username: e.target.value })}
            />
          </label>
          <label>
            Password
            <PasswordInput
              value={auth.value.basic.password}
              onChange={(e) => auth.setBasic({ password: e.target.value })}
            />
          </label>
        </div>
      )}

      {auth.value.type === 'bearer' && (
        <div className="auth-editor__fields">
          <label>
            Token
            <input
              type="text"
              placeholder="eyJhbGciOi..."
              value={auth.value.bearer.token}
              onChange={(e) => auth.setBearer({ token: e.target.value })}
            />
          </label>
        </div>
      )}

      {auth.value.type === 'apiKey' && (
        <div className="auth-editor__fields">
          <label>
            Key
            <input
              type="text"
              placeholder="X-API-Key"
              value={auth.value.apiKey.key}
              onChange={(e) => auth.setApiKey({ key: e.target.value })}
            />
          </label>
          <label>
            Value
            <input
              type="text"
              value={auth.value.apiKey.value}
              onChange={(e) => auth.setApiKey({ value: e.target.value })}
            />
          </label>
          <label>
            Add to
            <select
              value={auth.value.apiKey.addTo}
              onChange={(e) => auth.setApiKey({ addTo: e.target.value })}
            >
              <option value="header">Header</option>
              <option value="query">Query Param</option>
            </select>
          </label>
        </div>
      )}

      {auth.value.type === 'oauth2' && (
        <div className="auth-editor__fields">
          <label>
            Grant Type
            <select
              value={auth.value.oauth2.grantType || 'clientCredentials'}
              onChange={(e) => auth.setOAuth2({ grantType: e.target.value })}
            >
              <option value="clientCredentials">Client Credentials</option>
              <option value="authorizationCode">Authorization Code</option>
            </select>
          </label>

          {auth.value.oauth2.grantType === 'authorizationCode' ? (
            <>
              <p className="auth-editor__hint">
                Authorization Code grant — sign in once via a popup; the resulting token is stored
                on this request and sent as a Bearer token until it expires.
              </p>
              <label>
                Auth URL
                <input
                  type="text"
                  placeholder="https://auth.example.com/oauth/authorize"
                  value={auth.value.oauth2.authUrl}
                  onChange={(e) => auth.setOAuth2({ authUrl: e.target.value })}
                />
              </label>
              <label>
                Token URL
                <input
                  type="text"
                  placeholder="https://auth.example.com/oauth/token"
                  value={auth.value.oauth2.tokenUrl}
                  onChange={(e) => auth.setOAuth2({ tokenUrl: e.target.value })}
                />
              </label>
              <label>
                Client ID
                <input
                  type="text"
                  value={auth.value.oauth2.clientId}
                  onChange={(e) => auth.setOAuth2({ clientId: e.target.value })}
                />
              </label>
              <label>
                Client Secret
                <PasswordInput
                  value={auth.value.oauth2.clientSecret}
                  onChange={(e) => auth.setOAuth2({ clientSecret: e.target.value })}
                />
              </label>
              <label>
                Scope <span className="auth-editor__optional">(optional)</span>
                <input
                  type="text"
                  placeholder="read write"
                  value={auth.value.oauth2.scope}
                  onChange={(e) => auth.setOAuth2({ scope: e.target.value })}
                />
              </label>
              {auth.value.oauth2.redirectUri && (
                <label>
                  Redirect URI <span className="auth-editor__optional">(register this with your provider)</span>
                  <input type="text" readOnly value={auth.value.oauth2.redirectUri} />
                </label>
              )}

              <div className="auth-editor__connect-row">
                <button
                  type="button"
                  className="auth-editor__connect-btn"
                  disabled={oauthFlow.status === 'connecting'}
                  onClick={oauthFlow.connect}
                >
                  {oauthFlow.status === 'connecting' ? 'Waiting for sign-in…' : 'Get New Access Token'}
                </button>
                {auth.value.oauth2.refreshToken && (
                  <button
                    type="button"
                    className="auth-editor__connect-btn auth-editor__connect-btn--secondary"
                    disabled={oauthFlow.status === 'connecting'}
                    onClick={oauthFlow.refresh}
                  >
                    Refresh Token
                  </button>
                )}
              </div>

              {auth.value.oauth2.accessToken && (
                <p className="auth-editor__status auth-editor__status--ok">
                  Connected — {formatExpiry(auth.value.oauth2.expiresAt)}.{' '}
                  <button type="button" className="auth-editor__link-btn" onClick={oauthFlow.clear}>
                    Clear
                  </button>
                </p>
              )}
              {oauthFlow.status === 'error' && (
                <p className="auth-editor__status auth-editor__status--error">{oauthFlow.error}</p>
              )}
            </>
          ) : (
            <>
              <p className="auth-editor__hint">
                Client Credentials grant — fetches a token from the token URL and sends it as a
                Bearer token, fresh on every send.
              </p>
              <label>
                Token URL
                <input
                  type="text"
                  placeholder="https://auth.example.com/oauth/token"
                  value={auth.value.oauth2.tokenUrl}
                  onChange={(e) => auth.setOAuth2({ tokenUrl: e.target.value })}
                />
              </label>
              <label>
                Client ID
                <input
                  type="text"
                  value={auth.value.oauth2.clientId}
                  onChange={(e) => auth.setOAuth2({ clientId: e.target.value })}
                />
              </label>
              <label>
                Client Secret
                <PasswordInput
                  value={auth.value.oauth2.clientSecret}
                  onChange={(e) => auth.setOAuth2({ clientSecret: e.target.value })}
                />
              </label>
              <label>
                Scope <span className="auth-editor__optional">(optional)</span>
                <input
                  type="text"
                  placeholder="read write"
                  value={auth.value.oauth2.scope}
                  onChange={(e) => auth.setOAuth2({ scope: e.target.value })}
                />
              </label>
            </>
          )}
        </div>
      )}

      {auth.value.type === 'none' && (
        <p className="auth-editor__empty">This request does not use authorization.</p>
      )}
    </div>
  );
}
