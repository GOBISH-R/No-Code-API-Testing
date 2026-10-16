import KeyValueEditor from '../common/KeyValueEditor.jsx';
import FormDataEditor from './FormDataEditor.jsx';
import '../common/key-value-editor.css';

const MODES = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'formdata', label: 'Form Data' },
  { value: 'urlencoded', label: 'Form URL-Encoded' },
  { value: 'text', label: 'Raw Text' },
];

const CONTENT_TYPES = {
  json: 'application/json',
  urlencoded: 'application/x-www-form-urlencoded',
  text: 'text/plain',
  formdata: 'multipart/form-data',
};

function isValidJson(text) {
  if (!text.trim()) return true;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export default function BodyEditor({ body }) {
  const { mode, raw, rows, form } = body.value;
  const jsonIsValid = mode !== 'json' || isValidJson(raw);

  return (
    <div className="body-editor">
      <div className="body-editor__modes">
        {MODES.map((m) => (
          <label key={m.value} className="body-editor__mode">
            <input
              type="radio"
              name="body-mode"
              value={m.value}
              checked={mode === m.value}
              onChange={() => body.setMode(m.value)}
            />
            {m.label}
          </label>
        ))}
      </div>

      {CONTENT_TYPES[mode] && (
        <p className="body-editor__content-type">
          Sent as <code>{CONTENT_TYPES[mode]}</code> unless you set your own Content-Type header.
        </p>
      )}

      {mode === 'json' && (
        <>
          <textarea
            className={`body-editor__textarea ${jsonIsValid ? '' : 'body-editor__textarea--invalid'}`}
            placeholder={'{\n  "key": "value"\n}'}
            value={raw}
            onChange={(e) => body.setRaw(e.target.value)}
            spellCheck={false}
            rows={10}
          />
          {!jsonIsValid && <p className="body-editor__error">Invalid JSON</p>}
        </>
      )}

      {mode === 'urlencoded' && (
        <KeyValueEditor
          rows={rows}
          onAddRow={body.rows.addRow}
          onUpdateRow={body.rows.updateRow}
          onRemoveRow={body.rows.removeRow}
          addLabel="Add Field"
          keyPlaceholder="field"
          valuePlaceholder="value"
          keyLabel="Field"
        />
      )}

      {mode === 'formdata' && <FormDataEditor rows={form} handlers={body.form} />}

      {mode === 'text' && (
        <textarea
          className="body-editor__textarea"
          placeholder="Any raw text — XML, CSV, a plain string…"
          value={raw}
          onChange={(e) => body.setRaw(e.target.value)}
          spellCheck={false}
          rows={10}
        />
      )}

      {mode === 'none' && <p className="body-editor__empty">This request has no body.</p>}
    </div>
  );
}
