// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../contexts/authContext.js';
import WelcomePage from './WelcomePage.jsx';

vi.mock('../services/accountService.js', () => ({
  completeWelcome: vi.fn(async () => ({ name: 'Ada', needsWelcome: false })),
  getSignInMethods: vi.fn(async () => ({ password: true, google: false })),
}));
import * as accountService from '../services/accountService.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWelcome(user) {
  const signedIn = vi.fn();
  render(
    <AuthContext.Provider value={{ user, signedIn }}>
      <MemoryRouter initialEntries={['/welcome']}>
        <Routes>
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/app" element={<p>workspace</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return { signedIn };
}

describe('WelcomePage', () => {
  const newUser = { name: 'Ada Lovelace', needsWelcome: true };

  it('shows the name from sign-up, read-only', () => {
    renderWelcome(newUser);
    const field = screen.getByLabelText('Your name');
    expect(field.value).toBe('Ada Lovelace');
    expect(field.readOnly).toBe(true);
    // Nothing to skip: the only way on is Continue.
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
  });

  it('opens the workspace on Continue, without sending a name', async () => {
    renderWelcome(newUser);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('workspace')).toBeTruthy());
    expect(accountService.completeWelcome).toHaveBeenCalledWith();
  });

  it('is never shown again once done', () => {
    renderWelcome({ ...newUser, needsWelcome: false });
    expect(screen.getByText('workspace')).toBeTruthy();
  });
});
