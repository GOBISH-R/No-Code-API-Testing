import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Show/hide for a password field, shared by every control that offers it.
 *
 * Returns whether the value is visible, a ref for the input, the input's `type`, and a
 * `toggle` plus the props its button needs. The button never submits the form and
 * keeps the field focused, and the caret stays where the person left it.
 */
export function usePasswordReveal() {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef(null);
  // Changing an input's type resets its caret to the start in Chromium, so the caret
  // is remembered on toggle and put back once the new type has rendered.
  const caret = useRef(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const saved = caret.current;
    if (!input || saved === null) return undefined;
    caret.current = null;

    const restore = () => {
      if (document.activeElement !== input) return;
      if (input.selectionStart !== saved.start || input.selectionEnd !== saved.end) {
        input.setSelectionRange(saved.start, saved.end);
      }
    };
    restore();

    // Chromium applies its own reset some time after the type change, as a separate
    // selection change. Undo it if it arrives shortly after the toggle; after that the
    // person is moving the caret themselves and is left alone.
    document.addEventListener('selectionchange', restore);
    const stop = setTimeout(() => document.removeEventListener('selectionchange', restore), 300);
    return () => {
      clearTimeout(stop);
      document.removeEventListener('selectionchange', restore);
    };
  }, [visible]);

  const toggle = () => {
    const input = inputRef.current;
    if (input && document.activeElement === input) {
      caret.current = { start: input.selectionStart, end: input.selectionEnd };
    }
    setVisible((v) => !v);
  };

  const label = visible ? 'Hide password' : 'Show password';

  return {
    visible,
    inputRef,
    type: visible ? 'text' : 'password',
    buttonProps: {
      type: 'button',
      onClick: toggle,
      // mousedown would blur the field before the click lands; keep the caret put.
      onMouseDown: (e) => e.preventDefault(),
      'aria-label': label,
      'aria-pressed': visible,
      title: label,
    },
  };
}
