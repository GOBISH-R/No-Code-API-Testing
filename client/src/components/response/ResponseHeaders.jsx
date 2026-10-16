export default function ResponseHeaders({ headers }) {
  const entries = Object.entries(headers || {});

  if (entries.length === 0) {
    return <p className="response-headers__empty">No headers were returned.</p>;
  }

  return (
    <dl className="response-headers">
      {entries.map(([key, value]) => (
        <div className="response-headers__row" key={key}>
          <dt>{key}</dt>
          <dd>{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
