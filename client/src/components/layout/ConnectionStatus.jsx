import { useHealthCheck } from '../../hooks/useHealthCheck.js';

export default function ConnectionStatus() {
  const { status, health, error, checkHealth } = useHealthCheck();

  const label = status === 'loading' ? 'Checking…' : status === 'online' ? 'Connected' : 'Offline';

  const title =
    status === 'online'
      ? `Database: ${health?.database?.state ?? 'unknown'}`
      : status === 'offline'
        ? error
        : undefined;

  return (
    <button
      type="button"
      className={`connection-status connection-status--${status} btn-ghost`}
      onClick={checkHealth}
      title={title || 'Click to re-check'}
    >
      <span className="connection-status__dot" />
      <span className="connection-status__label">{label}</span>
    </button>
  );
}
