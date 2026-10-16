import { useCallback, useState } from 'react';
import { fetchDashboard } from '../services/dashboardService.js';

export function useDashboard() {
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);

  const refresh = useCallback(async (collectionId) => {
    setStatus('loading');
    setError(null);
    try {
      const data = await fetchDashboard({ collectionId });
      setSummary(data);
      setStatus('ready');
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load the dashboard.');
      setStatus('error');
    }
  }, []);

  return { summary, status, error, refresh };
}
