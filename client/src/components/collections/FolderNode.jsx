import { useState } from 'react';
import Icon from '../common/Icon.jsx';
import RequestListItem from './RequestListItem.jsx';

// One folder and everything beneath it. Renders itself recursively for child folders,
// so arbitrary nesting needs no special handling here — the depth ceiling is enforced
// server-side when a folder is created.
export default function FolderNode({
  folder,
  depth,
  forceExpanded = false,
  childFoldersOf,
  requestsIn,
  folderOptions,
  selectedRequestId,
  onSelectRequest,
  collectionsState,
  onDeleteRequest,
}) {
  const [expandedState, setExpanded] = useState(true);
  const expanded = forceExpanded || expandedState;
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(folder.name);

  const children = childFoldersOf(folder._id);
  const requests = requestsIn(folder._id);
  const isEmpty = children.length === 0 && requests.length === 0;

  const handleRename = async () => {
    setRenaming(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== folder.name) {
      await collectionsState.renameFolder(folder._id, trimmed);
    } else {
      setNameDraft(folder.name);
    }
  };

  const handleAddSubfolder = async () => {
    const name = window.prompt(`New folder inside "${folder.name}"`);
    if (name?.trim()) {
      await collectionsState.createFolder({
        collectionId: folder.collectionId,
        parentId: folder._id,
        name: name.trim(),
      });
    }
  };

  const handleDelete = async () => {
    if (
      window.confirm(
        `Delete folder "${folder.name}", everything inside it, and all requests it contains?`,
      )
    ) {
      await collectionsState.deleteFolder(folder._id);
    }
  };

  return (
    <div className="folder-node" style={{ '--folder-depth': depth }}>
      <div className="folder-node__header">
        <button
          className="folder-node__toggle"
          onClick={() => setExpanded((e) => !e)}
          disabled={forceExpanded}
          aria-label={expanded ? 'Collapse folder' : 'Expand folder'}
        >
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={12} />
        </button>

        <span className="folder-node__icon" aria-hidden="true">
          <Icon name="folder" size={13} />
        </span>

        {renaming ? (
          <input
            className="folder-node__rename-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            autoFocus
          />
        ) : (
          <span
            className="folder-node__name"
            onDoubleClick={() => setRenaming(true)}
            title="Double-click to rename"
          >
            {folder.name}
          </span>
        )}

        <button
          className="folder-node__add"
          onClick={handleAddSubfolder}
          title="Add a subfolder"
          aria-label="Add subfolder"
        >
          <Icon name="plus" size={13} />
        </button>
        <button
          className="folder-node__delete"
          onClick={handleDelete}
          title="Delete this folder and its contents"
          aria-label="Delete folder"
        >
          <Icon name="close" size={12} />
        </button>
      </div>

      {expanded && (
        <div className="folder-node__children">
          {children.map((child) => (
            <FolderNode
              key={child._id}
              folder={child}
              depth={depth + 1}
              forceExpanded={forceExpanded}
              childFoldersOf={childFoldersOf}
              requestsIn={requestsIn}
              folderOptions={folderOptions}
              selectedRequestId={selectedRequestId}
              onSelectRequest={onSelectRequest}
              collectionsState={collectionsState}
              onDeleteRequest={onDeleteRequest}
            />
          ))}

          {requests.map((request) => (
            <RequestListItem
              key={request._id}
              request={request}
              depth={depth + 1}
              isSelected={selectedRequestId === request._id}
              onSelect={() => onSelectRequest(request)}
              onDelete={() => onDeleteRequest(request._id)}
              folderOptions={folderOptions}
              onMove={(folderId) => collectionsState.moveRequest(request, folderId)}
            />
          ))}

          {isEmpty && <p className="folder-node__empty">Empty folder.</p>}
        </div>
      )}
    </div>
  );
}
