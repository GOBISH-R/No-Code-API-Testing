import { useState } from 'react';
import WorkspacesModal from './WorkspacesModal.jsx';
import './workspaces.css';

/**
 * Which workspace the app is working in — the person's own, or a team's — and the way
 * into managing them. A badge counts invitations waiting to be answered.
 */
export default function WorkspaceSwitcher({ workspacesState }) {
  const { workspaces, currentId, invites, open } = workspacesState;
  const [managing, setManaging] = useState(false);

  return (
    <div className="ws-switcher">
      <select
        className="ws-switcher__select"
        aria-label="Workspace"
        title="Workspace"
        value={currentId ?? ''}
        onChange={(e) => open(e.target.value || null)}
      >
        <option value="">My Workspace</option>
        {workspaces.map((w) => (
          <option key={w._id} value={w._id}>
            {w.name}
            {w.role === 'owner' ? '' : ` (${w.role})`}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="ws-switcher__manage"
        onClick={() => setManaging(true)}
        title={invites.length > 0 ? `${invites.length} invitation(s) waiting` : 'Create and manage team workspaces'}
      >
        Team
        {invites.length > 0 && <span className="ws-switcher__badge">{invites.length}</span>}
      </button>

      {managing && <WorkspacesModal workspacesState={workspacesState} onClose={() => setManaging(false)} />}
    </div>
  );
}
