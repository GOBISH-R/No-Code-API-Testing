import { HTTP_METHODS } from '../../hooks/useRequestBuilder.js';

export default function MethodSelector({ method, onChange }) {
  return (
    <select
      className={`method-select method-select--${method.toLowerCase()}`}
      aria-label="HTTP method"
      value={method}
      onChange={(e) => onChange(e.target.value)}
    >
      {HTTP_METHODS.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}
