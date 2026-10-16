import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/authContext.js';
import * as accountService from '../services/accountService.js';
import { AuthShell, GoogleOption } from './AuthShell.jsx';
import PasswordField from './PasswordField.jsx';
import VerificationBox from './VerificationBox.jsx';
import { listenForEmailTab, RESET_CHANNEL } from './emailTabs.js';

const MIN_LENGTH = 10;
// How often the new-password fields re-check that the reset is still confirmed.
const RESET_CHECK_MS = 4000;

// Google sends the browser back here with a reason code rather than an error body.
const GOOGLE_ERRORS = {
  google_denied: 'Google sign-in was cancelled.',
  google_state: 'That sign-in attempt expired. Try again.',
  google_incomplete: 'Google did not complete the sign-in. Try again.',
  google_unverified: 'Your Google account’s email address is unverified.',
  google_failed: 'Google sign-in failed. Try again, or use your password.',
  email_failed: 'We couldn’t send the confirmation email right now. Try again in a moment.',
};

const RESET_LABELS = {
  waiting: 'Waiting for your answer…',
  success: 'Confirmed!',
  failed: 'Expired!',
  resend: 'Resend email',
  resendTitle: 'Send the email again — the old one stops working',
};

/**
 * Sign in, laid out as Postman's page is: email, password (with the eye button to show
 * it), then "Stay signed in" and "Forgot password?" on one line, the button, "or",
 * Google, and "Create account" under the card.
 *
 * "Forgot password?" works on this page, Google-style: it emails "Is this you?" to the
 * address typed above, the page waits for the answer, and "Yes, it's me" turns the page
 * into New password / Confirm — so the password is changed here, in the browser that
 * asked, never from the email itself.
 */
