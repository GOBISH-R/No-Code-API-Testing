import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AuthShell } from './AuthShell.jsx';
import { useAuth } from '../contexts/authContext.js';
import * as accountService from '../services/accountService.js';

/**
 * The one-time step after an email sign-up: a welcome that shows the name the account
 * will use — the one typed on the sign-up form, shown read-only. Google sign-ups never
 * see this page.
 */
export default function WelcomePage() {
  const { user, signedIn } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Welcome — ApIForge';
  }, []);

  // Already done (or an older account): straight to the workspace.
  if (!user?.needsWelcome) return <Navigate to="/app" replace />;

  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      signedIn(await accountService.completeWelcome());
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    finish();
  };

  return (
    <AuthShell title="Welcome to ApIForge!">
      <form className="auth__form" onSubmit={handleSubmit}>
        <div className="auth__field">
          <label htmlFor="welcome-name">Your name</label>
          {/* Read-only: this is the name typed on the sign-up form. */}
          <input id="welcome-name" type="text" value={user.name ?? ''} readOnly className="auth__readonly" />
          <span className="auth__hint">Shown in your account menu.</span>
        </div>

        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="auth__submit" disabled={busy}>
          {busy ? 'One moment…' : 'Continue'}
        </button>
      </form>
    </AuthShell>
  );
}
