import { CAPTURE_SOURCES } from '../../hooks/useCaptures.js';
import Icon from '../common/Icon.jsx';

export default function CaptureRow({ capture, onUpdate, onRemove }) {
  return (
    <div className="capture-row">
      <select
        className="capture-row__source"
        value={capture.source}
        onChange={(e) => onUpdate(capture.id, { source: e.target.value })}
      >
        {CAPTURE_SOURCES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      {capture.source === 'json' && (
        <input
          type="text"
          className="capture-row__path"
          placeholder="$.token"
          value={capture.path}
          onChange={(e) => onUpdate(capture.id, { path: e.target.value })}
        />
      )}

      {capture.source === 'header' && (
        <input
          type="text"
          className="capture-row__path"
          placeholder="Set-Cookie"
          value={capture.headerName}
          onChange={(e) => onUpdate(capture.id, { headerName: e.target.value })}
        />
      )}

      <span className="capture-row__as">as</span>

      <input
        type="text"
        className="capture-row__variable"
        placeholder="token"
        value={capture.variableName}
        onChange={(e) => onUpdate(capture.id, { variableName: e.target.value })}
      />

      <button
        className="capture-row__remove"
        onClick={() => onRemove(capture.id)}
        aria-label="Remove capture"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
