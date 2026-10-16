import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/authContext.js';
import * as accountService from '../services/accountService.js';
import { AuthShell } from './AuthShell.jsx';
import StatusIcon from './StatusIcon.jsx';
import { finishEmailTab, VERIFY_CHANNEL } from './emailTabs.js';

/**
 * Where the "Verify my email" link lands — only for a moment.
 *
 * The address is verified straight away and the tab closes itself: the sign-up page
 * waiting in this browser moves on into the app by itself, so the click in the email is
 * all the person sees. Opened on another device (the phone the email was read on), the
 * address is verified and that device is not signed in — the tab just closes.
 *
 * If the browser will not let the tab close: in the browser that signed up, it goes on
 * into the app; anywhere else it shows one line, "Verified. You can close this tab."
 *
 * The link works once. Opened again it is "no longer valid", shown on the sign-in page;
 * one that ran out is shown on the sign-up page, where a new one is a click away.
 */
export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { signedIn } = useAuth();
  const token = params.get('token');

  // working | offline | elsewhere (verified from another device, tab still open)
  const [state, setState] = useState('working');
  const [error, setError] = useState('');

  /**
   * The link is single-use, so each attempt must fire exactly once.
   *
   * React runs effects twice in development StrictMode; without this guard the second
   * run spends a link the first already used. It holds the attempt already sent.
   */
  const attempted = useRef(null);
  // Bumped by "Try again" after a dropped connection, to run the check once more.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    document.title = 'Verify email — ApIForge';
  }, []);

  useEffect(() => {
    if (attempted.current === attempt) return;
    attempted.current = attempt;

    if (!token) {
      navigate('/login', { replace: true, state: { error: 'This link is no longer valid.' } });
      return;
    }
    accountService
      .verifyEmail(token)
      .then(async (result) => {
        // Signed in here only when this is the browser that signed up; telling the other
        // tabs lets the waiting sign-up page move on.
        if (result.sameBrowser) signedIn(result.user);
        await finishEmailTab({ channel: VERIFY_CHANNEL, sameBrowser: result.sameBrowser });
        // Still open.
        if (result.sameBrowser) navigate('/app', { replace: true });
        else setState('elsewhere');
      })
      .catch((err) => {
        if (err.offline) {
          setError(err.message);
          setState('offline');
          return;
        }
        const where = err.code === 'VERIFY_EXPIRED' ? '/signup' : '/login';
        navigate(where, { replace: true, state: { error: err.message } });
      });
  }, [token, attempt, signedIn, navigate]);

  const retry = () => {
    setState('working');
    setAttempt((n) => n + 1);
  };

  if (state === 'working') return <div className="auth-loading">Loading…</div>;

  return (
    <AuthShell>
      {state === 'elsewhere' && (
        <p className="auth-status__text" role="status">
          Verified. You can close this tab.
        </p>
      )}

      {state === 'offline' && (
        <div className="auth-status" role="status" aria-live="polite">
          <StatusIcon />
          <h1 className="auth-status__title">Couldn't verify just now</h1>
          <p className="auth-status__text">
            {error} Your link hasn't been used, so it will still work.
          </p>
          <div className="auth-status__actions">
            <button type="button" className="auth__submit" onClick={retry}>
              Try again
            </button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}
