import { useEffect, useRef } from 'react';

/**
 * Escape closes a window — the same as clicking outside it — in every window in the app.
 *
 * Windows can open over one another (a run's results over Monitors), so the open ones
 * are kept in a stack and Escape closes only the top one. One keydown listener serves
 * them all; it is attached while at least one window is open.
 */
const open = [];

function onKeyDown(e) {
  if (e.key !== 'Escape' || open.length === 0) return;
  open[open.length - 1].current?.();
}

export function useEscapeToClose(onClose) {
  const close = useRef(onClose);

  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (open.length === 0) window.addEventListener('keydown', onKeyDown);
    open.push(close);
    return () => {
      const index = open.lastIndexOf(close);
      if (index !== -1) open.splice(index, 1);
      if (open.length === 0) window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
