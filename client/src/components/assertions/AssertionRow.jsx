import { ASSERTION_SOURCES, OPERATORS_BY_SOURCE } from '../../hooks/useAssertions.js';
import Icon from '../common/Icon.jsx';

const NO_VALUE_OPERATORS = new Set(['exists', 'notExists', 'isEmpty', 'isNotEmpty']);

export default function AssertionRow({ assertion, onUpdate, onRemove }) {
  const operators = OPERATORS_BY_SOURCE[assertion.source];
  const needsValue = !NO_VALUE_OPERATORS.has(assertion.operator);

  return (
    <div className="assertion-row">
      <select
        className="assertion-row__source"
        value={assertion.source}
        onChange={(e) => onUpdate(assertion.id, { source: e.target.value })}
      >
        {ASSERTION_SOURCES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      {assertion.source === 'json' && (
        <input
          type="text"
          className="assertion-row__path"
          placeholder="$.id"
          value={assertion.path}
          onChange={(e) => onUpdate(assertion.id, { path: e.target.value })}
        />
      )}

      {assertion.source === 'header' && (
        <input
          type="text"
          className="assertion-row__path"
          placeholder="Content-Type"
          value={assertion.headerName}
          onChange={(e) => onUpdate(assertion.id, { headerName: e.target.value })}
        />
      )}

      <select
        className="assertion-row__operator"
        value={assertion.operator}
        onChange={(e) => onUpdate(assertion.id, { operator: e.target.value })}
      >
        {operators.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>

      {needsValue && (
        <input
          type="text"
          className="assertion-row__expected"
          placeholder={assertion.operator === 'matches' ? '^[0-9]+$' : 'expected value'}
          value={assertion.expected}
          onChange={(e) => onUpdate(assertion.id, { expected: e.target.value })}
        />
      )}

      <button
        className="assertion-row__remove"
        onClick={() => onRemove(assertion.id)}
        aria-label="Remove assertion"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
