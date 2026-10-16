import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'vats.theme';
const THEMES = ['light', 'dark'];

/**
 * Remembers the chosen theme, or follows the system until one is chosen.
 *
 * Stored in localStorage, which can throw (private browsing, blocked site data) and
 * can come back empty — so every access is guarded and "no stored preference" is a
 * normal state rather than an error: the OS setting takes over.
 */
function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Applies the saved theme before the first render, on every page — the landing page,
 * sign-in and the workspace alike — so a dark-theme visitor never sees a light flash.
 */
export function applyStoredTheme() {
  const stored = readStored();
  if (stored) document.documentElement.setAttribute('data-theme', stored);
}

// Light is the app's default, so an unset preference means light — not "ask the OS".
const DEFAULT_THEME = 'light';

export function useTheme() {
  const [theme, setTheme] = useState(() => readStored());

  // The attribute is what the stylesheet keys off; absent means "follow the system".
  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = (current ?? DEFAULT_THEME) === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Not persisted; the choice still applies for this session.
      }
      return next;
    });
  }, []);

  return { theme: theme ?? DEFAULT_THEME, isExplicit: theme !== null, toggle };
}
