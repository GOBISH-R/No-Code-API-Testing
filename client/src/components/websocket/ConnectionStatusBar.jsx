import { useEffect, useState } from 'react';
import './websocket.css';

function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

const STATE_LABELS = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  open: 'Connected',
  closed: 'Disconnected',
  error: 'Error',
};

/**
 * Communicates the thing that most distinguishes WebSocket from the rest of this app:
 * the connection is a live, ongoing thing with a duration and a running message count,
 * not a request that completed.
 */
export default function ConnectionStatusBar({ gatewayState, connection, messages, error }) {
  // Lazy initialiser: reading the clock during every render is impure and makes the
  // component's output depend on when React happens to re-run it.
  const [now, setNow] = useState(() => Date.now());

  // A visibly counting duration is what makes "this is still open" obvious.
  useEffect(() => {
    if (gatewayState !== 'open') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [gatewayState]);

  const sent = messages.filter((m) => m.direction === 'sent').length;
  const received = messages.filter((m) => m.direction === 'received').length;
  const duration = connection?.openedAt ? now - connection.openedAt : 0;

  return (
    <div className={`ws-status ws-status--${gatewayState}`}>
      <span className="ws-status__dot" aria-hidden="true" />
      <span className="ws-status__label">{STATE_LABELS[gatewayState] || gatewayState}</span>

      {gatewayState === 'open' && (
        <>
          <span className="ws-status__item">
            subprotocol: <strong>{connection?.protocol || 'none'}</strong>
          </span>
          <span className="ws-status__item">open {formatDuration(duration)}</span>
          <span className="ws-status__item">
            ↑ {sent} · ↓ {received}
          </span>
        </>
      )}

      {gatewayState === 'closed' && connection?.closeCode != null && (
        <span className="ws-status__item">close code {connection.closeCode}</span>
      )}

      {error && <span className="ws-status__error">{error}</span>}
    </div>
  );
}
