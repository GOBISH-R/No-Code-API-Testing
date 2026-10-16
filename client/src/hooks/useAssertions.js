import { useState } from 'react';
import { createId } from '../utils/id.js';

export const ASSERTION_SOURCES = [
  { value: 'status', label: 'Status Code' },
  { value: 'json', label: 'JSON Path' },
  { value: 'header', label: 'Header' },
  { value: 'time', label: 'Response Time' },
];

// Must stay in sync with the backend's OPERATORS_BY_SOURCE
// (server/src/validators/assertionValidator.js), which rejects any pairing not listed
// there — the dropdown must never offer something the server would refuse.
export const OPERATORS_BY_SOURCE = {
  status: [
    { value: 'equals', label: 'equals' },
    { value: 'notEquals', label: 'does not equal' },
    { value: 'greaterThan', label: 'greater than' },
    { value: 'lessThan', label: 'less than' },
    { value: 'greaterThanOrEqual', label: 'at least' },
    { value: 'lessThanOrEqual', label: 'at most' },
  ],
  json: [
    { value: 'exists', label: 'exists' },
    { value: 'notExists', label: 'does not exist' },
    { value: 'equals', label: 'equals' },
    { value: 'notEquals', label: 'does not equal' },
    { value: 'contains', label: 'contains' },
    { value: 'notContains', label: 'does not contain' },
    { value: 'startsWith', label: 'starts with' },
    { value: 'endsWith', label: 'ends with' },
    { value: 'matches', label: 'matches regex' },
    { value: 'isEmpty', label: 'is empty' },
    { value: 'isNotEmpty', label: 'is not empty' },
    { value: 'greaterThan', label: 'greater than' },
    { value: 'lessThan', label: 'less than' },
    { value: 'greaterThanOrEqual', label: 'at least' },
    { value: 'lessThanOrEqual', label: 'at most' },
  ],
  header: [
    { value: 'exists', label: 'exists' },
    { value: 'notExists', label: 'does not exist' },
    { value: 'equals', label: 'equals' },
    { value: 'notEquals', label: 'does not equal' },
    { value: 'contains', label: 'contains' },
    { value: 'notContains', label: 'does not contain' },
    { value: 'startsWith', label: 'starts with' },
    { value: 'endsWith', label: 'ends with' },
    { value: 'matches', label: 'matches regex' },
  ],
  time: [
    { value: 'lessThan', label: 'less than' },
    { value: 'greaterThan', label: 'greater than' },
    { value: 'lessThanOrEqual', label: 'at most' },
    { value: 'greaterThanOrEqual', label: 'at least' },
  ],
};

export function operatorLabel(source, operator) {
  return OPERATORS_BY_SOURCE[source]?.find((op) => op.value === operator)?.label ?? operator;
}

function emptyAssertion() {
  return {
    id: createId(),
    source: 'status',
    operator: 'equals',
    path: '',
    headerName: '',
    expected: '',
  };
}

// Manages the visual assertion list as structured data — the same shape sent to
// POST /api/requests/execute for the backend's assertion engine to evaluate.
export function useAssertions() {
  const [rows, setRows] = useState([]);

  const addRow = () => setRows((r) => [...r, emptyAssertion()]);

  const updateRow = (id, patch) =>
    setRows((r) =>
      r.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (patch.source && patch.source !== row.source) {
          next.operator = OPERATORS_BY_SOURCE[patch.source][0].value;
        }
        return next;
      }),
    );

  const removeRow = (id) => setRows((r) => r.filter((row) => row.id !== id));

  const loadRows = (savedAssertions) =>
    setRows(
      (savedAssertions || []).map((a) => ({
        id: createId(),
        source: a.source || 'status',
        operator: a.operator || 'equals',
        path: a.path || '',
        headerName: a.headerName || '',
        expected: a.expected || '',
      })),
    );

  const reset = () => setRows([]);

  return { rows, addRow, updateRow, removeRow, loadRows, reset };
}
