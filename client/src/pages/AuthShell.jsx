import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as accountService from '../services/accountService.js';
import AuthIllustration from './AuthIllustration.jsx';
import './auth.css';
import './auth-look.css';
import BrandMark from '../components/common/BrandMark.jsx';

// What the left-hand panel says. Every line is something ApIForge does today.
const ASIDES = {
  signup: {
    heading: 'Why sign up?',
    points: [
      'Send REST, GraphQL and WebSocket requests',
      'Write tests from dropdowns, no scripting',
      'Run collections against a file of test data',
      'Mock endpoints and share run reports',
    ],
  },
  signin: {
    heading: 'Welcome back',
    points: [
      'Your collections and environments are saved',
      'Run history and reports are where you left them',
      'Mock endpoints keep serving while you are away',
    ],
  },
};

function Mark({ className = '' }) {
  return (
    <Link className={`auth__mark ${className}`} to="/" aria-label="ApIForge home">
      <BrandMark size={56} />
    </Link>
  );
}

/**
 * The frame every account page shares, laid out the way Postman's are.
 *
 * - Plain pages (welcome, verification, password reset): the logo above one centred
 *   card on a background that warms towards the bottom.
 * - Sign-in and sign-up pass `aside`: on a wide screen the form moves to the right and
 *   the left shows the logo, what the app does and an illustration. On a narrow one the
 *   panel is dropped and the page falls back to the plain layout, as Postman's does.
 */
export function AuthShell({ title, children, footer, aside }) {
  const panel = aside ? ASIDES[aside] : null;

  return (
    <div className={`auth auth--stacked ${panel ? 'auth--split' : ''}`}>
      <div className="auth__layout">
        {panel && (
          <aside className="auth__aside">
            <Link className="auth__aside-brand" to="/">
              <BrandMark size={38} />
              ApIForge
            </Link>
            <h2 className="auth__aside-heading">{panel.heading}</h2>
            <ul className="auth__aside-points">
              {panel.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <AuthIllustration />
          </aside>
        )}

        <main className="auth__main">
          <Mark className={panel ? 'auth__mark--narrow-only' : ''} />
          <div className="auth__card">
            {title && <h1 className="auth__title auth__title--centred">{title}</h1>}
            {children}
          </div>
          {footer && <p className="auth__footer">{footer}</p>}
        </main>
      </div>
    </div>
  );
}

/**
 * "or" plus the Google button — always shown, like Postman.
 *
 * When this server has no Google keys yet, clicking it explains that instead of sending
 * the browser to a raw error. Once GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set it
 * goes straight to Google.
 *
 * A link rather than a button: Google sign-in is a full-page navigation, and the
 * session cookie its callback sets can only be stored by a real one.
 */
export function GoogleOption({ label, remember = true }) {
  const [configured, setConfigured] = useState(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    accountService.getSignInMethods().then((m) => active && setConfigured(Boolean(m.google)));
    return () => {
      active = false;
    };
  }, []);

  const handleClick = (e) => {
    if (configured) return;
    e.preventDefault();
    setNotice('Google sign-in isn’t set up on this server yet. Use your email for now.');
  };

  return (
    <>
      <div className="auth__divider">
        <span>or</span>
      </div>
      <a className="auth__google" href={accountService.googleSignInUrl({ remember })} onClick={handleClick}>
        <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
          <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
        </svg>
        {label}
      </a>
      {notice && (
        <p className="auth__notice auth__notice--info" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
