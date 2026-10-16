import { useMemo, useState } from 'react';
import Icon from '../common/Icon.jsx';
import { displayUrl, filterHistory, groupByDay } from '../../utils/historyGroups.js';
import { formatTimestamp, statusClass } from '../../utils/format.js';
import './history.css';

// The sidebar is narrow, and "https://" is the same on nearly every row — dropping it
// leaves room for the host and path that actually tell entries apart. The tooltip keeps
// the full URL.
function shortUrl(url) {
  return url.replace(/^https?:\/\//i, '');
}

/**
 * Every request sent by hand from the builder, grouped by day — Postman's History tab.
 * Clicking one reopens it in the builder as a new, unsaved request.
 */
export default function HistoryPanel({ historyState, activeId, onOpen }) {
  const { entries, status, remove, clear, refresh } = historyState;
  const [query, setQuery] = useState('');
  const [openError, setOpenError] = useState(null);
  const groups = useMemo(() => groupByDay(filterHistory(entries, query)), [entries, query]);

  const handleOpen = async (id) => {
    setOpenError(null);
    try {
      await onOpen(id);
    } catch (err) {
      // Most likely removed in another tab; the refresh drops it from the list.
      setOpenError(err.response?.data?.message || 'That request could not be opened.');
      refresh();
    }
  };

  const handleClear = () => {
    if (window.confirm('Clear your whole request history? This cannot be undone.')) clear();
  };

  if (status === 'error') {
    return <p className="history-panel__empty">History needs a database connection.</p>;
  }
  if (status === 'loading') {
    return <p className="history-panel__empty">Loading history…</p>;
  }
  if (entries.length === 0) {
    return (
      <p className="history-panel__empty">
        Requests you send appear here, so you can open any of them again.
      </p>
    );
  }

  return (
    <div className="history-panel">
      <div className="history-panel__bar">
        <div className="collections-panel__search history-panel__search">
          <Icon name="search" size={13} />
          <input
            type="search"
            placeholder="Filter by URL or method"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter history"
          />
        </div>
        <button type="button" className="history-panel__clear" onClick={handleClear} title="Clear all history">
          Clear all
        </button>
      </div>

      {openError && <p className="sidebar__error">{openError}</p>}

      {groups.length === 0 && <p className="history-panel__empty">No requests match “{query}”.</p>}

      {groups.map((group) => (
        <section key={group.label} className="history-group">
          <h3 className="history-group__label">{group.label}</h3>
          {group.entries.map((entry) => (
            <div
              key={entry._id}
              className={`history-item ${activeId === entry._id ? 'history-item--active' : ''}`}
            >
              <button
                type="button"
                className="history-item__open"
                onClick={() => handleOpen(entry._id)}
                title={`${entry.method} ${displayUrl(entry)}\n${formatTimestamp(entry.createdAt)}`}
              >
                <span className={`method-tag method-tag--${entry.method.toLowerCase()}`}>{entry.method}</span>
                <span className="history-item__url">{shortUrl(displayUrl(entry))}</span>
                <span className="history-item__meta">
                  {entry.status != null ? (
                    <span className={`history-item__status ${statusClass(entry.status)}`}>{entry.status}</span>
                  ) : (
                    <span className="history-item__status status-error" title={entry.error || ''}>
                      Error
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                className="history-item__delete"
                onClick={() => remove(entry._id)}
                aria-label="Remove from history"
                title="Remove from history"
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
