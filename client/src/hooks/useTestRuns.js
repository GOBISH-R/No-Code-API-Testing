import { useCallback, useState } from 'react';
import { fetchTestRuns, fetchTestRun } from '../services/testRunService.js';

export function useTestRuns() {
  const [runs, setRuns] = useState([]);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'error'
  const [selectedRun, setSelectedRun] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async (collectionId) => {
    setStatus('loading');
    setError(null);
    try {
      const data = await fetchTestRuns({ collectionId });
      setRuns(data);
      setStatus('ready');
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load run history.');
      setStatus('error');
    }
  }, []);

  const openRun = async (id) => {
    try {
      const run = await fetchTestRun(id);
      setSelectedRun(run);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load that run.');
    }
  };

  const closeRun = () => setSelectedRun(null);

  return { runs, status, error, refresh, selectedRun, openRun, closeRun };
}
