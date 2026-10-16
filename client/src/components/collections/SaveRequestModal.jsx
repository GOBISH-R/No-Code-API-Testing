import { useMemo, useState } from 'react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

// "Parent/Child" labels for the folder dropdown — the same shape the sidebar and the
// export format use, so a folder reads identically everywhere.
function folderOptionsFor(collection) {
  const folders = collection?.folders || [];
  const byId = new Map(folders.map((f) => [String(f._id), f]));

  const pathOf = (folder, seen = new Set()) => {
    const key = String(folder._id);
    if (seen.has(key)) return folder.name;
    seen.add(key);
    const parent = folder.parentId ? byId.get(String(folder.parentId)) : null;
    return parent ? `${pathOf(parent, seen)}/${folder.name}` : folder.name;
  };

  return folders
    .map((folder) => ({ id: String(folder._id), path: pathOf(folder) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export default function SaveRequestModal({ collections, onConfirm, onCancel }) {
  useEscapeToClose(onCancel);
  const [name, setName] = useState('');
  const [mode, setMode] = useState(collections.length ? 'existing' : 'new');
  const [collectionId, setCollectionId] = useState(collections[0]?._id || '');
  const [folderId, setFolderId] = useState('');
  const [newCollectionName, setNewCollectionName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const folderOptions = useMemo(
    () => folderOptionsFor(collections.find((c) => c._id === collectionId)),
    [collections, collectionId],
  );

  // A folder belongs to one collection, so a folder chosen under the previous
  // collection must not survive switching to another one.
  const handleCollectionChange = (id) => {
    setCollectionId(id);
    setFolderId('');
  };

  const canConfirm =
    name.trim() && (mode === 'existing' ? collectionId : newCollectionName.trim()) && !isSaving;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setIsSaving(true);
    setError(null);
    try {
      await onConfirm({
        name: name.trim(),
        collectionId: mode === 'existing' ? collectionId : null,
        newCollectionName: mode === 'new' ? newCollectionName.trim() : null,
        // A brand-new collection has no folders yet, so this only applies to an existing one.
        folderId: mode === 'existing' ? folderId || null : null,
      });
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to save the request.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div role="dialog" aria-modal="true" className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">Save Request</h3>

        <label className="modal__field">
          Request name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Get user by id"
            autoFocus
          />
        </label>

        <div className="modal__field">
          <span>Collection</span>

          {collections.length > 0 && (
            <label className="modal__radio">
              <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} />
              Existing collection
            </label>
          )}
          {mode === 'existing' && collections.length > 0 && (
            <select value={collectionId} onChange={(e) => handleCollectionChange(e.target.value)}>
              {collections.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          {mode === 'existing' && folderOptions.length > 0 && (
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">(collection root)</option>
              {folderOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.path}
                </option>
              ))}
            </select>
          )}

          <label className="modal__radio">
            <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
            New collection
          </label>
          {mode === 'new' && (
            <input
              type="text"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              placeholder="Collection name"
            />
          )}
        </div>

        {error && <p className="modal__error">{error}</p>}

        <div className="modal__actions">
          <button onClick={onCancel} disabled={isSaving}>
            Cancel
          </button>
          <button className="modal__confirm" onClick={handleConfirm} disabled={!canConfirm}>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
