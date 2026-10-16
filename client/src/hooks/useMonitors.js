import { useCallback, useRef, useState } from 'react';
import {
  fetchMonitors,
  createMonitor as apiCreate,
  updateMonitor as apiUpdate,
  deleteMonitor as apiDelete,
  runMonitor as apiRun,
} from '../services/monitorService.js';

/**
 * The account's monitors. Loaded on demand — the panel refreshes while it is open, so
 * a scheduled run's result appears without reopening it.
 */
export function useMonitors() {
  const [monitors, setMonitors] = useState([]);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'error'
  // Monitors whose "Run now" this tab is waiting on.
  const [runningIds, setRunningIds] = useState(() => new Set());
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const call = ++latest.current;
    setStatus((s) => (s === 'idle' ? 'loading' : s));
    return fetchMonitors().then(
      (data) => {
        if (call !== latest.current) return;
        setMonitors(data);
        setStatus('ready');
      },
      () => {
        if (call === latest.current) setStatus('error');
      },
    );
  }, []);

  const create = async (payload) => {
    const created = await apiCreate(payload);
    await refresh();
    return created;
  };

  const update = async (id, payload) => {
    const updated = await apiUpdate(id, payload);
    await refresh();
    return updated;
  };

  const remove = async (id) => {
    await apiDelete(id);
    await refresh();
  };

  const runNow = async (id) => {
    setRunningIds((ids) => new Set(ids).add(id));
    try {
      return await apiRun(id);
    } finally {
      setRunningIds((ids) => {
        const next = new Set(ids);
        next.delete(id);
        return next;
      });
      await refresh();
    }
  };

  return { monitors, status, runningIds, refresh, create, update, remove, runNow };
}
