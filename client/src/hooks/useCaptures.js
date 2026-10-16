import { useState } from 'react';
import { createId } from '../utils/id.js';

export const CAPTURE_SOURCES = [
  { value: 'json', label: 'JSON Path' },
  { value: 'header', label: 'Header' },
  { value: 'status', label: 'Status Code' },
  { value: 'time', label: 'Response Time' },
];

function emptyCapture() {
  return { id: createId(), source: 'json', path: '', headerName: '', variableName: '' };
}

// Manages the visual "Capture" rule list — extract a value from this request's own
// response and store it as {{variableName}} in the runtime context, for later requests
// in a manual chain to reuse.
export function useCaptures() {
  const [rows, setRows] = useState([]);

  const addRow = () => setRows((r) => [...r, emptyCapture()]);

  const updateRow = (id, patch) =>
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const removeRow = (id) => setRows((r) => r.filter((row) => row.id !== id));

  const loadRows = (savedCaptures) =>
    setRows(
      (savedCaptures || []).map((c) => ({
        id: createId(),
        source: c.source || 'json',
        path: c.path || '',
        headerName: c.headerName || '',
        variableName: c.variableName || '',
      })),
    );

  const reset = () => setRows([]);

  return { rows, addRow, updateRow, removeRow, loadRows, reset };
}
