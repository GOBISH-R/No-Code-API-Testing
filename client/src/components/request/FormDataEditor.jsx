import { useRef, useState } from 'react';
import Icon from '../common/Icon.jsx';
import { formatBytes } from '../../utils/format.js';

/** Must match the server's FORM_LIMITS.MAX_FILE_BYTES. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

// Reads a picked file as base64 — the form it travels in to the server.
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function FileCell({ row, onPick, onClear }) {
  const input = useRef(null);
  const missing = row.fileName && typeof row.data !== 'string';

  return (
    <div className={`form-data__file ${missing ? 'form-data__file--missing' : ''}`}>
      <input ref={input} type="file" hidden onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // so picking the same file again still fires
        if (file) onPick(file);
      }} />
      <button type="button" className="form-data__pick" onClick={() => input.current?.click()}>
        {row.fileName ? 'Change' : 'Choose file'}
      </button>
      {row.fileName ? (
        <span className="form-data__file-name" title={row.fileName}>
          {row.fileName}
          <span className="form-data__file-meta">
            {missing ? ' — choose it again to send' : ` · ${formatBytes(row.fileSize)}`}
          </span>
        </span>
      ) : (
        <span className="form-data__file-meta">No file chosen</span>
      )}
      {row.fileName && (
        <button type="button" className="form-data__clear" onClick={onClear} aria-label="Remove file" title="Remove file">
          <Icon name="close" size={11} />
        </button>
      )}
    </div>
  );
}

/**
 * multipart/form-data fields: each one text or a file, like Postman's form-data tab.
 * Files are read in the browser and sent with each request; they are not saved with it.
 */
export default function FormDataEditor({ rows, handlers }) {
  const [error, setError] = useState(null);

  const pick = async (row, file) => {
    setError(null);
    const others = rows.reduce((sum, r) => sum + (r.id !== row.id && typeof r.data === 'string' ? r.fileSize : 0), 0);
    if (others + file.size > MAX_FILE_BYTES) {
      setError(`Files in one request can add up to ${formatBytes(MAX_FILE_BYTES)} — ${file.name} is ${formatBytes(file.size)}.`);
      return;
    }
    try {
      const data = await readAsBase64(file);
      handlers.updateRow(row.id, {
        data,
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        // A field named after the file saves a step for the common one-file upload.
        ...(row.key.trim() ? {} : { key: 'file' }),
      });
    } catch {
      setError(`${file.name} could not be read.`);
    }
  };

  return (
    <div className="form-data">
      <div className="form-data__row form-data__row--head">
        <span />
        <span>Key</span>
        <span>Type</span>
        <span>Value</span>
        <span />
      </div>
      {rows.map((row) => (
        <div key={row.id} className="form-data__row">
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => handlers.updateRow(row.id, { enabled: e.target.checked })}
            title={row.enabled ? 'Enabled' : 'Disabled'}
          />
          <input
            type="text"
            placeholder="key"
            value={row.key}
            aria-label="Field name"
            onChange={(e) => handlers.updateRow(row.id, { key: e.target.value })}
          />
          <select
            value={row.type}
            aria-label="Field type"
            // Back to text: the picked file is dropped, so it is not sent with every request.
            onChange={(e) =>
              handlers.updateRow(
                row.id,
                e.target.value === 'text'
                  ? { type: 'text', data: undefined, fileName: '', fileType: '', fileSize: 0 }
                  : { type: 'file' },
              )
            }
          >
            <option value="text">Text</option>
            <option value="file">File</option>
          </select>
          {row.type === 'file' ? (
            <FileCell
              row={row}
              onPick={(file) => pick(row, file)}
              onClear={() => handlers.updateRow(row.id, { data: undefined, fileName: '', fileType: '', fileSize: 0 })}
            />
          ) : (
            <input
              type="text"
              placeholder="value"
              value={row.value}
              aria-label="Field value"
              onChange={(e) => handlers.updateRow(row.id, { value: e.target.value })}
            />
          )}
          <button
            type="button"
            className="kv-editor__remove"
            onClick={() => handlers.removeRow(row.id)}
            aria-label="Remove field"
            disabled={rows.length === 1}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      {error && <p className="body-editor__error">{error}</p>}
      <button type="button" className="kv-editor__add" onClick={handlers.addRow}>+ Add Field</button>
      <p className="form-data__note">
        Files are sent with the request but not saved with it — after reopening a saved request, choose them again.
        Up to {formatBytes(MAX_FILE_BYTES)} of files per request.
      </p>
    </div>
  );
}
