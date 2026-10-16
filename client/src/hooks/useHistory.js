import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchHistory,
  fetchHistoryEntry,
  deleteHistoryEntry,
  clearHistory as apiClear,
} from '../services/historyService.js';

/** The requests this account sent by hand, newest first. */
export function useHistory() {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'

  // Same pattern as the other lists: a refresh keeps the current entries on screen, and
  // only the newest response may update state.
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const call = ++latest.current;
    return fetchHistory().then(
      (data) => {
        if (call !== latest.current) return;
        setEntries(data);
        setStatus('ready');
      },
      () => {
        if (call === latest.current) setStatus('error');
      },
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const remove = async (id) => {
    // Gone from the list at once; a failed delete brings it back on the refresh.
    setEntries((list) => list.filter((e) => e._id !== id));
    try {
      await deleteHistoryEntry(id);
    } finally {
      await refresh();
    }
  };

  const clear = async () => {
    setEntries([]);
    try {
      await apiClear();
    } finally {
      await refresh();
    }
  };

  return { entries, status, refresh, remove, clear, load: fetchHistoryEntry };
}
