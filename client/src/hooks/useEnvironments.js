import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchEnvironments,
  createEnvironment as apiCreate,
  updateEnvironment as apiUpdate,
  deleteEnvironment as apiDelete,
} from '../services/environmentService.js';

function messageFor(err, fallback) {
  return err.response?.data?.message || err.message || fallback;
}

export function useEnvironments() {
  const [environments, setEnvironments] = useState([]);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [selectedId, setSelectedId] = useState(null);

  // A refresh keeps the current list on screen rather than flipping back to 'loading'
  // (which flashed "Loading…" after every save), and only the newest request may
  // update state — a slow earlier response must not overwrite a newer one.
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const call = ++latest.current;
    return fetchEnvironments().then(
      (data) => {
        if (call !== latest.current) return;
        setEnvironments(data);
        setStatus('ready');
        // Drop the selection if that environment was deleted elsewhere.
        setSelectedId((current) => (data.some((e) => e._id === current) ? current : null));
      },
      () => {
        if (call === latest.current) setStatus('error');
      },
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createEnvironment = async (payload) => {
    const created = await apiCreate(payload);
    await refresh();
    return created;
  };

  const updateEnvironment = async (id, payload) => {
    const updated = await apiUpdate(id, payload);
    await refresh();
    return updated;
  };

  const deleteEnvironment = async (id) => {
    try {
      await apiDelete(id);
      await refresh();
    } catch (err) {
      window.alert(messageFor(err, 'Failed to delete the environment.'));
    }
  };

  const selected = environments.find((e) => e._id === selectedId) || null;

  return {
    environments,
    status,
    selectedId,
    selected,
    setSelectedId,
    refresh,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
  };
}
