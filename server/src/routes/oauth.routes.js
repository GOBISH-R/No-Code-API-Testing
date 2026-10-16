import { Router } from 'express';
import {
  getAuthorizationUrlHandler,
  authCodeCallbackHandler,
  refreshTokenHandler,
} from '../controllers/oauth.controller.js';

const router = Router();

// No requireDb here — the Authorization Code handshake is entirely in-memory
// (oauthStateStore.js) and never touches MongoDB, same as /api/requests/execute
// without an environment selected.
router.post('/authcode/authorize-url', getAuthorizationUrlHandler);
// Hit by a full-page browser redirect from the OAuth provider, not a fetch — no CORS needed.
router.get('/authcode/callback', authCodeCallbackHandler);
router.post('/authcode/refresh', refreshTokenHandler);

export default router;
