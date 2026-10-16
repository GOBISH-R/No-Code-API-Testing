// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../contexts/authContext.js';
import VerifyEmailPage from './VerifyEmailPage.jsx';
import { VERIFY_CHANNEL } from './emailTabs.js';

vi.mock('../services/accountService.js', () => ({
  verifyEmail: vi.fn(),
  getSignInMethods: vi.fn(async () => ({ password: true, google: false })),
}));
import * as accountService from '../services/accountService.js';

let close;
const signedIn = vi.fn();

beforeEach(() => {
  close = vi.spyOn(window, 'close').mockImplementation(() => {});
});

afterEach(() => {
  close.mockRestore();
  cleanup();
  vi.clearAllMocks();
});

function renderAt(url) {
  render(
    <AuthContext.Provider value={{ signedIn }}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/app" element={<p>workspace</p>} />
          <Route path="/login" element={<p>sign-in page</p>} />
          <Route path="/signup" element={<p>sign-up page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('VerifyEmailPage', () => {
  it('in the browser that signed up, with its sign-up tab open: verifies and closes at once', async () => {
    accountService.verifyEmail.mockResolvedValue({ verified: true, sameBrowser: true, user: { name: 'Ada' } });
    const signUpTab = new BroadcastChannel(VERIFY_CHANNEL);
    signUpTab.onmessage = (e) => {
      if (e.data?.type === 'answered') signUpTab.postMessage({ type: 'here' });
    };
    try {
      renderAt('/verify-email?token=abc');
      await waitFor(() => expect(close).toHaveBeenCalled());
      expect(signedIn).toHaveBeenCalledWith({ name: 'Ada' });
      expect(accountService.verifyEmail).toHaveBeenCalledTimes(1);
    } finally {
      signUpTab.close();
    }
  });

  it('in the browser that signed up, with no sign-up tab left: goes on into the app', async () => {
    accountService.verifyEmail.mockResolvedValue({ verified: true, sameBrowser: true, user: { name: 'Ada' } });
    renderAt('/verify-email?token=abc');
    expect(await screen.findByText('workspace')).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });

  it('on another device: verifies, signs nobody in there, and closes — or says it can be closed', async () => {
    accountService.verifyEmail.mockResolvedValue({ verified: true, sameBrowser: false });
    renderAt('/verify-email?token=abc');
    expect(await screen.findByText('Verified. You can close this tab.')).toBeTruthy();
    expect(close).toHaveBeenCalled();
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('a link pressed again is no longer valid, said on the sign-in page', async () => {
    accountService.verifyEmail.mockRejectedValue(
      Object.assign(new Error('This link is no longer valid.'), { code: 'ALREADY_VERIFIED' }),
    );
    renderAt('/verify-email?token=abc');
    expect(await screen.findByText('sign-in page')).toBeTruthy();
  });

  it('a link that ran out goes to the sign-up page, where a new one is a click away', async () => {
    accountService.verifyEmail.mockRejectedValue(
      Object.assign(new Error('That link has expired. Sign up again to get a new one.'), { code: 'VERIFY_EXPIRED' }),
    );
    renderAt('/verify-email?token=abc');
    expect(await screen.findByText('sign-up page')).toBeTruthy();
  });

  it('treats a dropped connection as retryable, not as a bad link', async () => {
    accountService.verifyEmail.mockRejectedValueOnce(
      Object.assign(new Error("Couldn't reach ApIForge. Check your connection and try again."), { offline: true }),
    );
    accountService.verifyEmail.mockResolvedValueOnce({ verified: true, sameBrowser: true, user: { name: 'Ada' } });
    renderAt('/verify-email?token=abc');

    expect(await screen.findByRole('heading', { name: "Couldn't verify just now" })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('workspace')).toBeTruthy();
    expect(accountService.verifyEmail).toHaveBeenCalledTimes(2);
  });

  it('a link with no code in it is no longer valid', async () => {
    renderAt('/verify-email');
    expect(await screen.findByText('sign-in page')).toBeTruthy();
    expect(accountService.verifyEmail).not.toHaveBeenCalled();
  });
});
