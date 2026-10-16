import { useState } from 'react';
import KeyValueEditor from '../common/KeyValueEditor.jsx';
import { createId } from '../../utils/id.js';
import './variables.css';
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

export default function GlobalsManagerModal({ globalsState, onClose }) {
  useEscapeToClose(onClose);
  const { globals, updateGlobals } = globalsState;

  const [rows, setRows] = useState(toRows(globals.variables));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const addRow = () => setRows((r) => [...r, { id: createId(), key: '', value: '', enabled: true }]);
  const updateRow = (id, patch) =>
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const removeRow = (id) => setRows((r) => r.filter((row) => row.id !== id));

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await updateGlobals({ variables: toPayload(rows) });
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to save globals.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">Global Variables</h3>

        <p className="globals-manager__hint">
          Always available as <code>{'{{name}}'}</code> in every request, regardless of the active
          environment. An environment variable of the same name overrides a global one.
        </p>

        <KeyValueEditor
          rows={rows}
          onAddRow={addRow}
          onUpdateRow={updateRow}
          onRemoveRow={removeRow}
          addLabel="Add Variable"
          keyPlaceholder="apiKey"
          valuePlaceholder="shared-value"
          keyLabel="Variable"
          valueLabel="Value"
          allowEmpty
        />

        {rows.length === 0 && <p className="globals-manager__empty">No global variables yet.</p>}

        {error && <p className="modal__error">{error}</p>}

        <div className="modal__actions">
          <button onClick={onClose} disabled={isSaving}>
            Close
          </button>
          <button className="modal__confirm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
