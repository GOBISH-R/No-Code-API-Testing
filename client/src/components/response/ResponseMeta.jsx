import { formatBytes, statusClass } from '../../utils/format.js';
import { contentTypeLabel } from '../../utils/contentType.js';

const PHASES = [
  { key: 'dns', label: 'DNS lookup' },
  { key: 'tcp', label: 'TCP connection' },
  { key: 'tls', label: 'TLS handshake' },
  { key: 'wait', label: 'Waiting (TTFB)' },
  { key: 'download', label: 'Download' },
];

/**
 * A value in the status line that opens a small breakdown on hover or keyboard focus,
 * like Postman's timing and size popovers.
 */
function Detail({ label, title, children }) {
  return (
    <span className="response-meta__detail" tabIndex={0} aria-label={title}>
      {label}
      <span className="response-meta__popover" role="tooltip">
        <span className="response-meta__popover-title">{title}</span>
        {children}
      </span>
    </span>
  );
}

function TimingBreakdown({ phases, time, redirects }) {
  // Each bar starts where the previous phase ended — a waterfall, as in Postman.
  const total = Math.max(1, PHASES.reduce((sum, p) => sum + phases[p.key], 0));
  const starts = PHASES.map((_, i) => PHASES.slice(0, i).reduce((sum, p) => sum + phases[p.key], 0));
  return (
    <>
      {PHASES.map(({ key, label }, i) => {
        const ms = phases[key];
        const left = (starts[i] / total) * 100;
        return (
          <span key={key} className="response-meta__row">
            <span className="response-meta__row-label">{label}</span>
            <span className="response-meta__bar">
              <span
                className={`response-meta__bar-fill response-meta__bar-fill--${key}`}
                style={{ left: `${left}%`, width: `${Math.max((ms / total) * 100, ms > 0 ? 1.5 : 0)}%` }}
              />
            </span>
            <span className="response-meta__row-value">{ms} ms</span>
          </span>
        );
      })}
      <span className="response-meta__row response-meta__row--total">
        <span className="response-meta__row-label">Total</span>
        <span />
        <span className="response-meta__row-value">{time} ms</span>
      </span>
      {redirects?.length > 0 && (
        <span className="response-meta__note">
          Followed {redirects.length} redirect{redirects.length === 1 ? '' : 's'}; the phases are for
          the final request, the total covers all of them.
        </span>
      )}
    </>
  );
}

export default function ResponseMeta({ status, statusText, time, size, headersSize, phases, redirects, headers }) {
  const label = contentTypeLabel(headers);

  return (
    <div className="response-meta">
      <span className={`response-meta__status ${statusClass(status)}`}>
        {status} {statusText}
      </span>

      {phases ? (
        <Detail label={`${time} ms`} title="Response time">
          <TimingBreakdown phases={phases} time={time} redirects={redirects} />
        </Detail>
      ) : (
        <span>{time} ms</span>
      )}

      {headersSize != null ? (
        <Detail label={formatBytes(size)} title="Response size">
          <span className="response-meta__row">
            <span className="response-meta__row-label">Body</span>
            <span />
            <span className="response-meta__row-value">{formatBytes(size)}</span>
          </span>
          <span className="response-meta__row">
            <span className="response-meta__row-label">Headers</span>
            <span />
            <span className="response-meta__row-value">{formatBytes(headersSize)}</span>
          </span>
          <span className="response-meta__row response-meta__row--total">
            <span className="response-meta__row-label">Total</span>
            <span />
            <span className="response-meta__row-value">{formatBytes(size + headersSize)}</span>
          </span>
        </Detail>
      ) : (
        <span>{formatBytes(size)}</span>
      )}

      {label && <span className="response-meta__content-type">{label}</span>}
    </div>
  );
}
