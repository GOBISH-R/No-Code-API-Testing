// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../contexts/authContext.js';
import SignupPage from './SignupPage.jsx';
import LoginPage from './LoginPage.jsx';
import { VERIFY_CHANNEL } from './emailTabs.js';

vi.mock('../services/accountService.js', () => ({
  register: vi.fn(async ({ email }) => ({ status: 'verification_sent', email })),
  login: vi.fn(async () => ({ user: { name: 'Ada' } })),
  getVerificationStatus: vi.fn(async () => ({ status: 'none' })),
  resendVerificationLink: vi.fn(async () => ({ status: 'waiting' })),
  getSignInMethods: vi.fn(async () => ({ password: true, google: false })),
  cancelVerificationWait: vi.fn(async () => {}),
  googleSignInUrl: () => '/api/accounts/google',
}));
import * as accountService from '../services/accountService.js';

/** Lets the minute between emails pass, so Resend can be pressed. */
async function waitOutResendCountdown() {
  // A second at a time: each tick of the countdown is scheduled after the last renders.
  for (let s = 0; s < 61; s += 1) {
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
  }
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
  accountService.getVerificationStatus.mockResolvedValue({ status: 'none' });
});

function renderAt(path) {
  render(
    <AuthContext.Provider value={{ isLoading: false, isAuthenticated: false, signedIn: vi.fn() }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/app" element={<p>workspace</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

/** Fills the sign-up form and submits it, so the page is waiting on its link. */
async function signUpAndWait(status = 'waiting') {
  renderAt('/signup');
  accountService.register.mockImplementationOnce(async ({ email }) => {
    accountService.getVerificationStatus.mockResolvedValue({ status, email });
    return { status: 'verification_sent', email };
  });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct horse battery' } });
  fireEvent.submit(document.querySelector('form'));
}

describe('sign-up', () => {
  it('asks for name, email and password, and sends all three', async () => {
    renderAt('/signup');
    const inputs = [...document.querySelectorAll('form input')].map((i) => i.getAttribute('autocomplete'));
    expect(inputs).toEqual(['name', 'email', 'new-password', null]);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Gobish R' } });

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct horse battery' } });
    fireEvent.submit(document.querySelector('form'));

    await waitFor(() =>
      expect(accountService.register).toHaveBeenCalledWith({
        name: 'Gobish R',
        email: 'ada@example.com',
        password: 'correct horse battery',
        remember: true,
      }),
    );
  });

  it('does not let anyone in on sign-up: it shows "Verifying…" until the link is clicked', async () => {
    renderAt('/signup');
    // Once the account is created, the server reports this browser as waiting.
    accountService.register.mockImplementationOnce(async ({ email }) => {
      accountService.getVerificationStatus.mockResolvedValue({ status: 'waiting', email });
      return { status: 'verification_sent', email };
    });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct horse battery' } });
    fireEvent.submit(document.querySelector('form'));

    expect(await screen.findByText('Verifying…')).toBeTruthy();
    // Resend sits on the right of the box, counting down from the email just sent.
    expect(screen.getByRole('button', { name: /Resend in \d+s/ })).toBeTruthy();
    // The form is locked and the button gone: nothing to do but open the email.
    expect(screen.getByLabelText('Email').matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
    expect(screen.queryByText('workspace')).toBeNull();
  });

  it('shows "Success!" and opens the workspace once the link has been clicked', async () => {
    renderAt('/signup');
    accountService.register.mockImplementationOnce(async ({ email }) => {
      accountService.getVerificationStatus.mockResolvedValue({ status: 'waiting', email });
      return { status: 'verification_sent', email };
    });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct horse battery' } });
    fireEvent.submit(document.querySelector('form'));
    await screen.findByText('Verifying…');

    // The link gets clicked; the person comes back to this tab.
    accountService.getVerificationStatus.mockResolvedValue({ status: 'verified', user: { name: 'Ada' } });
    window.dispatchEvent(new Event('focus'));

    expect(await screen.findByText('Success!')).toBeTruthy();
    expect(await screen.findByText('workspace', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('answers the tab "Verify my email" opened, so it can close, and moves on at once', async () => {
    await signUpAndWait();
    expect(await screen.findByText('Verifying…')).toBeTruthy();

    accountService.getVerificationStatus.mockResolvedValue({ status: 'verified', user: { name: 'Ada' } });
    const verifyTab = new BroadcastChannel(VERIFY_CHANNEL);
    const replies = [];
    verifyTab.onmessage = (e) => replies.push(e.data?.type);
    try {
      verifyTab.postMessage({ type: 'answered' });
      expect(await screen.findByText('workspace')).toBeTruthy();
      // The reply is delivered as its own message, a moment after the page moves on.
      await waitFor(() => expect(replies).toContain('here'));
    } finally {
      verifyTab.close();
    }
  });

  it('shows "Failed!" when the ten-minute link runs out, and Resend brings back "Verifying…"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await signUpAndWait('expired');
    expect(await screen.findByText('Failed!')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Resend in \d+s/ }).disabled).toBe(true);
    await waitOutResendCountdown();

    accountService.getVerificationStatus.mockResolvedValue({ status: 'waiting', email: 'ada@example.com' });
    fireEvent.click(screen.getByRole('button', { name: 'Resend link' }));
    expect(await screen.findByText('Verifying…')).toBeTruthy();
    expect(accountService.resendVerificationLink).toHaveBeenCalledTimes(1);
  });

  it('lets Resend be pressed once a minute, counting from the email just sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await signUpAndWait();
    expect((await screen.findByRole('button', { name: /Resend in \d+s/ })).disabled).toBe(true);
    await waitOutResendCountdown();
    const resend = await screen.findByRole('button', { name: 'Resend link' });

    fireEvent.click(resend);
    const cooling = await screen.findByRole('button', { name: /Resend in 60s/ });
    expect(cooling.disabled).toBe(true);
    fireEvent.click(cooling);
    expect(accountService.resendVerificationLink).toHaveBeenCalledTimes(1);
  });

  it('shows "already exists" under the form when the email is taken', async () => {
    accountService.register.mockRejectedValueOnce(
      new Error('An account with this email already exists. Sign in instead.'),
    );
    renderAt('/signup');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct horse battery' } });
    fireEvent.submit(document.querySelector('form'));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'An account with this email already exists. Sign in instead.',
    );
  });

  it('opened again after closing the tab, it is a plain sign-up form', async () => {
    // Even with a link still out there, a fresh page does not resume the wait.
    accountService.getVerificationStatus.mockResolvedValue({ status: 'waiting', email: 'ada@example.com' });
    renderAt('/signup');
    expect(await screen.findByRole('button', { name: 'Create account' })).toBeTruthy();
    expect(screen.queryByText('Verifying…')).toBeNull();
    expect(accountService.getVerificationStatus).not.toHaveBeenCalled();
  });

  it('back from a Google sign-up, it waits for the emailed link', async () => {
    accountService.getVerificationStatus.mockResolvedValue({ status: 'waiting', email: 'ada@gmail.com' });
    renderAt('/signup?verify=sent');
    expect(await screen.findByText('Verifying…')).toBeTruthy();
    expect(screen.getByLabelText('Email').value).toBe('ada@gmail.com');
  });

  it('"Use a different email" goes back to the form, and the same email simply sends a new link', async () => {
    await signUpAndWait();
    fireEvent.click(await screen.findByRole('button', { name: 'Use a different email' }));
    expect(accountService.cancelVerificationWait).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Create account' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct horse battery' } });
    fireEvent.submit(document.querySelector('form'));
    expect(await screen.findByText('Verifying…')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('sign-in', () => {
  it('has no "Verifying…" box, ever — even with a sign-up waiting in this browser', async () => {
    accountService.getVerificationStatus.mockResolvedValue({ status: 'waiting', email: 'ada@example.com' });
    renderAt('/login');
    expect(await screen.findByRole('button', { name: 'Sign In' })).toBeTruthy();
    expect(screen.queryByText('Verifying…')).toBeNull();
  });

  it('an unconfirmed sign-up is reported as no account, and nobody gets in', async () => {
    accountService.login.mockRejectedValueOnce(
      new Error('No account exists with this email.'),
    );
    renderAt('/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct horse battery' } });
    fireEvent.submit(document.querySelector('form'));

    expect(await screen.findByText(/No account exists with this email/)).toBeTruthy();
    expect(screen.queryByText('Verifying…')).toBeNull();
    expect(screen.queryByText('workspace')).toBeNull();
  });

  it('sends the email and password', async () => {
    renderAt('/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct horse battery' } });
    fireEvent.submit(document.querySelector('form'));

    await waitFor(() =>
      expect(accountService.login).toHaveBeenCalledWith({
        email: 'ada@example.com',
        password: 'correct horse battery',
        remember: true,
      }),
    );
  });

  it('sends "Stay signed in" unticked when the box is cleared', async () => {
    renderAt('/login');
    expect(screen.getByLabelText('Stay signed in').checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Stay signed in'));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct horse battery' } });
    fireEvent.submit(document.querySelector('form'));

    await waitFor(() =>
      expect(accountService.login).toHaveBeenCalledWith(expect.objectContaining({ remember: false })),
    );
  });

  it('shows and hides the password with the eye button in the field', () => {
    renderAt('/login');
    const input = screen.getByLabelText(/^Password/);
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input.type).toBe('password');
  });
});
