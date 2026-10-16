import { useState } from 'react';
import Icon from '../common/Icon.jsx';
import './runtime-context.css';

// {{name}} bodies the resolver will actually substitute — matches the backend's
// VARIABLE_PATTERN, kept in sync manually since frontend/backend don't share code.
const VALID_NAME = /^[\w.-]+$/;

function AddVariableRow({ onAdd }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!VALID_NAME.test(trimmed)) {
      setError('Only letters, numbers, ".", "_", "-" are allowed.');
      return;
    }
    onAdd(trimmed, value);
    setName('');
    setValue('');
    setError(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') submit();
  };

  return (
    <div className="runtime-panel__add">
      <div className="runtime-panel__add-row">
        <input
          type="text"
          placeholder="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <input
          type="text"
          placeholder="value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button onClick={submit} disabled={!name.trim()} aria-label="Add variable">
          +
        </button>
      </div>
      {error && <p className="runtime-panel__add-error">{error}</p>}
    </div>
  );
}

function VariableValue({ name, value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <span
        className="runtime-panel__value"
        title={`${value} — click to edit`}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {value}
      </span>
    );
  }

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft);
  };

  return (
    <input
      className="runtime-panel__value-input"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      aria-label={`Edit ${name}`}
    />
  );
}

export default function RuntimeContextPanel({ runtimeContext }) {
  const { variables, meta, setVariable, removeVariable, clear } = runtimeContext;
  const entries = Object.entries(variables);

  return (
    <div className="runtime-panel">
      <div className="runtime-panel__header">
        <h2>Runtime Variables</h2>
        {entries.length > 0 && (
          <button className="runtime-panel__clear" onClick={clear}>
            Clear
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="runtime-panel__hint">
          Values captured from a response (via the Capture tab), or set manually below, appear
          here and can be used in later requests as <code>{'{{name}}'}</code>.
        </p>
      ) : (
        <ul className="runtime-panel__list">
          {entries.map(([name, value]) => (
            <li key={name} className="runtime-panel__item">
              <div className="runtime-panel__row">
                <code className="runtime-panel__name">{`{{${name}}}`}</code>
                <VariableValue name={name} value={value} onChange={(v) => setVariable(name, v)} />
                <button
                  className="runtime-panel__remove"
                  onClick={() => removeVariable(name)}
                  aria-label={`Remove ${name}`}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
              {meta[name] && <p className="runtime-panel__source">{meta[name].label}</p>}
            </li>
          ))}
        </ul>
      )}

      <AddVariableRow onAdd={setVariable} />
    </div>
  );
}
