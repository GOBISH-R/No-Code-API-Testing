import { useMemo, useRef, useState } from 'react';
import CollectionGroup from './CollectionGroup.jsx';
import Icon from '../common/Icon.jsx';
import { filterCollections } from '../../utils/filterCollections.js';
import './collections.css';

export default function CollectionsPanel({
  collectionsState,
  selectedRequestId,
  onSelectRequest,
  onRun,
  runningCollectionId,
  importExportState,
  readOnly = false,
  onCopy,
}) {
  const { collections, status, error, createCollection } = collectionsState;
  const [newName, setNewName] = useState('');
  const [query, setQuery] = useState('');
  const isFiltering = query.trim() !== '';
  const visible = useMemo(() => filterCollections(collections, query), [collections, query]);
  const totalsById = useMemo(
    () => new Map(collections.map((c) => [c._id, c.requests.length])),
    [collections],
  );
  const fileInputRef = useRef(null);

  const handleCreate = async (e) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    await createCollection(trimmed);
    setNewName('');
  };

  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0];
    // Reset first so choosing the same file twice in a row still fires a change event.
    e.target.value = '';
    if (file) await importExportState.importCollection(file);
  };

  return (
    <div className="collections-panel">
      {collections.length > 0 && (
        <div className="collections-panel__search">
          <Icon name="search" size={13} />
          <input
            type="search"
            placeholder="Search collections"
            aria-label="Search collections and requests"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          />
        </div>
      )}

      {/* A viewer cannot add to a team workspace; the server refuses it regardless. */}
      {!readOnly && (
      <>
      <form className="collections-panel__new-form" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="New collection name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" disabled={!newName.trim()} aria-label="Create collection">
          +
        </button>
      </form>

      <button
        className="collections-panel__import"
        onClick={() => fileInputRef.current?.click()}
        disabled={importExportState.busy}
        title="Import an exported collection, or an OpenAPI/Swagger spec (JSON or YAML)"
      >
        {importExportState.busy ? 'Working…' : 'Import collection'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json,.yaml,.yml,application/yaml,text/yaml"
        onChange={handleFileChosen}
        hidden
      />
      </>
      )}

      {importExportState.error && (
        <p className="collections-panel__hint collections-panel__hint--error">
          {importExportState.error}
        </p>
      )}
      {importExportState.notice && (
        <p className="collections-panel__hint collections-panel__hint--ok">
          {importExportState.notice}
        </p>
      )}

      {status === 'loading' && <p className="collections-panel__hint">Loading collections…</p>}
      {status === 'error' && (
        <p className="collections-panel__hint collections-panel__hint--error">{error}</p>
      )}
      {status === 'ready' && collections.length === 0 && (
        <p className="collections-panel__hint">No collections yet. Create one to start saving requests.</p>
      )}

      {isFiltering && visible.length === 0 && (
        <p className="collections-panel__hint">No requests match “{query.trim()}”.</p>
      )}

      <div className="collections-panel__list">
        {visible.map((collection) => (
          <CollectionGroup
            key={collection._id}
            collection={collection}
            totalRequests={totalsById.get(collection._id) ?? collection.requests.length}
            forceExpanded={isFiltering}
            selectedRequestId={selectedRequestId}
            onSelectRequest={onSelectRequest}
            collectionsState={collectionsState}
            onRun={onRun}
            isRunning={runningCollectionId === collection._id}
            onExport={importExportState.exportCollection}
            isExporting={importExportState.busy}
            onCopy={onCopy}
          />
        ))}
      </div>
    </div>
  );
}
