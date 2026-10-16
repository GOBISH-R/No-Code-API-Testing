// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../../contexts/authContext.js';
import AccountSettingsModal from './AccountSettingsModal.jsx';

vi.mock('../../services/accountService.js', () => ({
  updateProfile: vi.fn(async ({ name }) => ({ ...ADA, name })),
  changePassword: vi.fn(async () => ADA),
  getDeletionSummary: vi.fn(async () => ({ ownedWorkspaces: [{ name: 'Payments team', members: 2 }], memberOfWorkspaces: 1 })),
  deleteAccount: vi.fn(async () => {}),
}));
import * as accountService from '../../services/accountService.js';

const ADA = { id: '1', name: 'Ada', email: 'ada@example.com', hasPassword: true, hasGoogle: false };
const GRACE = { id: '2', name: 'Grace', email: 'grace@example.com', hasPassword: false, hasGoogle: true };

const signedIn = vi.fn();
const signOut = vi.fn(async () => {});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function open(user = ADA) {
  render(
    <AuthContext.Provider value={{ user, signedIn, signOut }}>
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route path="/app" element={<AccountSettingsModal onClose={() => {}} />} />
          <Route path="/login" element={<p>sign-in page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const section = (title) => screen.getByRole('heading', { name: title }).closest('section');

describe('AccountSettingsModal', () => {
  it('saves a new name, says so in a pop-up that is gone after three seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      open();
      expect(screen.queryByText(/Sign in with/)).toBeNull();
      const save = within(section('Profile')).getByRole('button', { name: 'Save' });
      expect(save.disabled).toBe(true); // nothing changed yet
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada Lovelace' } });
      fireEvent.click(save);

      expect((await screen.findByRole('status')).textContent).toBe('Name saved.');
      expect(accountService.updateProfile).toHaveBeenCalledWith({ name: 'Ada Lovelace' });
      expect(signedIn).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ada Lovelace' }));

      // Shown, and still there just before the three seconds are up...
      await act(async () => {});
      await act(async () => {
        vi.advanceTimersByTime(2900);
      });
      expect(screen.getByText('Name saved.')).toBeTruthy();
      // ...then gone.
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByText('Name saved.')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the password is a button until it is needed', () => {
    open();
    expect(screen.queryByLabelText('Current password')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByLabelText('Current password')).toBeTruthy();
    expect(screen.getByLabelText('New password')).toBeTruthy();
    expect(screen.getByLabelText('Confirm new password')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Current password')).toBeNull();
  });

  it('changes the password once all three are right, then closes and says so', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    const save = within(section('Change password')).getByRole('button', { name: 'Save' });
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'correct horse battery' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a brand new passphrase' } });
    expect(save.disabled).toBe(true); // not confirmed yet
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a brand new passphrase' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    expect((await screen.findByRole('status')).textContent).toBe('Password changed. Your other devices were signed out.');
    expect(accountService.changePassword).toHaveBeenCalledWith({
      currentPassword: 'correct horse battery',
      newPassword: 'a brand new passphrase',
    });
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeTruthy();
  });

  it('says under the fields what is not right yet, and Save stays off', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'correct horse battery' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    expect(screen.getByText('Use at least 10 characters.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a brand new passphrase' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'something else entirely' } });
    expect(screen.getByText('The passwords don’t match.')).toBeTruthy();
    expect(within(section('Change password')).getByRole('button', { name: 'Save' }).disabled).toBe(true);
    expect(accountService.changePassword).not.toHaveBeenCalled();
  });

  it('a wrong current password is said under the fields, which stay open', async () => {
    accountService.changePassword.mockRejectedValueOnce(new Error('Incorrect password. Try again.'));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'not it at all' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a brand new passphrase' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a brand new passphrase' } });
    fireEvent.click(within(section('Change password')).getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Incorrect password. Try again.');
    expect(screen.getByLabelText('Current password')).toBeTruthy();
  });

  it('a Google-only account has no current password, so there is no password part', () => {
    open(GRACE);
    expect(screen.queryByRole('button', { name: 'Change password' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set password' })).toBeNull();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('deleting says what goes with it, needs the password, then signs out', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account…' }));
    expect(await screen.findByText(/Payments team/)).toBeTruthy();
    expect(section('Delete account').textContent).toMatch(/2 other people/);
    expect(section('Delete account').textContent).toMatch(/removed from 1 workspace you joined/);

    const remove = screen.getByRole('button', { name: 'Delete my account' });
    expect(remove.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Enter your password to confirm'), { target: { value: 'correct horse battery' } });
    fireEvent.click(remove);

    expect(await screen.findByText('sign-in page')).toBeTruthy();
    expect(accountService.deleteAccount).toHaveBeenCalledWith({ password: 'correct horse battery' });
    expect(signOut).toHaveBeenCalledWith({ notice: 'Your account was deleted.' });
  });

  it('a Google-only account confirms the deletion by typing its email', async () => {
    open(GRACE);
    fireEvent.click(screen.getByRole('button', { name: 'Delete account…' }));
    const field = await screen.findByLabelText('Type grace@example.com to confirm');
    fireEvent.change(field, { target: { value: 'grace@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(await screen.findByText('sign-in page')).toBeTruthy();
    expect(accountService.deleteAccount).toHaveBeenCalledWith({ email: 'grace@example.com' });
  });

  it('a wrong password is said under the field, and nothing is deleted', async () => {
    accountService.deleteAccount.mockRejectedValueOnce(new Error('Incorrect password. Try again.'));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account…' }));
    fireEvent.change(await screen.findByLabelText('Enter your password to confirm'), { target: { value: 'not it at all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Incorrect password. Try again.');
    expect(signOut).not.toHaveBeenCalled();
  });
});
