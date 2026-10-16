import { useState } from 'react';
import AssertionResults from '../assertions/AssertionResults.jsx';
import ReportModal from './ReportModal.jsx';
import { formatBytes, statusClass } from '../../utils/format.js';
import './runner.css';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

const STATUS_LABEL = { passed: 'PASSED', failed: 'FAILED', error: 'ERROR' };

function CaptureSummary({ captures }) {
  if (!captures || captures.length === 0) return null;
  return (
    <ul className="run-step__captures">
      {captures.map((c) => (
        <li key={c.variableName}>
          <code>{`{{${c.variableName}}}`}</code>
          {c.error ? (
            <span className="run-step__capture-error"> — {c.error}</span>
          ) : (
            <span> = {String(c.value)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function RunStep({ step, index }) {
  return (
    <li className={`run-step ${step.success ? '' : 'run-step--error'}`}>
      <div className="run-step__header">
        <span className="run-step__index">{index + 1}</span>
        <span className="run-step__method">{step.method || (step.protocol === 'websocket' ? 'WS' : step.protocol)}</span>
        <span className="run-step__name">{step.requestName}</span>
      </div>

      {step.success ? (
        <>
          <div className="run-step__meta">
            <span className={`run-step__status ${statusClass(step.response.status)}`}>
              {step.response.status}
            </span>
            <span>{step.response.time} ms</span>
            <span>{formatBytes(step.response.size)}</span>
          </div>
          {step.assertions && <AssertionResults assertions={step.assertions} />}
          <CaptureSummary captures={step.captures} />
        </>
      ) : (
        <p className="run-step__error">{step.error}</p>
      )}
    </li>
  );
}

/**
 * Groups results by the dataset row that produced them.
 *
 * A 3-iteration run of a 10-request collection is 30 results; shown as one flat list
 * they are indistinguishable, and "request 14 failed" says nothing about which input
 * caused it. Runs without a dataset produce a single unlabelled group, so the ordinary
 * case renders exactly as before.
 */
function groupByIteration(results) {
  const groups = [];
  for (const step of results) {
    const key = step.iteration ?? null;
    const last = groups[groups.length - 1];
    if (last && last.iteration === key) last.steps.push(step);
    else groups.push({ iteration: key, label: step.iterationLabel || '', steps: [step] });
  }
  return groups;
}

export default function RunResultsModal({ run, onClose }) {
  useEscapeToClose(onClose);
  const [showReport, setShowReport] = useState(false);

  if (!run) return null;

  const durationMs = new Date(run.completedAt) - new Date(run.startedAt);
  const groups = groupByIteration(run.results);
  const iterated = groups.length > 1 || groups[0]?.iteration !== null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">Run Results — {run.collectionName}</h3>

        <div className={`run-summary run-summary--${run.status}`}>
          <span className="run-summary__verdict">{STATUS_LABEL[run.status]}</span>
          <span className="run-summary__meta">
            {run.results.length} request{run.results.length === 1 ? '' : 's'}
            {iterated && ` across ${run.iterationCount} iteration${run.iterationCount === 1 ? '' : 's'}`} ·{' '}
            {durationMs} ms
            {run.trigger === 'monitor' && ` · started by the monitor “${run.monitorName || 'deleted monitor'}”`}
          </span>
        </div>

        {iterated ? (
          groups.map((group) => {
            const failed = group.steps.filter((s) => !s.success || (s.assertions && !s.assertions.allPassed));
            return (
              <section key={group.iteration ?? 'none'} className="run-iteration">
                <header className={`run-iteration__header ${failed.length > 0 ? 'run-iteration__header--failed' : ''}`}>
                  <span className="run-iteration__number">Iteration {group.iteration}</span>
                  {group.label && <code className="run-iteration__label">{group.label}</code>}
                  <span className="run-iteration__verdict">
                    {failed.length === 0 ? 'passed' : `${failed.length} failed`}
                  </span>
                </header>
                <ul className="run-step-list">
                  {group.steps.map((step, i) => (
                    <RunStep key={`${step.requestId}-${i}`} step={step} index={i} />
                  ))}
                </ul>
              </section>
            );
          })
        ) : (
          <ul className="run-step-list">
            {run.results.map((step, i) => (
              <RunStep key={`${step.requestId}-${i}`} step={step} index={i} />
            ))}
          </ul>
        )}

        <div className="modal__actions">
          <button onClick={() => setShowReport(true)}>View Report</button>
          <button className="modal__confirm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {showReport && <ReportModal run={run} onClose={() => setShowReport(false)} />}
    </div>
  );
}
