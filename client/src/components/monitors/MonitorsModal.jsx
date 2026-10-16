import { useEffect, useState } from 'react';
import RunResultsModal from '../runner/RunResultsModal.jsx';
import { MONITOR_INTERVALS, fromNow, intervalLabel } from '../../utils/relativeTime.js';
import { formatTimestamp } from '../../utils/format.js';
import { sendTestAlert } from '../../services/monitorService.js';
import './monitors.css';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

const MAX_MONITORS = 5;
const POLL_MS = 15 * 1000;

const STATUS_LABEL = { passed: 'Passed', failed: 'Failed', error: 'Error', skipped: 'Skipped' };

const emptyForm = (collections) => ({
  name: '',
  collectionId: collections[0]?._id ?? '',
  environmentId: '',
  intervalMinutes: 60,
  alertEmail: true,
  alertWebhookUrl: '',
});

// What "Send a test alert" reports, per channel, in words.
function describeTest({ email, webhook }) {
  const parts = [];
  if (email === 'sent') parts.push('email sent');
  else if (email === 'no recipient') parts.push('no one to email');
  else if (email === 'failed') parts.push('the email could not be sent');
  if (webhook === 'sent') parts.push('webhook delivered');
  else if (webhook.startsWith('failed')) parts.push(`webhook ${webhook.replace(/^failed: /, 'failed — ')}`);
  return `Test alert: ${parts.join(', ')}.`;
}

function errorMessage(err, fallback) {
  return err.response?.data?.message || err.message || fallback;
}

/**
 * Monitors: collections that run themselves on a schedule. Each run lands in Runs and on
 * the Dashboard like any other; this panel manages the schedules and shows each one's
 * latest result.
 */
