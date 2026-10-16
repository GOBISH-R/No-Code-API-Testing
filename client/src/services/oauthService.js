import api from './api.js';

export async function getAuthorizationUrl({ authUrl, tokenUrl, clientId, clientSecret, scope }) {
  const { data } = await api.post('/oauth/authcode/authorize-url', {
    authUrl,
    tokenUrl,
    clientId,
    clientSecret,
    scope,
  });
  return data;
}

export async function refreshAccessToken({ tokenUrl, clientId, clientSecret, refreshToken, scope }) {
  const { data } = await api.post('/oauth/authcode/refresh', {
    tokenUrl,
    clientId,
    clientSecret,
    refreshToken,
    scope,
  });
  return data;
}
