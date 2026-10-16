import '../../pages/auth.css';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/authContext.js';
import AccountSettingsModal from '../account/AccountSettingsModal.jsx';
import Icon from '../common/Icon.jsx';

/**
 * Who you are signed in as, account settings, and the way out — the same short menu
 * Postman shows.
 */
export default function AccountMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ref = useRef(null);

  // Click-outside and Escape, so the menu never strands itself open over the workspace.
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="account" ref={ref}>
      <button
        type="button"
        className="account__trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={user.email}
      >
        {user.avatarUrl ? (
          <img className="account__avatar" src={user.avatarUrl} alt="" />
        ) : (
          <span className="account__initial">{initial}</span>
        )}
      </button>

      {open && (
        <div className="account__menu" role="menu">
          <div className="account__identity">
            {user.name && <div className="account__name">{user.name}</div>}
            <div className="account__email">{user.email}</div>
          </div>

          <button
            type="button"
            className="account__item"
            onClick={() => {
              setOpen(false);
              setSettingsOpen(true);
            }}
            role="menuitem"
          >
            <Icon name="settings" size={15} />
            Account settings
          </button>
          <button type="button" className="account__signout" onClick={handleSignOut} role="menuitem">
            <Icon name="signOut" size={15} />
            Sign out
          </button>
        </div>
      )}

      {settingsOpen && <AccountSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
