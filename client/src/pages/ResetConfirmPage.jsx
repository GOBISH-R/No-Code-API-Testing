import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as accountService from '../services/accountService.js';
import { AuthShell } from './AuthShell.jsx';
import { finishEmailTab, RESET_CHANNEL } from './emailTabs.js';

/**
 * Where the "Is this you?" email's buttons land — only for a moment.
 *
 * An email link always opens a tab; this one records the answer and closes itself, so
 * the click is all the person sees. The sign-in tab that asked updates on its own: after
 * Yes it shows the new-password fields, after No it is back to signing in.
 *
 * When the tab cannot close (a browser may refuse), it falls back: in the browser that
 * asked, to the sign-in page carrying on with the reset; anywhere else — the phone the
 * email was read on — to one line, "Verified." or "Cancelled.", and nothing else to do
 * there: the new password is set on the computer that asked. A failure (an email that
 * has expired, or was replaced by a newer one) is shown on the sign-in page.
 *
 * Answered from script rather than on the link itself, so a mail scanner that only
 * fetches links answers nothing. One that follows both links spends the email on its
 * first, and No only ever cancels — it can never set a password.
 */
export default function ResetConfirmPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const answer = params.get('answer') === 'no' ? 'no' : 'yes';
  // Set when this tab stays open on another device: 'yes' or 'no'.
  const [done, setDone] = useState(null);

  // React runs effects twice in development; the answer must be sent once.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;

    if (!token) {
      navigate('/login', { replace: true, state: { error: 'This link is no longer valid.' } });
      return;
    }
    accountService
      .answerResetRequest(token, answer)
      .then(async (result) => {
        await finishEmailTab({ channel: RESET_CHANNEL, sameBrowser: result.sameBrowser });
        // Still open.
        if (!result.sameBrowser) return setDone(result.answer);
        return navigate(result.answer === 'yes' ? '/login?reset=continue' : '/login', { replace: true });
      })
      .catch((err) => navigate('/login', { replace: true, state: { error: err.message } }));
  }, [token, answer, navigate]);

  if (!done) return <div className="auth-loading">Loading…</div>;
  return (
    <AuthShell>
      <p className="auth-status__text" role="status">
        {done === 'yes' ? 'Verified.' : 'Cancelled.'} You can close this tab.
      </p>
    </AuthShell>
  );
}
