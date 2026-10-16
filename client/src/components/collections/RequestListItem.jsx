import Icon from '../common/Icon.jsx';
export default function RequestListItem({
  request,
  isSelected,
  onSelect,
  onDelete,
  depth = 0,
  folderOptions = [],
  onMove,
}) {
  return (
    <div
      className={`request-list-item ${isSelected ? 'request-list-item--selected' : ''}`}
      style={{ '--folder-depth': depth }}
    >
      <button className="request-list-item__select" onClick={onSelect}>
        {/* A WebSocket request has no HTTP method, so its protocol is the badge. */}
        <span className={`method-tag method-tag--${(request.method || request.protocol || 'ws').toLowerCase()}`}>
          {request.method || (request.protocol === 'websocket' ? 'WS' : request.protocol)}
        </span>
        <span className="request-list-item__name">{request.name}</span>
      </button>

      {/* Only worth showing once the collection actually has folders to move between. */}
      {onMove && folderOptions.length > 0 && (
        <select
          className="request-list-item__move"
          value={request.folderId || ''}
          onChange={(e) => onMove(e.target.value)}
          title="Move to folder"
          aria-label="Move to folder"
        >
          <option value="">(root)</option>
          {folderOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.path}
            </option>
          ))}
        </select>
      )}

      <button className="request-list-item__delete" onClick={onDelete} aria-label="Delete request">
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
