import KeyValueEditor from '../common/KeyValueEditor.jsx';

export default function HeadersEditor({ headers }) {
  return (
    <KeyValueEditor
      rows={headers.rows}
      onAddRow={headers.addRow}
      onUpdateRow={headers.updateRow}
      onRemoveRow={headers.removeRow}
      addLabel="Add Header"
    />
  );
}