export default function MonitorsModal({ monitorsState, collections, environments, testRunsState, onClose, readOnly = false }) {
  useEscapeToClose(onClose);
  const { monitors, status, runningIds, refresh, create, update, remove, runNow } = monitorsState;
  const [now, setNow] = useState(() => Date.now());
  // null: no form; 'new': creating; otherwise the id of the monitor being edited.
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(() => emptyForm(collections));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Polls while open, so a scheduled run's result shows up on its own.
  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      refresh();
      setNow(() => Date.now());
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const collectionName = (id) => collections.find((c) => c._id === id)?.name ?? 'Deleted collection';
  const environmentName = (id) => (id ? environments.find((e) => e._id === id)?.name ?? 'Deleted environment' : 'No environment');

  const startCreate = () => {
    setForm(emptyForm(collections));
    setEditing('new');
    setError(null);
  };

  const startEdit = (monitor) => {
    setForm({
      name: monitor.name,
      collectionId: monitor.collectionId,
      // An environment deleted since shows as "No environment" in the list below; start
      // the form there too, or saving would send an id that no longer exists.
      environmentId: environments.some((e) => e._id === monitor.environmentId) ? monitor.environmentId : '',
      intervalMinutes: monitor.intervalMinutes,
      alertEmail: monitor.alertEmail ?? true,
      alertWebhookUrl: monitor.alertWebhookUrl ?? '',
    });
    setEditing(monitor._id);
    setError(null);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      ...form,
      name: form.name.trim(),
      environmentId: form.environmentId || null,
      alertWebhookUrl: form.alertWebhookUrl.trim(),
    };
    try {
      if (editing === 'new') await create(payload);
      else await update(editing, payload);
      setEditing(null);
      setNow(() => Date.now());
    } catch (err) {
      setError(errorMessage(err, 'The monitor could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const act = async (fn, fallback) => {
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      setNow(() => Date.now());
      return result;
    } catch (err) {
      setError(errorMessage(err, fallback));
      return undefined;
    }
  };

  const testAlert = async (monitor) => {
    const result = await act(() => sendTestAlert(monitor._id), 'The test alert could not be sent.');
    if (result) setNotice(describeTest(result));
  };

  const handleDelete = (monitor) => {
    if (window.confirm(`Delete the monitor "${monitor.name}"? Its past runs stay in Runs.`)) {
      act(() => remove(monitor._id), 'The monitor could not be deleted.');
    }
  };

  const canAdd = monitors.length < MAX_MONITORS && collections.length > 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="monitors-title" className="modal modal--wide monitors" onClick={(e) => e.stopPropagation()}>
        <div className="monitors__head">
          <div>
            <h3 id="monitors-title" className="modal__title">Monitors</h3>
            <p className="monitors__lead">
              Run a collection automatically on a schedule. Every run appears in Runs and on the Dashboard.
            </p>
          </div>
          {editing === null && !readOnly && (
            <button type="button" className="modal__confirm" onClick={startCreate} disabled={!canAdd}
              title={collections.length === 0 ? 'Create a collection first' : monitors.length >= MAX_MONITORS ? `Up to ${MAX_MONITORS} monitors` : undefined}>
              New monitor
            </button>
          )}
        </div>

        {error && <p className="modal__error">{error}</p>}
        {notice && <p className="monitors__notice">{notice}</p>}

        {editing !== null && (
          <form className="monitor-form" onSubmit={save}>
            <label className="modal__field">
              Name
              <input type="text" value={form.name} maxLength={100} required autoFocus
                placeholder="e.g. Production health check"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="modal__field">
              Collection
              <select value={form.collectionId} required onChange={(e) => setForm({ ...form, collectionId: e.target.value })}>
                {collections.map((c) => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="modal__field">
              Environment
              <select value={form.environmentId} onChange={(e) => setForm({ ...form, environmentId: e.target.value })}>
                <option value="">No environment</option>
                {environments.map((env) => (
                  <option key={env._id} value={env._id}>{env.name}</option>
                ))}
              </select>
            </label>
            <label className="modal__field">
              Runs
              <select value={form.intervalMinutes} onChange={(e) => setForm({ ...form, intervalMinutes: Number(e.target.value) })}>
                {MONITOR_INTERVALS.map((i) => (
                  <option key={i.minutes} value={i.minutes}>{i.label}</option>
                ))}
              </select>
            </label>
            <fieldset className="monitor-form__alerts">
              <legend>Alerts — sent when it starts failing, and when it recovers</legend>
              <label className="monitor-form__check">
                <input type="checkbox" checked={form.alertEmail}
                  onChange={(e) => setForm({ ...form, alertEmail: e.target.checked })} />
                Email me
              </label>
              <label className="modal__field monitor-form__webhook">
                Webhook URL (optional)
                <input type="url" value={form.alertWebhookUrl} maxLength={500}
                  placeholder="https://hooks.slack.com/services/…  — Slack, Discord, Teams or any JSON endpoint"
                  onChange={(e) => setForm({ ...form, alertWebhookUrl: e.target.value })} />
              </label>
            </fieldset>
            <div className="monitor-form__actions">
              <button type="button" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
              <button type="submit" className="modal__confirm" disabled={saving || !form.name.trim() || !form.collectionId}>
                {saving ? 'Saving…' : editing === 'new' ? 'Create monitor' : 'Save changes'}
              </button>
            </div>
            {editing === 'new' && <p className="monitor-form__hint">It runs once straight away, then on the schedule.</p>}
          </form>
        )}

        {status === 'loading' && <p className="history-hint">Loading…</p>}
        {status === 'error' && <p className="history-hint history-hint--error">Monitors need a database connection.</p>}
        {status === 'ready' && monitors.length === 0 && editing === null && (
          <p className="monitors__empty">
            {collections.length === 0
              ? 'Create a collection with at least one request, then add a monitor to run it on a schedule.'
              : 'No monitors yet. Add one to run a collection every few minutes, hourly or daily.'}
          </p>
        )}

        {monitors.length > 0 && (
          <ul className="monitor-list">
            {monitors.map((m) => {
              const running = m.running || runningIds.has(m._id);
              return (
                <li key={m._id} className={`monitor ${m.enabled ? '' : 'monitor--paused'}`}>
                  <div className="monitor__main">
                    <span className="monitor__name">{m.name}</span>
                    <span className="monitor__facts">
                      {collectionName(m.collectionId)} · {environmentName(m.environmentId)} · {intervalLabel(m.intervalMinutes)}
                    </span>
                    <span className="monitor__state">
                      {m.lastStatus ? (
                        <>
                          <span className={`monitor__badge monitor__badge--${m.lastStatus}`}>{STATUS_LABEL[m.lastStatus]}</span>
                          {m.lastRunId ? (
                            <button type="button" className="monitor__link" onClick={() => testRunsState.openRun(m.lastRunId)}
                              title={formatTimestamp(m.lastRunAt)}>
                              {fromNow(m.lastRunAt, now)}
                            </button>
                          ) : (
                            <span title={formatTimestamp(m.lastRunAt)}>{fromNow(m.lastRunAt, now)}</span>
                          )}
                        </>
                      ) : (
                        <span className="monitor__muted">Not run yet</span>
                      )}
                      <span className="monitor__next">
                        {running
                          ? 'Running…'
                          : !m.enabled
                            ? 'Paused'
                            : new Date(m.nextRunAt).getTime() <= now
                              ? 'Starting soon'
                              : `Next ${fromNow(m.nextRunAt, now)}`}
                      </span>
                    </span>
                    {m.lastError && <span className="monitor__error">{m.lastError}</span>}
                    <span className="monitor__alerts">
                      {m.alertEmail || m.alertWebhookUrl
                        ? `Alerts: ${[m.alertEmail && 'email', m.alertWebhookUrl && 'webhook'].filter(Boolean).join(' + ')}`
                        : 'Alerts off'}
                      {m.alertState === 'failing' && ' · failing — you will hear when it recovers'}
                    </span>
                  </div>
                  {/* A viewer can see the results, but changing monitors is for editors. */}
                  {!readOnly && (
                  <div className="monitor__actions">
                    <button type="button" onClick={() => act(() => runNow(m._id), 'The monitor could not run.')} disabled={running}>
                      {running ? 'Running…' : 'Run now'}
                    </button>
                    <button type="button" onClick={() => act(() => update(m._id, { enabled: !m.enabled }), 'The monitor could not be updated.')}>
                      {m.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button type="button" onClick={() => startEdit(m)} disabled={editing !== null}>Edit</button>
                    <button type="button" onClick={() => testAlert(m)} disabled={!m.alertEmail && !m.alertWebhookUrl}
                      title="Send a test alert now, to check email and webhook are set up">
                      Test alert
                    </button>
                    <button type="button" className="monitor__delete" onClick={() => handleDelete(m)}>Delete</button>
                  </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="modal__actions monitors__footer">
          <span className="monitors__count">{monitors.length} of {MAX_MONITORS} monitors</span>
          <button onClick={onClose}>Close</button>
        </div>
      </div>

      {testRunsState.selectedRun && <RunResultsModal run={testRunsState.selectedRun} onClose={testRunsState.closeRun} />}
    </div>
  );
}
