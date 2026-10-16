import { useState } from 'react';
import { isValidJson, formatJson, describePlaceholders } from '../../utils/wsMessage.js';
import './websocket.css';

const MODES = [
  { value: 'text', label: 'Text' },
  { value: 'json', label: 'JSON' },
];

/**
 * Composes an outgoing WebSocket message.
 *
 * Unlike an HTTP body this is sent repeatedly over a live connection, so the draft
 * survives sending and recent messages are kept for one-click resending — the common
 * rhythm of WebSocket testing is "send, watch, tweak, send again".
 */
export default function MessageComposer({ onSend, disabled, runtimeVariables = {}, history = [] }) {
  const [mode, setMode] = useState('text');
  const [draft, setDraft] = useState('');

  const jsonIsValid = mode !== 'json' || isValidJson(draft);
  const placeholders = describePlaceholders(draft, runtimeVariables);
  const canSend = !disabled && draft.trim().length > 0 && jsonIsValid;

  const handleSend = () => {
    if (!canSend) return;
    onSend(draft);
    // The draft is deliberately kept — resending the same frame is common.
  };

  return (
    <div className="ws-composer">
      <div className="ws-composer__toolbar">
        {MODES.map((m) => (
          <label key={m.value} className="ws-composer__mode">
            <input
              type="radio"
              name="ws-message-mode"
              value={m.value}
              checked={mode === m.value}
              onChange={() => setMode(m.value)}
            />
            {m.label}
          </label>
        ))}

        {mode === 'json' && (
          <button
            type="button"
            className="ws-composer__format"
            onClick={() => setDraft(formatJson(draft))}
            disabled={!draft.trim()}
          >
            Format
          </button>
        )}

        <span className="ws-composer__spacer" />

        <button type="button" className="ws-composer__clear" onClick={() => setDraft('')} disabled={!draft}>
          Clear
        </button>
      </div>

      <textarea
        className={`ws-composer__input ${jsonIsValid ? '' : 'ws-composer__input--invalid'}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={mode === 'json' ? '{\n  "action": "subscribe"\n}' : 'Message to send…'}
        spellCheck={false}
        rows={5}
      />

      {!jsonIsValid && <p className="ws-composer__error">Invalid JSON</p>}

      {placeholders.length > 0 && (
        <div className="ws-composer__placeholders">
          {placeholders.map((p) => (
            <span
              key={p.name}
              className={`ws-placeholder ${p.known ? 'ws-placeholder--known' : ''}`}
              title={p.known ? `Runtime value: ${p.value}` : 'Resolved on the server when sent'}
            >
              {`{{${p.name}}}`}
              {p.known ? ` → ${p.value}` : ''}
            </span>
          ))}
        </div>
      )}

      <div className="ws-composer__actions">
        <button type="button" className="ws-composer__send" onClick={handleSend} disabled={!canSend}>
          Send Message
        </button>
        {disabled && <span className="ws-composer__hint">Connect first to send messages.</span>}
      </div>

      {history.length > 0 && (
        <div className="ws-composer__history">
          <span className="ws-composer__history-title">Recent</span>
          {history.map((item, index) => (
            <button
              key={`${index}-${item.slice(0, 12)}`}
              type="button"
              className="ws-composer__history-item"
              onClick={() => setDraft(item)}
              title="Load this message back into the composer"
            >
              {item.length > 60 ? `${item.slice(0, 60)}…` : item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
