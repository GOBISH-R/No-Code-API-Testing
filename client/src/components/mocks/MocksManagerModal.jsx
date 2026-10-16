import { useState } from 'react';
import KeyValueEditor from '../common/KeyValueEditor.jsx';
import { createId } from '../../utils/id.js';
import api from '../../services/api.js';
import { useAuth } from '../../contexts/authContext.js';
import './mocks.css';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// The mock server lives at the API's origin, sibling to /api rather than under it, and
// each account's mocks sit under its own key — e.g. http://localhost:5000/mock/<key>/users.
const mockOrigin = (api.defaults.baseURL || '').replace(/\/api\/?$/, '');

function toRows(headers) {
  return (headers || []).map((h) => ({
    id: createId(),
    key: h.key || '',
    value: h.value || '',
    enabled: h.enabled ?? true,
  }));
}

function toPayload(rows) {
  return rows
    .filter((r) => r.key.trim())
    .map((r) => ({ key: r.key.trim(), value: r.value, enabled: r.enabled }));
}

function blankForm() {
  return {
    name: '',
    method: 'GET',
    path: '/',
    statusCode: 200,
    headerRows: [],
    body: '',
    delayMs: 0,
    enabled: true,
  };
}

function formFromMock(mock) {
  return {
    name: mock.name || '',
    method: mock.method,
    path: mock.path,
    statusCode: mock.statusCode,
    headerRows: toRows(mock.headers),
    body: mock.body || '',
    delayMs: mock.delayMs,
    enabled: mock.enabled,
  };
}

export default function MocksManagerModal({ mocksState, onClose }) {
  useEscapeToClose(onClose);
  const { user } = useAuth();
  // Without the key the address 404s: it is what separates your /users from anyone else's.
  const mockBase = user?.mockKey ? `${mockOrigin}/mock/${user.mockKey}` : '';
  const { mocks, createMock, updateMock, deleteMock } = mocksState;

  const [editingId, setEditingId] = useState(mocks[0]?._id ?? null);
  const [form, setForm] = useState(mocks[0] ? formFromMock(mocks[0]) : blankForm());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const openMock = (mock) => {
    setEditingId(mock._id);
    setForm(formFromMock(mock));
    setError(null);
  };

  const startNew = () => {
    setEditingId(null);
    setForm(blankForm());
    setError(null);
  };

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const addHeaderRow = () =>
    set({ headerRows: [...form.headerRows, { id: createId(), key: '', value: '', enabled: true }] });
  const updateHeaderRow = (id, patch) =>
    set({ headerRows: form.headerRows.map((row) => (row.id === id ? { ...row, ...patch } : row)) });
  const removeHeaderRow = (id) => set({ headerRows: form.headerRows.filter((row) => row.id !== id) });

  const canSave = form.path.trim().startsWith('/') && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        method: form.method,
        path: form.path.trim(),
        statusCode: Number(form.statusCode) || 200,
        headers: toPayload(form.headerRows),
        body: form.body,
        delayMs: Number(form.delayMs) || 0,
        enabled: form.enabled,
      };
      if (editingId) {
        await updateMock(editingId, payload);
      } else {
        const created = await createMock(payload);
        setEditingId(created._id);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to save the mock.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingId) return;
    if (!window.confirm(`Delete mock "${form.name || form.path}"?`)) return;
    await deleteMock(editingId);
    startNew();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">Mocks</h3>

        <div className="mock-manager">
          <div className="mock-manager__list">
            {mocks.map((mock) => (
              <button
                key={mock._id}
                className={`mock-manager__item ${editingId === mock._id ? 'mock-manager__item--active' : ''} ${mock.enabled ? '' : 'mock-manager__item--disabled'}`}
                onClick={() => openMock(mock)}
              >
                <span className="mock-manager__item-method">{mock.method}</span>
                <span className="mock-manager__item-path">{mock.name || mock.path}</span>
              </button>
            ))}
            <button className="mock-manager__new" onClick={startNew}>
              + New Mock
            </button>
          </div>

          <div className="mock-manager__editor">
            <div className="mock-manager__row">
              <select value={form.method} onChange={(e) => set({ method: e.target.value })}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                type="text"
                className="mock-manager__path"
                placeholder="/users/:id"
                value={form.path}
                onChange={(e) => set({ path: e.target.value })}
              />
              <input
                type="number"
                className="mock-manager__status"
                min={100}
                max={599}
                value={form.statusCode}
                onChange={(e) => set({ statusCode: e.target.value })}
              />
            </div>

            <label className="modal__field">
              Name (optional)
              <input
                type="text"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Get user by id"
              />
            </label>

            {mockBase && (
              <p className="mock-manager__hint">
                Reachable at{' '}
                <code>
                  {form.method} {mockBase}{form.path}
                </code>{' '}
                — by any client under test, not through this app's Request Builder (which blocks
                loopback targets for SSRF protection).
              </p>
            )}

            <p className="mock-manager__label">Headers</p>
            <KeyValueEditor
              rows={form.headerRows}
              onAddRow={addHeaderRow}
              onUpdateRow={updateHeaderRow}
              onRemoveRow={removeHeaderRow}
              addLabel="Add Header"
              allowEmpty
            />

            <p className="mock-manager__label">Body</p>
            <textarea
              className="mock-manager__body"
              placeholder={'{\n  "id": 1\n}'}
              value={form.body}
              onChange={(e) => set({ body: e.target.value })}
              spellCheck={false}
              rows={6}
            />

            <div className="mock-manager__row mock-manager__row--footer">
              <label className="mock-manager__delay">
                Delay (ms)
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={form.delayMs}
                  onChange={(e) => set({ delayMs: e.target.value })}
                />
              </label>
              <label className="mock-manager__enabled">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => set({ enabled: e.target.checked })}
                />
                Enabled
              </label>
            </div>
          </div>
        </div>

        {error && <p className="modal__error">{error}</p>}

        <div className="modal__actions">
          {editingId && (
            <button className="mock-manager__delete" onClick={handleDelete} disabled={isSaving}>
              Delete
            </button>
          )}
          <button onClick={onClose} disabled={isSaving}>
            Close
          </button>
          <button className="modal__confirm" onClick={handleSave} disabled={!canSave}>
            {isSaving ? 'Saving…' : editingId ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
