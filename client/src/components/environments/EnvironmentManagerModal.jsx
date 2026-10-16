import { useState } from 'react';
import KeyValueEditor from '../common/KeyValueEditor.jsx';
import { createId } from '../../utils/id.js';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

function toRows(variables) {
  return (variables || []).map((v) => ({
    id: createId(),
    key: v.key || '',
    value: v.value || '',
    enabled: v.enabled ?? true,
  }));
}

function toPayload(rows) {
  return rows
    .filter((r) => r.key.trim())
    .map((r) => ({ key: r.key.trim(), value: r.value, enabled: r.enabled }));
}

export default function EnvironmentManagerModal({ environmentsState, onClose }) {
  useEscapeToClose(onClose);
  const { environments, createEnvironment, updateEnvironment, deleteEnvironment, setSelectedId } =
    environmentsState;

  const [editingId, setEditingId] = useState(environments[0]?._id ?? null);
  const [name, setName] = useState(environments[0]?.name ?? '');
  const [rows, setRows] = useState(toRows(environments[0]?.variables));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const openEnvironment = (env) => {
    setEditingId(env._id);
    setName(env.name);
    setRows(toRows(env.variables));
    setError(null);
  };

  const startNew = () => {
    setEditingId(null);
    setName('');
    setRows([]);
    setError(null);
  };

  const addRow = () => setRows((r) => [...r, { id: createId(), key: '', value: '', enabled: true }]);
  const updateRow = (id, patch) =>
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const removeRow = (id) => setRows((r) => r.filter((row) => row.id !== id));

  const handleSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const payload = { name: name.trim(), variables: toPayload(rows) };
      if (editingId) {
        await updateEnvironment(editingId, payload);
      } else {
        const created = await createEnvironment(payload);
        setEditingId(created._id);
        setSelectedId(created._id);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to save the environment.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingId) return;
    if (!window.confirm(`Delete environment "${name}"?`)) return;
    await deleteEnvironment(editingId);
    startNew();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">Environments</h3>

        <div className="env-manager">
          <div className="env-manager__list">
            {environments.map((env) => (
              <button
                key={env._id}
                className={`env-manager__item ${editingId === env._id ? 'env-manager__item--active' : ''}`}
                onClick={() => openEnvironment(env)}
              >
                {env.name}
              </button>
            ))}
            <button className="env-manager__new" onClick={startNew}>
              + New Environment
            </button>
          </div>

          <div className="env-manager__editor">
            <label className="modal__field">
              Environment name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Development"
              />
            </label>

            <p className="env-manager__hint">
              Use these in any request as <code>{'{{name}}'}</code> — in the URL, params, headers,
              body, or auth.
            </p>

            <KeyValueEditor
              rows={rows}
              onAddRow={addRow}
              onUpdateRow={updateRow}
              onRemoveRow={removeRow}
              addLabel="Add Variable"
              keyPlaceholder="baseUrl"
              valuePlaceholder="https://api.example.com"
              keyLabel="Variable"
              valueLabel="Value"
              allowEmpty
            />

            {rows.length === 0 && (
              <p className="env-manager__empty">No variables yet.</p>
            )}
          </div>
        </div>

        {error && <p className="modal__error">{error}</p>}

        <div className="modal__actions">
          {editingId && (
            <button className="env-manager__delete" onClick={handleDelete} disabled={isSaving}>
              Delete
            </button>
          )}
          <button onClick={onClose} disabled={isSaving}>
            Close
          </button>
          <button
            className="modal__confirm"
            onClick={handleSave}
            disabled={!name.trim() || isSaving}
          >
            {isSaving ? 'Saving…' : editingId ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
