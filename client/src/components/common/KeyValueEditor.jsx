import './key-value-editor.css';
import Icon from './Icon.jsx';

// Shared enabled/key/value row editor — used for request params, request headers,
// and environment variables.
export default function KeyValueEditor({
  rows,
  onAddRow,
  onUpdateRow,
  onRemoveRow,
  addLabel,
  keyPlaceholder = 'key',
  valuePlaceholder = 'value',
  keyLabel = 'Key',
  valueLabel = 'Value',
  allowEmpty = false,
}) {
  return (
    <div className="kv-editor">
      {rows.length > 0 && (
        <div className="kv-editor__header">
          <span />
          <span>{keyLabel}</span>
          <span>{valueLabel}</span>
          <span />
        </div>
      )}
      {rows.map((row) => (
        <div className="kv-editor__row" key={row.id}>
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => onUpdateRow(row.id, { enabled: e.target.checked })}
            title={row.enabled ? 'Enabled' : 'Disabled'}
          />
          <input
            type="text"
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(e) => onUpdateRow(row.id, { key: e.target.value })}
          />
          <input
            type="text"
            placeholder={valuePlaceholder}
            value={row.value}
            onChange={(e) => onUpdateRow(row.id, { value: e.target.value })}
          />
          <button
            className="kv-editor__remove"
            onClick={() => onRemoveRow(row.id)}
            aria-label="Remove row"
            disabled={!allowEmpty && rows.length === 1}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      <button className="kv-editor__add" onClick={onAddRow}>
        + {addLabel}
      </button>
    </div>
  );
}
