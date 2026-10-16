/**
 * One-time setup for sending mail through the Gmail API (see
 * src/services/accounts/gmailTransport.js).
 *
 *   node scripts/gmail-authorize.js
 *
 * Opens Google's consent page for the sending account (MAIL_FROM), asks only for
 * permission to *send* mail as it (scope gmail.send — it cannot read your inbox), and
 * prints a refresh token. Put that in server/.env and in the host's environment as
 * GMAIL_REFRESH_TOKEN.
 *
 * Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in server/.env, the Gmail API enabled
 * in that Google Cloud project, and this redirect URI on the OAuth client:
 *   http://localhost:5005/oauth2callback
 *
 * The token is printed in YOUR terminal only and is never written to a file.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '..', '.env'), quiet: true });

const PORT = 5005;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const sender = (process.env.MAIL_FROM || '').match(/<([^>]+)>/)?.[1] || process.env.MAIL_FROM?.trim() || '';

if (!clientId || !clientSecret) {
  console.error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in server/.env first.');
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');
const consentUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
consentUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline', // a refresh token, not just a one-hour access token
  prompt: 'consent', // always issue a refresh token, even if approved before
  state,
  ...(sender ? { login_hint: sender } : {}),
}).toString();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404).end();
    return;
  }
  const finish = (status, message) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message);
    server.close();
  };

  if (url.searchParams.get('state') !== state) return finish(400, 'This sign-in did not start here. Run the script again.');
  const error = url.searchParams.get('error');
  if (error) {
    console.error(`\nGoogle returned: ${error}. Nothing was changed.`);
    return finish(400, `Google returned: ${error}. You can close this tab.`);
  }

  const res2 = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code'),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const body = await res2.json();
  if (!res2.ok || !body.refresh_token) {
    console.error(`\nCould not get a refresh token: ${body.error_description || body.error || res2.status}`);
    return finish(500, 'Could not get a refresh token — see the terminal. You can close this tab.');
  }

  console.log('\nDone. Add this line to server/.env AND to Render → Environment:\n');
  console.log(`GMAIL_REFRESH_TOKEN=${body.refresh_token}`);
  console.log('\nKeep it private — it lets ApIForge send mail as this Gmail account.');
  return finish(200, 'ApIForge can now send email through Gmail. You can close this tab and go back to the terminal.');
});

server.listen(PORT, () => {
  console.log(`Sign in as ${sender || 'the Gmail account that sends ApIForge emails'} and allow "Send email on your behalf".`);
  console.log('If Google says the app is unverified, choose Advanced → Go to ApIForge (it is your own app).\n');
  console.log('Open this address in your browser:\n');
  console.log(consentUrl.toString());
  console.log('\nWaiting for Google…');
});
