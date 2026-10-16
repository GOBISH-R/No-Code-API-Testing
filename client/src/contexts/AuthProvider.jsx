import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthContext } from './authContext.js';
import * as accountService from '../services/accountService.js';
import { onSignedOutByServer } from '../services/api.js';

// How often coming back to the tab re-checks the session with the server, at most.
const FOCUS_CHECK_MS = 15 * 1000;

// Tabs of this app tell each other about signing in and out, as Google, Notion and
// Postman do: sign out in one tab and the others follow, sign in and they follow too.
function openChannel() {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel('apiforge-auth') : null;
  } catch {
    return null;
  }
}

/**
 * Who is signed in.
 *
 * Context rather than a hook called in several places, because every one of those
 * calls would be a separate `/accounts/me` request on load, and they would disagree
 * with each other the moment one signed out.
 *
 * The three states are distinct and the distinction matters: `loading` is not
 * `signed out`. Treating them the same flashes the sign-in page at someone who is
 * already signed in, on every single page load.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous
  // Why the person is looking at the sign-in page, when it was not their own doing.
  const [notice, setNotice] = useState('');
  const statusRef = useRef(status);
  const channel = useRef(null);
  const lastCheck = useRef(0);

  const apply = useCallback((nextUser) => {
    setUser(nextUser);
    setStatus(nextUser ? 'authenticated' : 'anonymous');
    statusRef.current = nextUser ? 'authenticated' : 'anonymous';
  }, []);

  // Signed in here: clear any old notice and let the other tabs know.
  const signedIn = useCallback(
    (nextUser) => {
      apply(nextUser);
      setNotice('');
      if (nextUser) channel.current?.postMessage({ type: 'signed-in' });
    },
    [apply],
  );

  // The session ended without this tab asking: show the sign-in page, and say why.
  const ended = useCallback(
    (message) => {
      if (statusRef.current !== 'authenticated') return;
      apply(null);
      setNotice(message);
    },
    [apply],
  );

  const refresh = useCallback(async () => {
    try {
      const current = await accountService.getCurrentUser();
      apply(current);
      return current;
    } catch {
      // A network failure is not proof of being signed out, but there is nothing
      // useful to show either; the sign-in page can at least be reached from here.
      apply(null);
      return null;
    }
  }, [apply]);

  useEffect(() => {
    // Guarded because the answer arrives after an await, by which point this provider
    // may have unmounted — setting state then is a no-op with a warning attached.
    let active = true;

    accountService
      .getCurrentUser()
      .then((current) => {
        if (active) apply(current);
      })
      .catch(() => {
        if (active) apply(null);
      });

    return () => {
      active = false;
    };
  }, [apply]);

  useEffect(() => {
    channel.current = openChannel();
    const onMessage = (e) => {
      if (e.data?.type === 'signed-out') ended('You signed out in another tab.');
      if (e.data?.type === 'signed-in' && statusRef.current !== 'authenticated') refresh();
    };
    channel.current?.addEventListener('message', onMessage);

    // A request that comes back 401 means the session is gone — it expired, or a password
    // reset ended it — so the app stops pretending and asks the person to sign in.
    onSignedOutByServer(() => ended('Your session has ended. Sign in again to continue.'));

    // Coming back to the tab after a while: check the session is still there.
    const onFocus = async () => {
      if (Date.now() - lastCheck.current < FOCUS_CHECK_MS) return;
      lastCheck.current = Date.now();
      try {
        const current = await accountService.getCurrentUser();
        if (current && statusRef.current !== 'authenticated') apply(current);
        if (!current) ended('Your session has ended. Sign in again to continue.');
      } catch {
        // Offline is not signed out; the next look will tell.
      }
    };
    window.addEventListener('focus', onFocus);

    return () => {
      channel.current?.removeEventListener('message', onMessage);
      channel.current?.close();
      channel.current = null;
      onSignedOutByServer(null);
      window.removeEventListener('focus', onFocus);
    };
  }, [apply, ended, refresh]);

  // `notice` is shown on the sign-in page afterwards — "Your account was deleted."
  const signOut = useCallback(
    async ({ notice: why = '' } = {}) => {
      try {
        await accountService.logout();
      } finally {
        // Cleared regardless: if the request failed the cookie may still be live, but
        // leaving the UI signed in would be worse than a stale session on the server.
        apply(null);
        setNotice(why);
        channel.current?.postMessage({ type: 'signed-out' });
      }
    },
    [apply],
  );

  const value = useMemo(
    () => ({
      user,
      status,
      isLoading: status === 'loading',
      isAuthenticated: status === 'authenticated',
      refresh,
      /** Called by the sign-in, confirmation and reset flows, which all return a user. */
      signedIn,
      signOut,
      /** Why the sign-in page is showing, when the person did not sign out themselves. */
      notice,
      clearNotice: () => setNotice(''),
    }),
    [user, status, refresh, signedIn, signOut, notice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
