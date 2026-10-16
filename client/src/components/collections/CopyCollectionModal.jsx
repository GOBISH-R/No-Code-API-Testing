import { useState } from 'react';
import api from '../../services/api.js';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

function errorMessage(err, fallback) {
  return err.response?.data?.message || err.message || fallback;
}

/**
 * Copies or moves one collection to another space — the person's own, or a team
 * workspace they can edit. Requests, folders, tests and saved credentials go with it.
 */
export default function CopyCollectionModal({ collection, workspacesState, onDone, onClose }) {
  useEscapeToClose(onClose);
  const { workspaces, currentId, role } = workspacesState;
  // Only spaces the person can add to; the one they are in counts too (for a copy).
  const targets = [
    { id: '', label: 'My Workspace' },
    ...workspaces.filter((w) => w.role !== 'viewer').map((w) => ({ id: w._id, label: w.name })),
  ];
  const firstElsewhere = targets.find((t) => t.id !== (currentId ?? ''));
  const [target, setTarget] = useState(firstElsewhere?.id ?? '');
  const [mode, setMode] = useState('copy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const sameSpace = target === (currentId ?? '');
  const canMove = role !== 'viewer' && !sameSpace;
  const targetLabel = targets.find((t) => t.id === target)?.label ?? 'My Workspace';

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post(`/collections/${collection._id}/copy`, {
        targetWorkspaceId: target || null,
        mode: canMove ? mode : 'copy',
      });
      setDone({ ...data, targetLabel });
      onDone();
    } catch (err) {
      setError(errorMessage(err, 'The collection could not be copied.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="copy-title" className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 id="copy-title" className="modal__title">Copy “{collection.name}”</h3>

        {done ? (
          <>
            <p className="copy-collection__done">
              {done.mode === 'move' ? 'Moved' : 'Copied'} to <strong>{done.targetLabel}</strong> as “{done.collection.name}”.
            </p>
            <div className="modal__actions">
              {(done.targetWorkspaceId ?? '') !== (currentId ?? '') && (
                <button type="button" onClick={() => workspacesState.open(done.targetWorkspaceId)}>
                  Open {done.targetLabel}
                </button>
              )}
              <button type="button" className="modal__confirm" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            {error && <p className="modal__error">{error}</p>}
            <label className="modal__field">
              To
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {targets.map((t) => (
                  <option key={t.id || 'personal'} value={t.id}>
                    {t.label}
                    {t.id === (currentId ?? '') ? ' (here)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="modal__radio">
              <input type="radio" name="copy-mode" checked={mode === 'copy' || !canMove} onChange={() => setMode('copy')} />
              Copy — the original stays here
            </label>
            <label className={`modal__radio ${canMove ? '' : 'copy-collection__disabled'}`}>
              <input type="radio" name="copy-mode" disabled={!canMove} checked={mode === 'move' && canMove} onChange={() => setMode('move')} />
              Move — take it out of here
            </label>
            {!canMove && (
              <p className="copy-collection__hint">
                {role === 'viewer'
                  ? 'As a viewer here you can copy this collection, but not move it.'
                  : 'Pick another workspace to move it to.'}
              </p>
            )}
            {mode === 'move' && canMove && (
              <p className="copy-collection__hint">Its monitors stay behind and are removed with it.</p>
            )}

            <div className="modal__actions">
              <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="modal__confirm" disabled={busy}>
                {busy ? 'Working…' : mode === 'move' && canMove ? 'Move' : 'Copy'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
