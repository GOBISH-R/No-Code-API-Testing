import { useState } from 'react';
import { runCollection as apiRunCollection } from '../services/runnerService.js';

// Triggers a collection run and holds the result to display. Deliberately not
// persisted here on the client — the run itself is already saved server-side
// (a TestRun record); this hook only holds the just-completed run for display.
export function useCollectionRunner() {
  const [runningId, setRunningId] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async (collectionId, environmentId, dataset = null) => {
    setRunningId(collectionId);
    setError(null);
    try {
      const testRun = await apiRunCollection(collectionId, {
        environmentId: environmentId || null,
        // Omitted entirely rather than sent as null, so an ordinary run's request body
        // is unchanged from before data-driven testing existed.
        ...(dataset?.length ? { dataset } : {}),
      });
      setResult(testRun);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to run the collection.');
    } finally {
      setRunningId(null);
    }
  };

  const clearResult = () => {
    setResult(null);
    setError(null);
  };

  return { runningId, result, error, run, clearResult };
}
