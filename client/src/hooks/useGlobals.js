import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchGlobals, updateGlobals as apiUpdate } from '../services/globalService.js';

// Globals are a singleton — no selection, no create/delete, just one always-on set of
// {{name}} variables applied to every request regardless of environment.
export function useGlobals() {
  const [globals, setGlobals] = useState({ variables: [] });
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'

  // A refresh keeps the current list on screen rather than flipping back to 'loading'
  // (which flashed "Loading…" after every save), and only the newest request may
  // update state — a slow earlier response must not overwrite a newer one.
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const call = ++latest.current;
    return fetchGlobals().then(
      (data) => {
        if (call !== latest.current) return;
        setGlobals(data);
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

  const updateGlobals = async (payload) => {
    const updated = await apiUpdate(payload);
    setGlobals(updated);
    return updated;
  };

  return { globals, status, refresh, updateGlobals };
}
