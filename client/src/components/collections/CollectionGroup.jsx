import { useMemo, useState } from 'react';
import Icon from '../common/Icon.jsx';
import RequestListItem from './RequestListItem.jsx';
import FolderNode from './FolderNode.jsx';

// Flat folder list -> "Parent/Child" labels for the move dropdown, matching how the
// export format names folders so the two read the same way.
function buildFolderOptions(folders) {
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

export default function CollectionGroup({
  collection,
  // The unfiltered count: a search narrows what is listed, not what a run would execute.
  totalRequests = collection.requests.length,
  // While searching, every level is open so each match is visible where it lives.
  forceExpanded = false,
  selectedRequestId,
  onSelectRequest,
  collectionsState,
  onRun,
  isRunning,
  onExport,
  isExporting,
  onCopy,
}) {
  const [expandedState, setExpanded] = useState(true);
  const expanded = forceExpanded || expandedState;
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(collection.name);

  const folders = useMemo(() => collection.folders || [], [collection.folders]);
  const folderOptions = useMemo(() => buildFolderOptions(folders), [folders]);

  const childFoldersOf = (parentId) =>
    folders.filter((f) => String(f.parentId || '') === String(parentId || ''));

  // A request whose folder was deleted out from under it would otherwise vanish from
  // the sidebar; treating an unknown folderId as "root" keeps it reachable.
  const knownFolderIds = useMemo(() => new Set(folders.map((f) => String(f._id))), [folders]);
  const requestsIn = (folderId) =>
    collection.requests.filter((r) => {
      const id = r.folderId ? String(r.folderId) : '';
      if (!folderId) return !id || !knownFolderIds.has(id);
      return id === String(folderId);
    });

  const handleAddFolder = async () => {
    const name = window.prompt(`New folder in "${collection.name}"`);
    if (name?.trim()) {
      await collectionsState.createFolder({
        collectionId: collection._id,
        parentId: null,
        name: name.trim(),
      });
    }
  };

  const handleRename = async () => {
    setRenaming(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== collection.name) {
      await collectionsState.renameCollection(collection._id, trimmed);
    } else {
      setNameDraft(collection.name);
    }
  };

  const handleDeleteCollection = async () => {
    if (window.confirm(`Delete collection "${collection.name}" and all its requests?`)) {
      await collectionsState.deleteCollection(collection._id);
    }
  };

  const handleDeleteRequest = async (requestId) => {
    if (window.confirm('Delete this request?')) {
      await collectionsState.deleteRequest(requestId);
      if (selectedRequestId === requestId) onSelectRequest(null);
    }
  };

  return (
    <div className="collection-group">
      <div className="collection-group__header">
        <button
          className="collection-group__toggle"
          onClick={() => setExpanded((e) => !e)}
          disabled={forceExpanded}
          aria-label={expanded ? 'Collapse collection' : 'Expand collection'}
        >
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={12} />
        </button>

        {renaming ? (
          <input
            className="collection-group__rename-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            autoFocus
          />
        ) : (
          <span className="collection-group__name" onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
            {collection.name}
          </span>
        )}

        <span className="collection-group__count">{totalRequests}</span>
        <button
          className="collection-group__add-folder"
          onClick={handleAddFolder}
          title="Add a folder to this collection"
          aria-label="Add folder"
        >
          <Icon name="plus" size={13} />
        </button>
        <button
          className="collection-group__run"
          onClick={() => onRun(collection._id)}
          disabled={isRunning || totalRequests === 0}
          title={totalRequests === 0 ? 'Add requests to this collection first' : 'Run this collection'}
          aria-label="Run collection"
        >
          {isRunning ? <span className="collection-group__spinner" /> : <Icon name="play" size={12} />}
        </button>
        <button
          className="collection-group__export"
          onClick={() => onExport(collection._id, collection.name)}
          disabled={isExporting}
          title="Export this collection as a JSON file"
          aria-label="Export collection"
        >
          <Icon name="download" size={13} />
        </button>
        {onCopy && (
          <button
            className="collection-group__copy"
            onClick={() => onCopy(collection)}
            title="Copy or move to another workspace"
            aria-label="Copy or move collection"
          >
            <Icon name="copy" size={13} />
          </button>
        )}
        <button className="collection-group__delete" onClick={handleDeleteCollection} aria-label="Delete collection">
          <Icon name="close" size={12} />
        </button>
      </div>

      {expanded && (
        <div className="collection-group__requests">
          {collection.requests.length === 0 && folders.length === 0 && (
            <p className="collection-group__empty">No requests saved yet.</p>
          )}

          {/* Folders first, then the collection's own root-level requests. */}
          {childFoldersOf(null).map((folder) => (
            <FolderNode
              key={folder._id}
              folder={folder}
              depth={0}
              forceExpanded={forceExpanded}
              childFoldersOf={childFoldersOf}
              requestsIn={requestsIn}
              folderOptions={folderOptions}
              selectedRequestId={selectedRequestId}
              onSelectRequest={onSelectRequest}
              collectionsState={collectionsState}
              onDeleteRequest={handleDeleteRequest}
            />
          ))}

          {requestsIn(null).map((request) => (
            <RequestListItem
              key={request._id}
              request={request}
              isSelected={selectedRequestId === request._id}
              onSelect={() => onSelectRequest(request)}
              onDelete={() => handleDeleteRequest(request._id)}
              folderOptions={folderOptions}
              onMove={(folderId) => collectionsState.moveRequest(request, folderId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
