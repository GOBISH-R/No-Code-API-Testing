import { useEffect, useRef } from 'react';

/**
 * Workbench keyboard shortcuts: Ctrl/⌘+Enter sends, Ctrl/⌘+S saves.
 *
 * Listened for in the capture phase so they work from inside the code editors too,
 * which would otherwise take Ctrl+Enter for themselves. The handlers are read through
 * a ref, so the listener is attached once rather than on every render.
 */
export function useShortcuts({ onSend, onSave, enabled = true }) {
  const handlers = useRef({ onSend, onSave });
  // Updated after each commit rather than during render, where React forbids it.
  useEffect(() => {
    handlers.current = { onSend, onSave };
  });

  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      // A dialog is open: its own keys win.
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;

      if (event.key === 'Enter' && handlers.current.onSend) {
        event.preventDefault();
        event.stopPropagation();
        handlers.current.onSend();
      } else if (event.key.toLowerCase() === 's' && handlers.current.onSave) {
        // Also stops the browser's "Save page as…", which is never what was meant here.
        event.preventDefault();
        event.stopPropagation();
        handlers.current.onSave();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}
