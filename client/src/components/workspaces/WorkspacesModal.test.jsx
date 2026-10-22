// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AuthContext } from '../../contexts/authContext.js';
import WorkspacesModal from './WorkspacesModal.jsx';

const TEAM = { _id: 'w1', name: 'Payments team', role: 'owner', memberCount: 2 };

vi.mock('../../services/workspaceService.js', () => ({
  fetchMembers: vi.fn(async () => ({
    workspace: TEAM,
    members: [
      { userId: '1', name: 'Ada', email: 'ada@example.com', role: 'owner' },
      { userId: '2', name: 'Bob', email: 'bob@example.com', role: 'editor' },
    ],
    invites: [],
  })),
}));
import * as service from '../../services/workspaceService.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function open() {
  const workspacesState = { workspaces: [TEAM], invites: [], currentId: null, open: vi.fn(), refresh: vi.fn(), rename: vi.fn() };
  render(
    <AuthContext.Provider value={{ user: { id: '1', name: 'Ada', email: 'ada@example.com' } }}>
      <WorkspacesModal workspacesState={workspacesState} onClose={() => {}} />
    </AuthContext.Provider>,
  );
}

describe('WorkspacesModal', () => {
  it('keeps the people list when the already-selected workspace is clicked again', async () => {
    open();
    expect(await screen.findByText('bob@example.com')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Payments team/ }));

    expect(screen.getByText('bob@example.com')).toBeTruthy();
    expect(service.fetchMembers).toHaveBeenCalledTimes(1);
  });
});
