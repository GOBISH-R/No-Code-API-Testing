// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../../contexts/authContext.js';
import Header from './Header.jsx';

vi.mock('./ConnectionStatus.jsx', () => ({ default: () => null }));

afterEach(cleanup);

const environmentsState = { environments: [], selectedId: null, setSelectedId: vi.fn(), status: 'ready' };
const workspacesState = { workspaces: [], invites: [], currentId: null, open: vi.fn() };

function renderHeader(props) {
  render(
    <AuthContext.Provider value={{ user: null }}>
      <MemoryRouter>
        <Header environmentsState={environmentsState} workspacesState={workspacesState} {...props} />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('Header menu button (phones)', () => {
  it('opens the sidebar drawer', () => {
    const onToggleSidebar = vi.fn();
    renderHeader({ sidebarOpen: false, onToggleSidebar });
    const button = screen.getByRole('button', { name: 'Open collections, history and tools' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(onToggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('says it closes the drawer while the drawer is open', () => {
    renderHeader({ sidebarOpen: true, onToggleSidebar: vi.fn() });
    const button = screen.getByRole('button', { name: 'Close the sidebar' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});
