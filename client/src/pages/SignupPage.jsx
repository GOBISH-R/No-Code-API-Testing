import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/authContext.js';
import * as accountService from '../services/accountService.js';
import { AuthShell, GoogleOption } from './AuthShell.jsx';
import PasswordField from './PasswordField.jsx';
import VerificationBox from './VerificationBox.jsx';
import { useEmailVerificationWait } from './useEmailVerificationWait.js';
import { listenForEmailTab, VERIFY_CHANNEL } from './emailTabs.js';

const MIN_LENGTH = 10;

/**
 * Create an account, laid out as Postman's page is: name, email, password (with
 * the eye button to show it), "Stay signed in", the button, "or", Google, and "Already have an
 * account? Sign in" under the card.
 *
 * Creating the account does not let anyone in. A link goes to the address, the box
 * under "Stay signed in" shows "Verifying…" until it is clicked, then "Success!" — so
 * only somebody who can open that inbox gets an account they can use.
 */
export default function SignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { signedIn, isAuthenticated, isLoading } = useAuth();
  // Back from a Google sign-up: its link has been emailed, so wait for it here.
  const [fromGoogle] = useState(() => params.get('verify') === 'sent');

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [remember, setRemember] = useState(true);
  // Or why an emailed link could not be used (it ran out: sign up again for a new one).
  const [error, setError] = useState(() => location.state?.error || '');
  const [busy, setBusy] = useState(false);
  const { waitingFor, setWaitingFor } = useEmailVerificationWait({ resume: fromGoogle });

  useEffect(() => {
    document.title = 'Create account — ApIForge';
  }, []);

  // The ?verify=sent marker has done its job; a reload should be a plain sign-up page.
  useEffect(() => {
    if (fromGoogle) setParams({}, { replace: true });
  }, [fromGoogle, setParams]);

  // The error from an emailed link is shown once; a reload should not bring it back.
  useEffect(() => {
    if (location.state?.error) navigate('/signup', { replace: true, state: null });
  }, [location.state, navigate]);

  // While waiting: the tab "Verify my email" opened in this browser asks for this page,
  // so it can close itself, and the result is picked up at once instead of on the next
  // check. (Verifying signed this browser in, so the app is the next stop.)
  const waiting = Boolean(waitingFor);
  useEffect(() => {
    if (!waiting) return undefined;
    return listenForEmailTab(VERIFY_CHANNEL, () => {
      accountService
        .getVerificationStatus()
        .then((result) => {
          if (result.status !== 'verified') return;
          signedIn(result.user);
          navigate('/app', { replace: true });
        })
        .catch(() => {
          // The box's own checks pick it up instead.
        });
    });
  }, [waiting, signedIn, navigate]);

  if (isLoading) return <div className="auth-loading">Loading…</div>;
  if (isAuthenticated) return <Navigate to="/app" replace />;

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await accountService.register({ ...form, remember });
      setWaitingFor(result.email);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerified = (user) => {
    signedIn(user);
    navigate('/app', { replace: true });
  };

  // Nothing left to wait for (signed up again since, or forgotten after 24 hours):
  // back to the plain form, which simply sends a new link.
  const handleNeedsSignIn = () => setWaitingFor(null);

  const stopWaiting = () => {
    accountService.cancelVerificationWait();
    setWaitingFor(null);
  };

  return (
    <AuthShell
      aside="signup"
      title="Create your account"
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <form className="auth__form" onSubmit={handleSubmit}>
        {/* Locked while waiting: changing the address now would not change where the
            link went. "Use a different email" below unlocks it. */}
        <fieldset className="auth__fieldset" disabled={Boolean(waitingFor)}>
        <label className="auth__field">
          Name
          <input
            type="text"
            required
            maxLength={80}
            value={form.name}
            onChange={set('name')}
            autoComplete="name"
            autoFocus
          />
        </label>

        <label className="auth__field">
          Email
          <input
            type="email"
            required
            // While waiting on the link, the address it went to is shown here.
            value={waitingFor ?? form.email}
            onChange={set('email')}
            autoComplete="email"
          />
        </label>

        <PasswordField
          required
          minLength={MIN_LENGTH}
          title={`At least ${MIN_LENGTH} characters.`}
          value={form.password}
          onChange={set('password')}
          autoComplete="new-password"
        />

        <label className="auth__check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Stay signed in
        </label>
        </fieldset>

        {waitingFor && (
          <>
            <VerificationBox onVerified={handleVerified} onNeedsSignIn={handleNeedsSignIn} />
            <button type="button" className="auth__small-link auth__change-email" onClick={stopWaiting}>
              Use a different email
            </button>
          </>
        )}

        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}

        {!waitingFor && (
          <button type="submit" className="auth__submit" disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        )}
      </form>

      <GoogleOption label="Sign Up with Google" remember={remember} />
    </AuthShell>
  );
}
