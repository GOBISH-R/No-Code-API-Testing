import { useCallback, useEffect, useRef, useState } from 'react';

const MIN = 15;
const MAX = 85;
const STEP = 5;

const clamp = (value) => Math.min(MAX, Math.max(MIN, value));

function readStored(key, fallback) {
  try {
    const stored = Number(window.localStorage.getItem(key));
    return Number.isFinite(stored) && stored > 0 ? clamp(stored) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A vertical split between two panes, resizable by dragging or from the keyboard.
 *
 * Returns the top pane's share as a percentage, a ref for the container it is measured
 * against, and the props for the handle. The position is remembered per browser — it
 * is a layout preference, not data anyone else needs.
 */
export function useSplitPane(storageKey, initial = 45) {
  const containerRef = useRef(null);
  const [ratio, setRatio] = useState(() => readStored(storageKey, initial));
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(Math.round(ratio)));
    } catch {
      // Storage blocked: the split still works, it just is not remembered.
    }
  }, [storageKey, ratio]);

  const onPointerMove = useCallback((event) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box || box.height === 0) return;
    setRatio(clamp(((event.clientY - box.top) / box.height) * 100));
  }, []);

  const onPointerDown = useCallback(
    (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      // Capture keeps the drag alive when the pointer crosses an iframe or leaves the
      // window, and the release always arrives here.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDragging(true);
    },
    [],
  );

  const onPointerUp = useCallback((event) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
  }, []);

  const onKeyDown = useCallback((event) => {
    const moves = { ArrowUp: -STEP, ArrowDown: STEP, Home: MIN - 100, End: 100 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setRatio((r) => clamp(r + moves[event.key]));
  }, []);

  return {
    ratio,
    containerRef,
    dragging,
    splitterProps: {
      role: 'separator',
      'aria-orientation': 'horizontal',
      'aria-label': 'Resize request and response',
      'aria-valuemin': MIN,
      'aria-valuemax': MAX,
      'aria-valuenow': Math.round(ratio),
      tabIndex: 0,
      onPointerDown,
      onPointerMove: dragging ? onPointerMove : undefined,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onKeyDown,
      onDoubleClick: () => setRatio(initial),
    },
  };
}
