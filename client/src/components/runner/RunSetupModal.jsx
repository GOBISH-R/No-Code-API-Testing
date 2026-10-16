import { useState } from 'react';
import DatasetPicker from './DatasetPicker.jsx';
import './runner.css';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

/**
 * Confirms what a collection run will do before it does it.
 *
 * Running used to fire straight from the sidebar button. That left nowhere to attach a
 * dataset, and nowhere to see which environment a run was about to use — both of which
 * change the result entirely.
 */
export default function RunSetupModal({ collection, environmentName, isRunning, onRun, onClose }) {
  useEscapeToClose(onClose);
  const [dataset, setDataset] = useState(null);

  if (!collection) return null;

  const requestCount = collection.requests.length;
  const iterations = dataset?.rows.length ?? 1;
  const totalRequests = requestCount * iterations;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">Run — {collection.name}</h3>

        <dl className="run-setup__facts">
          <div>
            <dt>Requests</dt>
            <dd>{requestCount}</dd>
          </div>
          <div>
            <dt>Environment</dt>
            <dd>{environmentName || 'None selected'}</dd>
          </div>
          <div>
            <dt>Iterations</dt>
            <dd>{iterations}</dd>
          </div>
          <div>
            <dt>Total requests</dt>
            <dd>{totalRequests}</dd>
          </div>
        </dl>

        <h4 className="run-setup__section">Data file <span className="auth-editor__optional">(optional)</span></h4>
        <DatasetPicker dataset={dataset} onChange={setDataset} />

        <div className="modal__actions">
          <button onClick={onClose} disabled={isRunning}>
            Cancel
          </button>
          <button
            className="modal__confirm"
            onClick={() => onRun(collection._id, dataset?.rows ?? null)}
            disabled={isRunning || requestCount === 0}
          >
            {isRunning ? 'Running…' : `Run ${totalRequests} request${totalRequests === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
