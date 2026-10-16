import AssertionRow from './AssertionRow.jsx';
import './assertions.css';

export default function AssertionsEditor({ assertions }) {
  return (
    <div className="assertions-editor">
      {assertions.rows.length === 0 && (
        <p className="assertions-editor__empty">
          No assertions yet. Add one to automatically check the response when you send this request.
        </p>
      )}

      {assertions.rows.map((row) => (
        <AssertionRow
          key={row.id}
          assertion={row}
          onUpdate={assertions.updateRow}
          onRemove={assertions.removeRow}
        />
      ))}

      <button className="assertions-editor__add" onClick={assertions.addRow}>
        + Add Assertion
      </button>
    </div>
  );
}
