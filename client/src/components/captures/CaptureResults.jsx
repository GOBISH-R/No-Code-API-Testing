function formatValue(value) {
  const text = String(value);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export default function CaptureResults({ captures }) {
  if (!captures || captures.length === 0) return null;

  return (
    <div className="capture-results">
      <div className="capture-results__title">Captured Variables</div>
      <ul className="capture-results__list">
        {captures.map((c, index) => (
          <li
            key={index}
            className={`capture-results__item ${c.value !== undefined ? 'ok' : 'fail'}`}
          >
            <code className="capture-results__name">{`{{${c.variableName}}}`}</code>
            {c.value !== undefined ? (
              <span className="capture-results__value">{formatValue(c.value)}</span>
            ) : (
              <span className="capture-results__error">{c.error || 'Not found.'}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
