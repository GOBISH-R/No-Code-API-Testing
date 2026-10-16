import { failureReason } from '../../utils/assertionFormat.js';
import { formatBytes, formatTimestamp, statusClass } from '../../utils/format.js';
import '../response/response-panel.css';
import './report.css';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

const STATUS_LABEL = { passed: 'PASSED', failed: 'FAILED', error: 'ERROR' };

function stepFailures(step) {
  if (!step.success) return [{ kind: 'execution', message: step.error }];
  if (!step.assertions) return [];
  return step.assertions.results
    .filter((r) => !r.pass)
    .map((r) => ({ kind: 'assertion', label: r.label, message: failureReason(r) }));
}

function FailuresSection({ run }) {
  const failingSteps = run.results
    .map((step, index) => ({ step, index, failures: stepFailures(step) }))
    .filter((s) => s.failures.length > 0);

  if (failingSteps.length === 0) return null;

  return (
    <section className="report-section report-section--failures">
      <h4>Failures</h4>
      <ul className="report-failure-list">
        {failingSteps.map(({ step, index, failures }) => (
          <li key={`${step.requestId}-${index}`}>
            <div className="report-failure-list__request">
              {index + 1}. {step.method || (step.protocol === 'websocket' ? 'WS' : step.protocol)} {step.requestName}
              {/* Without this a data-driven failure names a position in a list of 30,
                  which says nothing about the input that caused it. */}
              {step.iteration && (
                <span className="report-failure-list__iteration">
                  {' '}— iteration {step.iteration}
                  {step.iterationLabel ? ` (${step.iterationLabel})` : ''}
                </span>
              )}
            </div>
            <ul>
              {failures.map((f, i) => (
                <li key={i} className="report-failure-list__reason">
                  {f.kind === 'assertion' ? `${f.label} — ${f.message}` : f.message}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RequestDetail({ step, index }) {
  return (
    <div className={`report-request ${step.success ? '' : 'report-request--error'}`}>
      <div className="report-request__header">
        <span>{index + 1}.</span>
        <span className="report-request__method">{step.method || (step.protocol === 'websocket' ? 'WS' : step.protocol)}</span>
        <span className="report-request__name">{step.requestName}</span>
        {step.iteration && (
          <span className="report-request__iteration">
            iteration {step.iteration}
            {step.iterationLabel ? ` · ${step.iterationLabel}` : ''}
          </span>
        )}
      </div>
      <div className="report-request__url">{step.url}</div>

      {step.success ? (
        <>
          <div className="report-request__meta">
            <span className={`report-request__status-badge ${statusClass(step.response.status)}`}>
              {step.response.status}
            </span>
            <span>{step.response.time} ms</span>
            <span>{formatBytes(step.response.size)}</span>
          </div>
          {step.assertions && (
            <table className="report-assertions">
              <thead>
                <tr>
                  <th>Result</th>
                  <th>Assertion</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {step.assertions.results.map((r, i) => (
                  <tr key={i} className={r.pass ? 'pass' : 'fail'}>
                    <td>{r.pass ? 'PASS' : 'FAIL'}</td>
                    <td>{r.label}</td>
                    <td>{r.pass ? '' : failureReason(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <p className="report-request__error">{step.error}</p>
      )}
    </div>
  );
}

export default function ReportModal({ run, onClose }) {
  useEscapeToClose(onClose);
  if (!run) return null;

  const durationMs = new Date(run.completedAt) - new Date(run.startedAt);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div id="report-print-root" role="dialog" aria-modal="true" className="modal modal--wide report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="report-modal__actions no-print">
          <button onClick={onClose}>Close</button>
          <button className="modal__confirm" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
        </div>

        <h2 className="report-title">Test Report — {run.collectionName}</h2>

        <section className="report-section">
          <h4>Test Summary</h4>
          <table className="report-summary">
            <tbody>
              <tr>
                <th>Status</th>
                <td>
                  <span className={`report-status report-status--${run.status}`}>{STATUS_LABEL[run.status]}</span>
                </td>
              </tr>
              <tr>
                <th>Collection</th>
                <td>{run.collectionName}</td>
              </tr>
              <tr>
                <th>Requests</th>
                <td>{run.results.length}</td>
              </tr>
              {run.iterationCount > 1 && (
                <tr>
                  <th>Iterations</th>
                  <td>{run.iterationCount} (data-driven)</td>
                </tr>
              )}
              <tr>
                <th>Started</th>
                <td>{formatTimestamp(run.startedAt)}</td>
              </tr>
              <tr>
                <th>Execution time</th>
                <td>{durationMs} ms</td>
              </tr>
            </tbody>
          </table>
        </section>

        <FailuresSection run={run} />

        <section className="report-section">
          <h4>Request Details</h4>
          {run.results.map((step, i) => (
            <RequestDetail key={`${step.requestId}-${i}`} step={step} index={i} />
          ))}
        </section>
      </div>
    </div>
  );
}
