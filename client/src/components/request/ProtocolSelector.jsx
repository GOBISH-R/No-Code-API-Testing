const PROTOCOLS = [
  { value: 'rest', label: 'REST' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'websocket', label: 'WebSocket' },
];

export default function ProtocolSelector({ protocol, onChange }) {
  return (
    <select
      className="protocol-select"
      aria-label="Protocol"
      value={protocol}
      onChange={(e) => onChange(e.target.value)}
      title="Protocol"
    >
      {PROTOCOLS.map((p) => (
        <option key={p.value} value={p.value}>
          {p.label}
        </option>
      ))}
    </select>
  );
}
