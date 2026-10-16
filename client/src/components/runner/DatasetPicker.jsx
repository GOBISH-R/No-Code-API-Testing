import { useRef, useState } from 'react';
import { parseDataset, datasetColumns, LIMITS } from '../../utils/dataset.js';

const PREVIEW_ROWS = 3;

/**
 * Chooses a CSV or JSON file and turns it into iteration rows.
 *
 * The file is read and parsed here rather than uploaded, so the preview below shows
 * exactly what the run will use — a mis-parsed column is visible before anything
 * executes, not afterwards in a wall of failed assertions.
 */
export default function DatasetPicker({ dataset, onChange }) {
  const inputRef = useRef(null);
  const [errors, setErrors] = useState([]);
  const [filename, setFilename] = useState('');

  const clear = () => {
    setErrors([]);
    setFilename('');
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFilename(file.name);

    if (file.size > LIMITS.MAX_FILE_BYTES) {
      setErrors([`That file is ${Math.round(file.size / 1024)}KB; the limit is ${LIMITS.MAX_FILE_BYTES / 1024}KB.`]);
      onChange(null);
      return;
    }

    let text;
    try {
      text = await file.text();
    } catch {
      setErrors(['That file could not be read.']);
      onChange(null);
      return;
    }

    const { rows, errors: parseErrors, format } = parseDataset(text, file.name);
    setErrors(parseErrors);
    onChange(rows.length > 0 ? { rows, filename: file.name, format } : null);
  };

  const columns = dataset ? datasetColumns(dataset.rows) : [];

  return (
    <div className="dataset-picker">
      <div className="dataset-picker__controls">
        <label className="dataset-picker__button">
          Choose data file…
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.json,.txt,text/csv,application/json"
            onChange={handleFile}
          />
        </label>
        {filename && (
          <>
            <span className="dataset-picker__filename">{filename}</span>
            <button type="button" className="dataset-picker__clear" onClick={clear}>
              Remove
            </button>
          </>
        )}
      </div>

      <p className="dataset-picker__hint">
        A CSV with a header row, or a JSON array of objects. Each row runs the whole
        collection once, with its columns available as <code>{'{{variables}}'}</code> —
        they override environment values, and captures still take precedence over both.
      </p>

      {errors.length > 0 && (
        <ul className="dataset-picker__errors">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {dataset && (
        <div className="dataset-picker__preview">
          <p className="dataset-picker__summary">
            <strong>{dataset.rows.length}</strong> iteration{dataset.rows.length === 1 ? '' : 's'} ·{' '}
            {columns.length} variable{columns.length === 1 ? '' : 's'}
          </p>
          <table className="dataset-preview">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{`{{${column}}}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataset.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column}>{row[column] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {dataset.rows.length > PREVIEW_ROWS && (
            <p className="dataset-picker__more">
              …and {dataset.rows.length - PREVIEW_ROWS} more row
              {dataset.rows.length - PREVIEW_ROWS === 1 ? '' : 's'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
