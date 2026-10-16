import { useEffect, useState } from 'react';
import RunResultsModal from './RunResultsModal.jsx';
import { formatTimestamp } from '../../utils/format.js';
import './runner.css';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

const STATUS_LABEL = { passed: 'PASSED', failed: 'FAILED', error: 'ERROR' };

export default function TestHistoryModal({ testRunsState, collections, onClose }) {
  useEscapeToClose(onClose);
  const { runs, status, error, refresh, selectedRun, openRun, closeRun } = testRunsState;
  const [collectionFilter, setCollectionFilter] = useState('');

  useEffect(() => {
    refresh(collectionFilter || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionFilter]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">Collection Runs</h3>

        <div className="history-filter">
          <label>
            Collection
            <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)}>
              <option value="">All collections</option>
              {collections.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {status === 'loading' && <p className="history-hint">Loading…</p>}
        {status === 'error' && <p className="history-hint history-hint--error">{error}</p>}
        {status === 'ready' && runs.length === 0 && (
          <p className="history-hint">No runs yet. Run a collection to see its history here.</p>
        )}

        {runs.length > 0 && (
          <ul className="history-list">
            {runs.map((run) => (
              <li key={run._id}>
                <button className="history-row" onClick={() => openRun(run._id)}>
                  <span className={`history-row__badge history-row__badge--${run.status}`}>
                    {STATUS_LABEL[run.status]}
                  </span>
                  <span className="history-row__collection">{run.collectionName}</span>
                  {run.trigger === 'monitor' && (
                    <span className="history-row__trigger" title="Started by a monitor">
                      Monitor{run.monitorName ? ` · ${run.monitorName}` : ''}
                    </span>
                  )}
                  <span className="history-row__meta">
                    {run.requestCount} request{run.requestCount === 1 ? '' : 's'}
                  </span>
                  <span className="history-row__time">{formatTimestamp(run.startedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="modal__actions">
          <button className="modal__confirm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {selectedRun && <RunResultsModal run={selectedRun} onClose={closeRun} />}
    </div>
  );
}
