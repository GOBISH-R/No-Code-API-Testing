import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/authContext.js';

/**
 * Keeps the workspace behind a session.
 *
 * This is convenience, not security — every API route enforces its own auth, and a
 * determined person can render whatever component they like. What it prevents is the
 * genuinely broken experience of an empty workspace firing a dozen requests that all
 * come back 401.
 *
 * The `loading` state must not redirect. Treating "we have not asked yet" as "signed
 * out" bounces someone who *is* signed in to the sign-in page on every page load, and
 * the fix people usually reach for is to remove the guard.
 */
export default function RequireAuth({ children, allowWelcomePending = false }) {
  const { isLoading, isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (isLoading) return <div className="app-loading">Loading…</div>;

  if (!isAuthenticated) {
    // `from` so a deep link survives the detour through signing in.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // A brand-new account sees the welcome step once — whether it arrived from the
  // sign-up form or from Google — before the workspace.
  if (user?.needsWelcome && !allowWelcomePending) return <Navigate to="/welcome" replace />;

  return children;
}
