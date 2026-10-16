import { useEffect, useState } from 'react';

const STORAGE_KEY = 'vats:runtimeContext';

function loadInitial() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { variables: {}, meta: {} };
    const parsed = JSON.parse(raw);
    return {
      variables: parsed?.variables && typeof parsed.variables === 'object' ? parsed.variables : {},
      meta: parsed?.meta && typeof parsed.meta === 'object' ? parsed.meta : {},
    };
  } catch {
    return { variables: {}, meta: {} };
  }
}

function persist(variables, meta) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ variables, meta }));
  } catch {
    // Storage unavailable (private browsing, disabled storage) — the chain still
    // works for this page load, it just won't survive a reload.
  }
}

function labelFor(capture) {
  switch (capture.source) {
    case 'json':
      return `JSON ${capture.path}`;
    case 'header':
      return `Header "${capture.headerName}"`;
    case 'status':
      return 'Status Code';
    case 'time':
      return 'Response Time';
    default:
      return capture.source;
  }
}

// The "runtime context" from a manual request chain: values captured out of one
// response, or set by hand, held for the rest of the browser tab session and
// available to any later request as {{name}} (layered on top of, and overriding,
// environment/global variables). Persisted to sessionStorage so a reload doesn't
// destroy an in-progress chain, but it still resets when the tab closes — this is
// ephemeral chain state, not a saved workflow.
export function useRuntimeContext() {
  const [variables, setVariables] = useState(() => loadInitial().variables);
  const [meta, setMeta] = useState(() => loadInitial().meta);

  useEffect(() => {
    persist(variables, meta);
  }, [variables, meta]);

  const merge = (captured) => {
    const successful = (captured || []).filter((c) => c.value !== undefined);
    if (successful.length === 0) return;

    const updatedAt = new Date().toISOString();
    setVariables((current) => {
      const next = { ...current };
      for (const c of successful) next[c.variableName] = String(c.value);
      return next;
    });
    setMeta((current) => {
      const next = { ...current };
      for (const c of successful) {
        next[c.variableName] = { source: 'capture', label: labelFor(c), updatedAt };
      }
      return next;
    });
  };

  const setVariable = (name, value) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setVariables((current) => ({ ...current, [trimmed]: value }));
    setMeta((current) => ({
      ...current,
      [trimmed]: { source: 'manual', label: 'Set manually', updatedAt: new Date().toISOString() },
    }));
  };

  const removeVariable = (name) => {
    setVariables((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
    setMeta((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const clear = () => {
    setVariables({});
    setMeta({});
  };

  return { variables, meta, merge, setVariable, removeVariable, clear };
}
