// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../contexts/authContext.js';
import LoginPage from './LoginPage.jsx';
import ResetConfirmPage from './ResetConfirmPage.jsx';
import { RESET_CHANNEL } from './emailTabs.js';

vi.mock('../services/accountService.js', () => ({
  login: vi.fn(),
  requestPasswordReset: vi.fn(async (email) => ({ status: 'confirmation_sent', email })),
  getResetStatus: vi.fn(async () => ({ status: 'waiting', email: 'ada@example.com' })),
  resendResetEmail: vi.fn(async () => ({ status: 'waiting' })),
  cancelPasswordReset: vi.fn(async () => {}),
  completePasswordReset: vi.fn(async () => ({ name: 'Ada' })),
  answerResetRequest: vi.fn(),
  getSignInMethods: vi.fn(async () => ({ password: true, google: false })),
  googleSignInUrl: () => '/api/accounts/google',
}));
import * as accountService from '../services/accountService.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  accountService.getResetStatus.mockResolvedValue({ status: 'waiting', email: 'ada@example.com' });
});

const signedIn = vi.fn();

function renderAt(path) {
  render(
    <AuthContext.Provider value={{ isLoading: false, isAuthenticated: false, signedIn }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-confirm" element={<ResetConfirmPage />} />
          <Route path="/app" element={<p>workspace</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

async function pressForgot(email = 'ada@example.com') {
  renderAt('/login');
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
}

describe('Forgot password on the sign-in page', () => {
  it('asks for the email first when the field is empty', () => {
    renderAt('/login');
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Enter your email above/);
    expect(accountService.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('emails "Is this you?" for the typed address and waits for the answer', async () => {
    await pressForgot();
    expect(await screen.findByText('Waiting for your answer…')).toBeTruthy();
    expect(accountService.requestPasswordReset).toHaveBeenCalledWith('ada@example.com');
    expect(screen.queryByLabelText(/^Password/)).toBeNull();
    expect(screen.getByLabelText('Email').disabled).toBe(true);
  });

  it('says there is no account, and stays on sign-in', async () => {
    accountService.requestPasswordReset.mockRejectedValueOnce(new Error('No account exists with this email.'));
    await pressForgot('nobody@example.com');
    expect((await screen.findByRole('alert')).textContent).toBe('No account exists with this email.');
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
  });

  it('after "Yes, it’s me", asks for the new password here and signs in', async () => {
    accountService.getResetStatus.mockResolvedValue({ status: 'confirmed', email: 'ada@example.com' });
    await pressForgot();
    const field = await screen.findByLabelText(/^New password/, {}, { timeout: 3000 });
    fireEvent.change(field, { target: { value: 'a brand new passphrase' } });
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: 'a brand new passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));

    expect(await screen.findByText('workspace')).toBeTruthy();
    expect(accountService.completePasswordReset).toHaveBeenCalledWith({ password: 'a brand new passphrase', remember: true });
  });

  it('checks the two new passwords match before sending', async () => {
    accountService.getResetStatus.mockResolvedValue({ status: 'confirmed', email: 'ada@example.com' });
    await pressForgot();
    fireEvent.change(await screen.findByLabelText(/^New password/, {}, { timeout: 3000 }), {
      target: { value: 'a brand new passphrase' },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: 'something else entirely' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
    expect(screen.getByRole('alert').textContent).toMatch(/do not match/);
    expect(accountService.completePasswordReset).not.toHaveBeenCalled();
  });

  it('after "No, it wasn’t me", simply goes back to signing in', async () => {
    accountService.getResetStatus.mockResolvedValue({ status: 'denied', email: 'ada@example.com' });
    await pressForgot();
    expect(await screen.findByRole('button', { name: 'Back to sign in' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Sign In' })).toBeTruthy();
    expect(screen.queryByText('Waiting for your answer…')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('"Back to sign in" stops waiting', async () => {
    await pressForgot();
    fireEvent.click(await screen.findByRole('button', { name: 'Back to sign in' }));
    expect(accountService.cancelPasswordReset).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
  });

  it('picks the reset up when sent back from "Choose a new password"', async () => {
    accountService.getResetStatus.mockResolvedValue({ status: 'confirmed', email: 'ada@example.com' });
    renderAt('/login?reset=continue');
    expect(await screen.findByLabelText(/^New password/)).toBeTruthy();
  });
});

describe('the email’s buttons', () => {
  let close;
  beforeEach(() => {
    close = vi.spyOn(window, 'close').mockImplementation(() => {});
  });
  afterEach(() => close.mockRestore());

  it('with the sign-in tab that asked still open: answers, that tab takes over, and this tab closes', async () => {
    accountService.answerResetRequest.mockResolvedValueOnce({ answer: 'yes', sameBrowser: true });
    // The sign-in tab that asked, listening in this browser.
    const signInTab = new BroadcastChannel(RESET_CHANNEL);
    signInTab.onmessage = (e) => {
      if (e.data?.type === 'answered') signInTab.postMessage({ type: 'here' });
    };
    try {
      renderAt('/reset-confirm?token=abc&answer=yes');
      await waitFor(() => expect(close).toHaveBeenCalled());
      expect(accountService.answerResetRequest).toHaveBeenCalledTimes(1);
      expect(accountService.answerResetRequest).toHaveBeenCalledWith('abc', 'yes');
    } finally {
      signInTab.close();
    }
  });

  it('Yes with no sign-in tab left open here: opens the new-password fields in this tab', async () => {
    accountService.answerResetRequest.mockResolvedValueOnce({ answer: 'yes', sameBrowser: true });
    accountService.getResetStatus.mockResolvedValue({ status: 'confirmed', email: 'ada@example.com' });
    renderAt('/reset-confirm?token=abc&answer=yes');
    expect(await screen.findByLabelText(/^New password/)).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });

  it('on another device (the phone): answers and closes; if the browser keeps it open, one line says so', async () => {
    accountService.answerResetRequest.mockResolvedValueOnce({ answer: 'yes', sameBrowser: false });
    renderAt('/reset-confirm?token=abc&answer=yes');
    expect(await screen.findByText('Verified. You can close this tab.')).toBeTruthy();
    expect(close).toHaveBeenCalled();
    expect(screen.queryByLabelText(/^New password/)).toBeNull();
  });

  it('No with no sign-in tab open here: the plain sign-in page, with no extra message', async () => {
    accountService.answerResetRequest.mockResolvedValueOnce({ answer: 'no', sameBrowser: true });
    renderAt('/reset-confirm?token=abc&answer=no');
    expect(await screen.findByRole('button', { name: 'Sign In' })).toBeTruthy();
    expect(accountService.answerResetRequest).toHaveBeenCalledWith('abc', 'no');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a used or expired link says why on the sign-in page', async () => {
    accountService.answerResetRequest.mockRejectedValueOnce(new Error('This link is no longer valid.'));
    renderAt('/reset-confirm?token=old&answer=yes');
    expect((await screen.findByRole('alert')).textContent).toBe('This link is no longer valid.');
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
  });
});

describe('the waiting sign-in tab', () => {
  it('a request that ends elsewhere takes the new-password fields away again', async () => {
    accountService.getResetStatus.mockResolvedValue({ status: 'confirmed', email: 'ada@example.com' });
    await pressForgot();
    await screen.findByLabelText(/^New password/, {}, { timeout: 3000 });

    // Replaced by a newer request from another browser.
    accountService.getResetStatus.mockResolvedValue({ status: 'gone' });
    const emailTab = new BroadcastChannel(RESET_CHANNEL);
    try {
      emailTab.postMessage({ type: 'answered' });
      expect(await screen.findByRole('button', { name: 'Sign In' })).toBeTruthy();
      expect(screen.queryByLabelText(/^New password/)).toBeNull();
    } finally {
      emailTab.close();
    }
  });
});