export default function LoginPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { signedIn, isAuthenticated, isLoading, notice } = useAuth();
  // Back from "Yes, it's me" pressed in another tab of this browser: carry on here.
  const [resumeReset] = useState(() => params.get('reset') === 'continue');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  // Google's reason code, or why an emailed reset link could not be used.
  const [error, setError] = useState(
    () => GOOGLE_ERRORS[params.get('error')] || location.state?.error || '',
  );
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);

  // null while signing in; { phase: 'waiting' | 'new', email } during a reset.
  const [reset, setReset] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    document.title = 'Sign in — ApIForge';
  }, []);

  // The error from an emailed link is shown once; a reload should not bring it back.
  useEffect(() => {
    if (location.state?.error) navigate('/login', { replace: true, state: null });
  }, [location.state, navigate]);

  useEffect(() => {
    if (!resumeReset) return undefined;
    setParams({}, { replace: true });
    let active = true;
    accountService
      .getResetStatus()
      .then((result) => {
        if (!active) return;
        if (result.status === 'confirmed') setReset({ phase: 'new', email: result.email });
        else if (result.status === 'waiting' || result.status === 'expired') {
          setReset({ phase: 'waiting', email: result.email });
        }
      })
      .catch(() => {
        // Nothing to resume that we can see; the sign-in form is the right thing to show.
      });
    return () => {
      active = false;
    };
  }, [resumeReset, setParams]);

  const resetActive = Boolean(reset);
  const choosingPassword = reset?.phase === 'new';

  // While a reset is under way: answer the tab an email button opened (so it can close
  // itself) and take its answer at once; and while the new-password fields are showing,
  // keep checking — if the request ends elsewhere (a newer one from another browser
  // replaced it, or it ran out), go back rather than failing on submit.
  useEffect(() => {
    if (!resetActive) return undefined;
    let active = true;

    const apply = (result) => {
      if (!active) return;
      if (result.status === 'confirmed') setReset((r) => r && { ...r, phase: 'new' });
      else if (result.status === 'expired') setReset((r) => r && { ...r, phase: 'waiting' });
      else if (result.status !== 'waiting') setReset(null);
    };
    // A dropped check is not an answer; the next one (or the next email tab) asks again.
    const check = () => accountService.getResetStatus().then(apply).catch(() => {});

    const stopListening = listenForEmailTab(RESET_CHANNEL, check);
    const timer = choosingPassword ? setInterval(check, RESET_CHECK_MS) : null;
    return () => {
      active = false;
      stopListening();
      if (timer) clearInterval(timer);
    };
  }, [resetActive, choosingPassword]);

  if (isLoading) return <div className="auth-loading">Loading…</div>;
  if (isAuthenticated) return <Navigate to="/app" replace />;

  const handleSignIn = async () => {
    setBusy(true);
    try {
      // Only a confirmed account signs in; an unconfirmed one is reported as no account.
      const result = await accountService.login({ email, password, remember });
      signedIn(result.user);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const handleNewPassword = async () => {
    // Checked here purely to save a round trip; the rules that matter are the server's.
    if (newPassword.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (newPassword !== confirm) return setError('Those two passwords do not match.');
    setBusy(true);
    try {
      const user = await accountService.completePasswordReset({ password: newPassword, remember });
      signedIn(user);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
    return undefined;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (reset?.phase === 'new') handleNewPassword();
    else if (!reset) handleSignIn();
  };

  const forgotPassword = async () => {
    setError('');
    if (!/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
      setError('Enter your email above, then press “Forgot password?”.');
      return;
    }
    setSending(true);
    try {
      const result = await accountService.requestPasswordReset(email.trim());
      setPassword('');
      setReset({ phase: 'waiting', email: result.email });
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const backToSignIn = () => {
    accountService.cancelPasswordReset();
    setReset(null);
    setNewPassword('');
    setConfirm('');
    setError('');
  };

  // "No, it wasn't me", or the request was replaced: simply back to signing in.
  const handleResetEnded = () => setReset(null);

  const title = !reset ? 'Sign in to ApIForge' : reset.phase === 'new' ? 'Choose a new password' : 'Reset your password';

  return (
    <AuthShell aside="signin" title={title} footer={<Link to="/signup">Create account</Link>}>
      <form className="auth__form" onSubmit={handleSubmit}>
        <label className="auth__field">
          Email
          <input
            type="email"
            required
            value={reset ? reset.email : email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={Boolean(reset)}
            autoComplete="email"
            autoFocus
          />
        </label>

        {!reset && (
          <>
            <PasswordField
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />

            <div className="auth__options">
              <label className="auth__check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Stay signed in
              </label>
              <button type="button" className="auth__small-link" onClick={forgotPassword} disabled={busy || sending}>
                {sending ? 'Sending…' : 'Forgot password?'}
              </button>
            </div>
          </>
        )}

        {reset?.phase === 'waiting' && (
          <VerificationBox
            getStatus={accountService.getResetStatus}
            resend={accountService.resendResetEmail}
            labels={RESET_LABELS}
            onVerified={() => setReset((r) => r && { ...r, phase: 'new' })}
            onNeedsSignIn={handleResetEnded}
          />
        )}

        {reset?.phase === 'new' && (
          <>
            <p className="auth__status">It’s you — choose a new password for your account.</p>
            <PasswordField
              label="New password"
              required
              minLength={MIN_LENGTH}
              title={`At least ${MIN_LENGTH} characters.`}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
            />
            <PasswordField
              label="Confirm new password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
            <label className="auth__check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Stay signed in
            </label>
          </>
        )}

        {notice && !error && !reset && <p className="auth__notice" role="status">{notice}</p>}

        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}

        {!reset && (
          <button type="submit" className="auth__submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        )}
        {reset?.phase === 'new' && (
          <button type="submit" className="auth__submit" disabled={busy}>
            {busy ? 'Saving…' : 'Set password and sign in'}
          </button>
        )}
        {reset && (
          <button type="button" className="auth__small-link auth__change-email" onClick={backToSignIn}>
            Back to sign in
          </button>
        )}
      </form>

      {!reset && <GoogleOption label="Sign In with Google" remember={remember} />}
    </AuthShell>
  );
}
