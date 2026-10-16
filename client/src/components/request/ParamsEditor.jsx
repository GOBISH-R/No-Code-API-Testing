import KeyValueEditor from '../common/KeyValueEditor.jsx';

export default function ParamsEditor({ params }) {
  return (
    <KeyValueEditor
      rows={params.rows}
      onAddRow={params.addRow}
      onUpdateRow={params.updateRow}
      onRemoveRow={params.removeRow}
      addLabel="Add Param"
    />
  );
}
