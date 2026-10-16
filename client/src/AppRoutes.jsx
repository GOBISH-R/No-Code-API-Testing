import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import LandingPage from './pages/LandingPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SignupPage from './pages/SignupPage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';
import ResetConfirmPage from './pages/ResetConfirmPage.jsx';
import PrivacyPage from './pages/PrivacyPage.jsx';
import TermsPage from './pages/TermsPage.jsx';
import WelcomePage from './pages/WelcomePage.jsx';
import RequireAuth from './components/common/RequireAuth.jsx';

// The workspace is the heavy half of this bundle; someone arriving at the landing page
// or the sign-in form should not pay for it before they have opened the tool.
const App = lazy(() => import('./App.jsx'));

/**
 * The route table.
 *
 * Separate from main.jsx so the entry point stays pure bootstrap — it mounts the tree
 * and nothing else.
 *
 * The account routes are public by necessity: they are how someone gets a session, and
 * a sign-in page behind a sign-in check is a locked door with the key inside.
 */
export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />

      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      {/* The old address, kept so existing links and bookmarks still land. */}
      <Route path="/signin" element={<Navigate to="/login" replace />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      {/* Where the "Is this you?" email's buttons land. The reset itself happens on the
          sign-in page; the old reset pages now lead there. */}
      <Route path="/reset-confirm" element={<ResetConfirmPage />} />
      <Route path="/forgot-password" element={<Navigate to="/login" replace />} />
      {/* Public, and linked from Google's sign-in consent screen. */}
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/reset-password" element={<Navigate to="/login" replace />} />

      <Route
        path="/welcome"
        element={
          <RequireAuth allowWelcomePending>
            <WelcomePage />
          </RequireAuth>
        }
      />

      <Route
        path="/app"
        element={
          <RequireAuth>
            <Suspense fallback={<div className="app-loading">Loading the workspace…</div>}>
              <App />
            </Suspense>
          </RequireAuth>
        }
      />

      {/* Anything else is a mistyped URL or a stale bookmark — send it home rather than
          showing a blank page. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
