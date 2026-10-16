import { useEffect, useRef, useState } from 'react';
import * as accountService from '../services/accountService.js';

const POLL_MS = 4000;
const RESEND_COOLDOWN_S = 60;

const SIGNUP_LABELS = {
  waiting: 'Verifying…',
  success: 'Success!',
  failed: 'Failed!',
  resend: 'Resend link',
  resendTitle: 'Send a new link — the old one stops working',
};

// Answers that mean the email was acted on: a confirmed sign-up, or "Yes, it's me".
const SUCCESS = new Set(['verified', 'confirmed']);
// Answers that end the wait without success: nothing pending, replaced, or "No".
const ENDED = new Set(['signin', 'none', 'gone', 'denied']);

/**
 * The box under "Stay signed in" while the emailed link is waiting to be clicked.
 *
 * One line, three looks:
 *   waiting — dotted spinner, "Verifying…"
 *   success — green tick, "Success!" (then the page lets the person in)
 *   failed  — red cross, "Failed!" (the ten-minute link ran out)
 * with "Resend link" on the right of the box, usable once a minute — the server sends one email a minute.
 *
 * It asks the server every few seconds — and straight away when the tab comes back
 * into view, usually the moment someone returns from their inbox — whether the link
 * has been clicked. The server lets this browser in only for the link *it* asked for.
 *
 * The sign-in page reuses it while a password reset waits on "Is this you?", passing
 * its own `getStatus`, `resend` and `labels`.
 */
export default function VerificationBox({
  onVerified,
  onNeedsSignIn,
  getStatus = accountService.getVerificationStatus,
  resend: resendRequest = accountService.resendVerificationLink,
  labels = SIGNUP_LABELS,
}) {
  const [phase, setPhase] = useState('waiting'); // waiting | success | failed
  // An email went out just before this box appeared, so Resend starts on its countdown.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const [error, setError] = useState('');
  const done = useRef(false);
  const handlers = useRef({ onVerified, onNeedsSignIn, getStatus });

  useEffect(() => {
    handlers.current = { onVerified, onNeedsSignIn, getStatus };
  });

  useEffect(() => {
    if (phase !== 'waiting') return undefined;
    let timer = null;
    let inFlight = false;

    const check = async () => {
      if (done.current || inFlight) return;
      inFlight = true;
      try {
        const result = await handlers.current.getStatus();
        if (done.current) return;
        if (SUCCESS.has(result.status)) {
          done.current = true;
          setPhase('success');
          // Long enough to see the tick, short enough not to feel like a wait.
          setTimeout(() => handlers.current.onVerified(result.user ?? result), 1200);
        } else if (result.status === 'expired') {
          setPhase('failed');
        } else if (ENDED.has(result.status)) {
          done.current = true;
          handlers.current.onNeedsSignIn?.(result.status);
        }
      } catch {
        // A dropped request is not an answer; the next tick asks again.
      } finally {
        inFlight = false;
      }
    };

    const schedule = () => {
      timer = setTimeout(async () => {
        // A hidden tab waits: no point asking while nobody is looking.
        if (document.visibilityState === 'visible') await check();
        if (!done.current) schedule();
      }, POLL_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };

    // Asked once straight away too, so a link that already ran out shows as Failed
    // the moment the box appears rather than after a spin.
    check();
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [phase]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const resend = async () => {
    setError('');
    // The wait starts over the moment it is pressed: once, then not again for a minute.
    setCooldown(RESEND_COOLDOWN_S);
    try {
      const result = await resendRequest();
      if (ENDED.has(result?.status)) {
        done.current = true;
        handlers.current.onNeedsSignIn?.(result.status);
        return;
      }
      setPhase('waiting');
    } catch (err) {
      setError(err.message);
    }
  };

  const label = labels[phase];

  return (
    <>
      <div className={`verify-box verify-box--${phase}`} role="status" aria-live="polite">
        <span className="verify-box__icon" aria-hidden="true">
          {phase === 'waiting' && (
            <span className="verify-box__spinner">
              {Array.from({ length: 8 }, (_, i) => (
                <i key={i} style={{ '--i': i }} />
              ))}
            </span>
          )}
          {phase === 'success' && (
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {phase === 'failed' && (
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
        </span>
        <span className="verify-box__title">{label}</span>

        {phase !== 'success' && (
          <button
            type="button"
            className="verify-box__resend"
            onClick={resend}
            disabled={cooldown > 0}
            title={cooldown > 0 ? `You can resend in ${cooldown}s` : labels.resendTitle}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : labels.resend}
          </button>
        )}
      </div>
      {error && <p className="verify-box__error" role="alert">{error}</p>}
    </>
  );
}
