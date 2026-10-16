import { useEffect, useState } from 'react';
import RunResultsModal from './RunResultsModal.jsx';
import { formatTimestamp } from '../../utils/format.js';
import './runner.css';
import './dashboard.css';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

const STATUS_LABEL = { passed: 'PASSED', failed: 'FAILED', error: 'ERROR' };
const STATUS_COLOR = { passed: '#22c55e', failed: '#f59e0b', error: '#ef4444' };

function StatTile({ label, value }) {
  return (
    <div className="stat-tile">
      <span className="stat-tile__value">{value}</span>
      <span className="stat-tile__label">{label}</span>
    </div>
  );
}

function TrendChart({ trend }) {
  const chartHeight = 80;
  const barWidth = 14;
  const gap = 4;
  const segmentGap = 2;

  const maxTotal = Math.max(1, ...trend.map((d) => d.passed + d.failed + d.error));
  const hasAnyRuns = trend.some((d) => d.passed + d.failed + d.error > 0);

  if (!hasAnyRuns) {
    return <p className="dashboard-hint">No runs in the last 14 days.</p>;
  }

  return (
    <div className="trend-chart">
      <svg
        width={trend.length * (barWidth + gap)}
        height={chartHeight}
        role="img"
        aria-label="Runs per day over the last 14 days, by status"
      >
        {trend.map((day, i) => {
          const x = i * (barWidth + gap);
          const segments = [
            { key: 'passed', value: day.passed },
            { key: 'failed', value: day.failed },
            { key: 'error', value: day.error },
          ].filter((s) => s.value > 0);

          let y = chartHeight;
          const rects = [];
          segments.forEach((seg, si) => {
            const h = Math.max(2, Math.round((seg.value / maxTotal) * chartHeight));
            y -= h;
            const isTop = si === segments.length - 1;
            rects.push(
              <rect
                key={seg.key}
                x={x}
                y={y}
                width={barWidth}
                height={h}
                fill={STATUS_COLOR[seg.key]}
                rx={isTop ? 3 : 0}
              >
                <title>{`${day.date} — ${seg.key}: ${seg.value}`}</title>
              </rect>,
            );
            y -= segmentGap;
          });

          return <g key={day.date}>{rects}</g>;
        })}
      </svg>

      <div className="trend-chart__legend">
        {Object.entries(STATUS_LABEL).map(([key, label]) => (
          <span key={key} className="trend-chart__legend-item">
            <i className="trend-chart__swatch" style={{ background: STATUS_COLOR[key] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function RecentRuns({ runs, onOpenRun }) {
  if (runs.length === 0) {
    return <p className="dashboard-hint">No runs yet.</p>;
  }

  return (
    <ul className="history-list">
      {runs.map((run) => (
        <li key={run._id}>
          <button className="history-row" onClick={() => onOpenRun(run._id)}>
            <span className={`history-row__badge history-row__badge--${run.status}`}>
              {STATUS_LABEL[run.status]}
            </span>
            <span className="history-row__collection">{run.collectionName}</span>
            <span className="history-row__meta">
              {run.requestCount} request{run.requestCount === 1 ? '' : 's'}
            </span>
            <span className="history-row__time">{formatTimestamp(run.startedAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardModal({ dashboardState, testRunsState, collections, onClose }) {
  useEscapeToClose(onClose);
  const { summary, status, error, refresh } = dashboardState;
  const { selectedRun, openRun, closeRun } = testRunsState;
  const [collectionFilter, setCollectionFilter] = useState('');

  useEffect(() => {
    refresh(collectionFilter || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionFilter]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">Dashboard</h3>

        <div className="history-filter">
          <label>
            Collection
            <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)}>
              <option value="">All collections</option>
              {collections.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {status === 'loading' && <p className="dashboard-hint">Loading…</p>}
        {status === 'error' && <p className="dashboard-hint dashboard-hint--error">{error}</p>}

        {summary && (
          <>
            <div className="stat-tile-row">
              <StatTile label="Total runs" value={summary.totalRuns} />
              <StatTile label="Passed" value={summary.passed} />
              <StatTile label="Failed" value={summary.failed} />
              <StatTile label="Error" value={summary.error} />
              <StatTile
                label="Pass rate"
                value={summary.passRate === null ? '—' : `${Math.round(summary.passRate * 100)}%`}
              />
              <StatTile
                label="Avg response time"
                value={summary.averageResponseTimeMs === null ? '—' : `${summary.averageResponseTimeMs} ms`}
              />
            </div>

            <p className="dashboard-section-title">Failure trend — last 14 days</p>
            <TrendChart trend={summary.trend} />

            <p className="dashboard-section-title">Recent runs</p>
            <RecentRuns runs={summary.recentRuns} onOpenRun={openRun} />
          </>
        )}

        <div className="modal__actions">
          <button className="modal__confirm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {selectedRun && <RunResultsModal run={selectedRun} onClose={closeRun} />}
    </div>
  );
}
