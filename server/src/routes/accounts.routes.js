import express from 'express';
import rateLimit from 'express-rate-limit';
import * as controller from '../controllers/accounts.controller.js';
import { emailLimits, byEmailAddress, byBrowser } from '../middleware/rateLimits.js';
import { requireAuth } from '../middleware/authenticate.js';

const router = express.Router();

/**
 * Account endpoints carry their own, much tighter limits than the rest of the API.
 *
 * The global /api limiter allows hundreds of requests per window, which is right for someone
 * working and useless against a password guesser. These are the endpoints where an
 * attacker gets unlimited free attempts, so they are counted per IP and kept low.
 */
const signInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  // Only failures count: someone legitimately using the app should never meet this.
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many attempts. Wait a few minutes and try again.' },
});

// Sending email costs money and annoys the recipient: one a minute for the same address
// (or, for Resend, the same browser), within an hourly ceiling per network. See
// emailLimits in middleware/rateLimits.js.

router.get('/methods', controller.methods);
router.get('/me', controller.me);

// Account settings, for the signed-in account only. The two that check a password are
// rate-limited like sign-in: they are as good a way to guess one.
router.patch('/me', requireAuth, controller.updateProfile);
router.post('/password', requireAuth, signInLimiter, controller.changePassword);
router.get('/me/deletion', requireAuth, controller.deletionSummary);
router.delete('/me', requireAuth, signInLimiter, controller.deleteAccount);

router.post('/register', emailLimits(byEmailAddress), controller.register);
router.post('/login', signInLimiter, controller.login);
router.post('/logout', controller.logout);

// The sign-up page waits on these until the emailed link is clicked.
router.get('/pending', controller.pendingStatus);
router.delete('/pending', controller.cancelPending);
router.post('/pending/resend', emailLimits(byBrowser), controller.resendPending);
// Signed-in only; the controller refuses anyone else.
router.post('/welcome', controller.completeWelcome);

router.post('/verify-email', signInLimiter, controller.verifyEmail);

// Browser redirects, not fetches — they carry no body and are rate-limited as
// sign-in attempts.
router.get('/google', signInLimiter, controller.googleStart);
router.get('/google/callback', controller.googleCallback);

// Password reset: "Forgot password?" emails "Is this you?"; the sign-in page waits on
// /reset/pending, the email's buttons answer through /reset/answer, and the new password
// is set from the waiting page with /reset/complete.
router.post('/forgot-password', emailLimits(byEmailAddress), controller.requestPasswordReset);
router.get('/reset/pending', controller.passwordResetStatus);
router.delete('/reset/pending', controller.cancelPasswordReset);
router.post('/reset/pending/resend', emailLimits(byBrowser), controller.resendPasswordReset);
router.post('/reset/answer', signInLimiter, controller.answerPasswordReset);
router.post('/reset/complete', signInLimiter, controller.completePasswordReset);

export default router;
