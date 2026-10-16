import { useEffect, useMemo, useRef, useState } from 'react';
import { SNIPPET_LANGUAGES, generateSnippet } from '../../utils/codeSnippets.js';
import Icon from '../common/Icon.jsx';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

const STORAGE_KEY = 'apiforge.snippet.language';
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

function rememberedLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (SNIPPET_LANGUAGES.some((l) => l.id === saved)) return saved;
  } catch {
    // Storage blocked — fall through to the default.
  }
  return 'curl';
}

function hasCredentials(request) {
  if (request.auth?.type && request.auth.type !== 'none') return true;
  return (request.headers || []).some(
    (h) => h.enabled && /^(authorization|cookie|x-api-key)$/i.test(h.key?.trim() ?? ''),
  );
}

/** The request in the builder as code in a few common languages, ready to copy. */
export default function CodeSnippetModal({ request, onClose }) {
  useEscapeToClose(onClose);
  const [language, setLanguage] = useState(rememberedLanguage);
  // null, 'copied', or 'manual' when the clipboard is unavailable and the code was
  // selected for the user to copy themselves.
  const [copyState, setCopyState] = useState(null);
  const codeRef = useRef(null);
  const { code, notes } = useMemo(() => generateSnippet(request, language), [request, language]);

  useEffect(() => {
    if (copyState !== 'copied') return undefined;
    const timer = setTimeout(() => setCopyState(null), 1500);
    return () => clearTimeout(timer);
  }, [copyState]);

  const pickLanguage = (id) => {
    setLanguage(id);
    setCopyState(null);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Only a convenience — the choice just won't be remembered.
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState('copied');
    } catch {
      // Clipboard API unavailable (insecure context, permissions): select the code so
      // Ctrl+C works.
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(codeRef.current);
      selection.removeAllRanges();
      selection.addRange(range);
      setCopyState('manual');
    }
  };

  const usesVariables = code.includes('{{');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="code-snippet-title"
        className="modal modal--wide code-snippet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="code-snippet__head">
          <h3 id="code-snippet-title" className="modal__title">Code snippet</h3>
          <button className="btn-ghost code-snippet__close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="code-snippet__toolbar">
          <div className="code-snippet__languages" role="tablist" aria-label="Language">
            {SNIPPET_LANGUAGES.map((l) => (
              <button
                key={l.id}
                role="tab"
                aria-selected={language === l.id}
                className={`code-snippet__language ${language === l.id ? 'code-snippet__language--active' : ''}`}
                onClick={() => pickLanguage(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <button className="code-snippet__copy" onClick={copy}>
            <Icon name="copy" />{' '}
            {copyState === 'copied' ? 'Copied' : copyState === 'manual' ? `Press ${MOD}+C` : 'Copy'}
          </button>
        </div>

        <pre className="code-snippet__code" tabIndex={0}>
          <code ref={codeRef}>{code}</code>
        </pre>

        {(notes.length > 0 || usesVariables || hasCredentials(request)) && (
          <ul className="code-snippet__notes">
            {usesVariables && (
              <li>
                <code>{'{{variables}}'}</code> are left as written — replace them with real values
                before running the code.
              </li>
            )}
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            {hasCredentials(request) && (
              <li>This code includes the request&apos;s credentials. Treat it as a secret if you share it.</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
