import { useCallback, useEffect, useState } from 'react';
import { fetchHealth } from '../services/healthService.js';

export function useHealthCheck() {
  const [status, setStatus] = useState('loading'); // 'loading' | 'online' | 'offline'
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  // State is only set once the answer is in, so the first check on load needs no
  // "loading" step — the initial state already says so.
  const probe = useCallback(
    () =>
      fetchHealth().then(
        (data) => {
          setHealth(data);
          setError(null);
          setStatus('online');
        },
        (err) => {
          setError(err.message || 'Unable to reach the backend');
          setStatus('offline');
        },
      ),
    [],
  );

  useEffect(() => {
    probe();
  }, [probe]);

  // Clicking the indicator to re-check does show "checking" while it waits.
  const checkHealth = useCallback(() => {
    setStatus('loading');
    return probe();
  }, [probe]);

  return { status, health, error, checkHealth };
}
