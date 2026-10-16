import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchMocks,
  createMock as apiCreate,
  updateMock as apiUpdate,
  deleteMock as apiDelete,
} from '../services/mockService.js';

export function useMocks() {
  const [mocks, setMocks] = useState([]);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'

  // A refresh keeps the current list on screen rather than flipping back to 'loading'
  // (which flashed "Loading…" after every save), and only the newest request may
  // update state — a slow earlier response must not overwrite a newer one.
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const call = ++latest.current;
    return fetchMocks().then(
      (data) => {
        if (call !== latest.current) return;
        setMocks(data);
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

  const createMock = async (payload) => {
    const created = await apiCreate(payload);
    await refresh();
    return created;
  };

  const updateMock = async (id, payload) => {
    const updated = await apiUpdate(id, payload);
    await refresh();
    return updated;
  };

  const deleteMock = async (id) => {
    await apiDelete(id);
    await refresh();
  };

  return { mocks, status, refresh, createMock, updateMock, deleteMock };
}
