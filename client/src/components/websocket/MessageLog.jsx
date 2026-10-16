import { useMemo, useState } from 'react';
import { formatBytes } from '../../utils/format.js';
import { displayPayload, formatMessageTime, messageDirectionLabel } from '../../utils/wsMessage.js';
import './websocket.css';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'sent', label: 'Sent' },
  { value: 'received', label: 'Received' },
  { value: 'system', label: 'System' },
];

/**
 * The conversation log.
 *
 * One ordered list rather than request/response pairs, because a WebSocket exchange
 * genuinely is a stream: a send may produce no replies or many, and the server may
 * speak first.
 */
export default function MessageLog({ messages = [], onClear }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return messages.filter((m) => {
      if (filter !== 'all' && m.direction !== filter) return false;
      if (!needle) return true;
      return (m.payload || '').toLowerCase().includes(needle);
    });
  }, [messages, filter, search]);

  const counts = useMemo(
    () => ({
      sent: messages.filter((m) => m.direction === 'sent').length,
      received: messages.filter((m) => m.direction === 'received').length,
    }),
    [messages],
  );

  return (
    <div className="ws-log">
      <div className="ws-log__toolbar">
        <div className="ws-log__filters">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`ws-log__filter ${filter === f.value ? 'ws-log__filter--active' : ''}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <input
          className="ws-log__search"
          type="search"
          placeholder="Search messages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <span className="ws-log__counts">
          ↑ {counts.sent} · ↓ {counts.received}
        </span>

        {onClear && messages.length > 0 && (
          <button type="button" className="ws-log__clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      {messages.length === 0 && (
        <p className="ws-log__empty">No messages yet. Connect and send one to see the exchange here.</p>
      )}

      {messages.length > 0 && visible.length === 0 && (
        <p className="ws-log__empty">No messages match this filter.</p>
      )}

      <div className="ws-log__items">
        {visible.map((message) => (
          <div key={message.id} className={`ws-message ws-message--${message.direction}`}>
            <div className="ws-message__meta">
              <span className="ws-message__direction">{messageDirectionLabel(message.direction)}</span>
              <span className="ws-message__time">{formatMessageTime(message.timestamp)}</span>
              <span className="ws-message__type">{message.type}</span>
              <span className="ws-message__size">{formatBytes(message.size)}</span>
            </div>
            <pre className="ws-message__payload">{displayPayload(message)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
