import CaptureRow from './CaptureRow.jsx';
import './captures.css';

export default function CapturesEditor({ captures }) {
  return (
    <div className="captures-editor">
      {captures.rows.length === 0 && (
        <p className="captures-editor__empty">
          No captures yet. Extract a value from this response and store it as a variable —
          use it in later requests as <code>{'{{name}}'}</code>.
        </p>
      )}

      {captures.rows.map((row) => (
        <CaptureRow
          key={row.id}
          capture={row}
          onUpdate={captures.updateRow}
          onRemove={captures.removeRow}
        />
      ))}

      <button className="captures-editor__add" onClick={captures.addRow}>
        + Add Capture
      </button>
    </div>
  );
}
