import '../collections/collections.css';
import './account-settings.css';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/authContext.js';
import * as accountService from '../../services/accountService.js';
import PasswordInput from '../common/PasswordInput.jsx';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

const MIN_LENGTH = 10;
// How long a "saved" pop-up stays before it fades away.
const TOAST_MS = 3000;

/**
 * The signed-in person's own account: name, password, and deleting the account.
 *
 * Something that worked is said in a pop-up that fades after three seconds; something
 * that failed stays under the part it belongs to until it is put right.
 */
export default function AccountSettingsModal({ onClose }) {
  useEscapeToClose(onClose);
  const { user, signedIn, signOut } = useAuth();
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);

  const notify = useCallback((message) => setToast({ id: Date.now(), message }), []);
  const clearToast = useCallback(() => setToast(null), []);

  if (!user) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-settings-title"
        className="modal account-settings"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="account-settings-title" className="modal__title">
          Account settings
        </h3>

        <ProfileSection user={user} onSaved={signedIn} notify={notify} />
        <PasswordSection user={user} onSaved={signedIn} notify={notify} />
        <DeleteSection
          user={user}
          onDeleted={async () => {
            await signOut({ notice: 'Your account was deleted.' });
            navigate('/login', { replace: true });
          }}
        />

        <div className="modal__actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {toast && <Toast key={toast.id} message={toast.message} onDone={clearToast} />}
    </div>
  );
}

/** A short "it worked" pop-up at the bottom of the screen; gone after TOAST_MS. */
function Toast({ message, onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, TOAST_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="account-toast" role="status" onClick={(e) => e.stopPropagation()}>
      {message}
    </div>
  );
}

/** One part of the window: a heading and its fields. */
function Section({ title, danger = false, children }) {
  return (
    <section className={`account-settings__section${danger ? ' account-settings__section--danger' : ''}`}>
      <h4 className="account-settings__heading">{title}</h4>
      {children}
    </section>
  );
}

function ErrorLine({ error }) {
  if (!error) return null;
  return (
    <p className="modal__error" role="alert">
      {error}
    </p>
  );
}

function ProfileSection({ user, onSaved, notify }) {
  const [name, setName] = useState(user.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const unchanged = name.trim() === (user.name ?? '');

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSaved(await accountService.updateProfile({ name }));
      notify('Name saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Profile">
      <form onSubmit={save}>
        <label className="modal__field">
          Name
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <div className="modal__field">
          Email
          <span className="account-settings__value">{user.email}</span>
        </div>
        <div className="account-settings__row account-settings__row--end">
          <button type="submit" className="modal__confirm" disabled={busy || unchanged || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
      <ErrorLine error={error} />
    </Section>
  );
}

/**
 * A button until it is needed: "Change password" opens Current / New / Confirm with Save
 * in the corner. Save works once all three are filled in and the new one is long enough
 * and confirmed; the server then changes it only if the current password is right.
 *
 * An account that signs in only with Google has no current password to give, so this
 * part is not shown for it ("Forgot password?" on the sign-in page sets one by email).
 */
function PasswordSection({ user, onSaved, notify }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!user.hasPassword) return null;

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = current.length > 0 && next.length >= MIN_LENGTH && next === confirm;

  const close = () => {
    setOpen(false);
    setCurrent('');
    setNext('');
    setConfirm('');
    setError('');
  };

  const save = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      onSaved(await accountService.changePassword({ currentPassword: current, newPassword: next }));
      close();
      notify('Password changed. Your other devices were signed out.');
    } catch (err) {
      // Wrong current password (or any other refusal): nothing changed, the fields stay.
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Section title="Password">
        <div className="account-settings__row account-settings__row--end">
          <button type="button" onClick={() => setOpen(true)}>
            Change password
          </button>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Change password">
      <form onSubmit={save}>
        <label className="modal__field">
          Current password
          <PasswordInput
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </label>
        <label className="modal__field">
          New password
          <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </label>
        {tooShort && <p className="account-settings__hint">Use at least {MIN_LENGTH} characters.</p>}
        <label className="modal__field">
          Confirm new password
          <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </label>
        {mismatch && <p className="account-settings__hint">The passwords don’t match.</p>}
        <ErrorLine error={error} />
        <div className="account-settings__row account-settings__row--end">
          <button type="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="modal__confirm" disabled={busy || !ready}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Section>
  );
}

function DeleteSection({ user, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    setOpen(true);
    setError('');
    try {
      setSummary(await accountService.getDeletionSummary());
    } catch {
      setSummary({ ownedWorkspaces: [], memberOfWorkspaces: 0 });
    }
  };

  const remove = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await accountService.deleteAccount(user.hasPassword ? { password: confirmation } : { email: confirmation });
      await onDeleted();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Section title="Delete account" danger>
        <div className="account-settings__row">
          <span className="account-settings__help">Permanently delete your account and everything in it.</span>
          <button type="button" className="account-settings__danger" onClick={start}>
            Delete account…
          </button>
        </div>
      </Section>
    );
  }

  const owned = summary?.ownedWorkspaces ?? [];
  const memberOf = summary?.memberOfWorkspaces ?? 0;

  return (
    <Section title="Delete account" danger>
      <p className="account-settings__warning">
        This permanently deletes your account and your collections, requests, environments, history, mocks, runs and
        monitors. It can’t be undone.
      </p>
      {owned.length > 0 && (
        <div className="account-settings__warning">
          These workspaces you own are deleted for everyone in them:
          <ul>
            {owned.map((w) => (
              <li key={w.name}>
                {w.name}
                {w.members > 0 && ` (${w.members} other ${w.members === 1 ? 'person' : 'people'})`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {memberOf > 0 && (
        <p className="account-settings__warning">
          You’ll be removed from {memberOf} {memberOf === 1 ? 'workspace' : 'workspaces'} you joined.
        </p>
      )}
      <form onSubmit={remove}>
        <label className="modal__field">
          {user.hasPassword ? 'Enter your password to confirm' : `Type ${user.email} to confirm`}
          {user.hasPassword ? (
            <PasswordInput
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="current-password"
              required
            />
          ) : (
            <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" required />
          )}
        </label>
        <ErrorLine error={error} />
        <div className="account-settings__row account-settings__row--end">
          <button type="button" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="account-settings__danger account-settings__danger--solid" disabled={busy || !confirmation}>
            {busy ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </form>
    </Section>
  );
}
