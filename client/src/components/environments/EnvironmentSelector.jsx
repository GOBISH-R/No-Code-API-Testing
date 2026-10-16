import { useState } from 'react';
import EnvironmentManagerModal from './EnvironmentManagerModal.jsx';
import './environments.css';

export default function EnvironmentSelector({ environmentsState }) {
  const { environments, selectedId, setSelectedId, status } = environmentsState;
  const [showManager, setShowManager] = useState(false);

  return (
    <div className="env-selector">
      <select
        className="env-selector__select"
        // The selected value reads as a name with no indication of what it selects;
        // without this a screen reader announces only "combo box".
        aria-label="Environment"
        value={selectedId || ''}
        onChange={(e) => setSelectedId(e.target.value || null)}
        disabled={status === 'error'}
        title={status === 'error' ? 'Environments require a database connection' : 'Active environment'}
      >
        <option value="">No Environment</option>
        {environments.map((env) => (
          <option key={env._id} value={env._id}>
            {env.name}
          </option>
        ))}
      </select>

      <button className="env-selector__manage" onClick={() => setShowManager(true)}>
        Manage
      </button>

      {showManager && (
        <EnvironmentManagerModal
          environmentsState={environmentsState}
          onClose={() => setShowManager(false)}
        />
      )}
    </div>
  );
}
