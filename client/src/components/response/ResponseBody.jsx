import { useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes } from '../../utils/format.js';
import { isBinaryContentType } from '../../utils/contentType.js';
import { downloadText, responseFileName } from '../../utils/download.js';
import { findMatches, segment } from '../../utils/textSearch.js';
import Icon from '../common/Icon.jsx';

// Cap how much text we actually render — a multi-MB JSON blob in a <pre> can freeze the tab.
const MAX_DISPLAY_CHARS = 300_000;

// JSON arrives already parsed from the server; a JSON string that the target labelled
// as text is parsed here so it can be formatted too. Anything else has no pretty form.
function asJson(body) {
  if (body !== null && typeof body === 'object') return { ok: true, value: body };
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return { ok: true, value: JSON.parse(trimmed) };
      } catch {
        // Looks like JSON, is not — shown as it came.
      }
    }
  }
  return { ok: false };
}

function toDisplayText(body, view) {
  const json = asJson(body);
  if (json.ok) {
    try {
      if (view === 'pretty') return JSON.stringify(json.value, null, 2);
      // Raw is what the server sent: the original string when there was one.
      return typeof body === 'string' ? body : JSON.stringify(json.value);
    } catch {
      return String(body);
    }
  }
  return typeof body === 'string' ? body : String(body);
}

function contentTypeOf(headers) {
  return headers?.['content-type'] || headers?.['Content-Type'] || '';
}

export default function ResponseBody({ body, headers, status }) {
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState('pretty');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const searchRef = useRef(null);
  const preRef = useRef(null);

  const isEmpty = body === null || body === undefined || body === '';
  const isBinary = !isEmpty && isBinaryContentType(headers);
  const canPrettify = !isEmpty && asJson(body).ok;
  const fullText = isEmpty || isBinary ? '' : toDisplayText(body, view);
  const truncated = fullText.length > MAX_DISPLAY_CHARS;
  const displayText = truncated ? fullText.slice(0, MAX_DISPLAY_CHARS) : fullText;

  const { matches, capped } = useMemo(
    () => (searchOpen ? findMatches(displayText, query) : { matches: [], capped: false }),
    [searchOpen, displayText, query],
  );
  // Clamped rather than reset, so switching Pretty/Raw keeps the place roughly.
  const current = matches.length === 0 ? -1 : Math.min(active, matches.length - 1);

  // Brings the current match into view; reads the DOM only, no state.
  useEffect(() => {
    if (current < 0) return;
    preRef.current?.querySelector('mark[data-current]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current, query, view]);

  if (isEmpty) {
    return <p className="response-body__empty">This response has no body.</p>;
  }

  if (isBinary) {
    return <p className="response-body__empty">Binary response — preview not supported yet.</p>;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked by the browser — copying is a convenience, not critical.
    }
  };

  const handleSave = () => {
    const contentType = contentTypeOf(headers);
    downloadText(
      responseFileName(status, contentType, canPrettify),
      fullText,
      contentType.split(';')[0].trim() || 'text/plain',
    );
  };

  // A new box focuses itself (autoFocus); an open one is re-selected so typing replaces it.
  const openSearch = () => {
    if (searchOpen) searchRef.current?.select();
    else setSearchOpen(true);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    setActive(0);
    preRef.current?.focus();
  };

  const step = (delta) => {
    if (matches.length === 0) return;
    setActive((current + delta + matches.length) % matches.length);
  };

  // Ctrl/Cmd+F while the body has focus searches the body, not the whole page.
  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openSearch();
    }
  };

  const countLabel =
    query === '' ? '' : matches.length === 0 ? 'No results' : `${current + 1} of ${matches.length}${capped ? '+' : ''}`;

  return (
    <div className="response-body" onKeyDown={handleKeyDown}>
      <div className="response-body__toolbar">
        {canPrettify && (
          <div className="response-body__views" role="group" aria-label="Body view">
            {['pretty', 'raw'].map((mode) => (
              <button
                key={mode}
                type="button"
                className={`response-body__view ${view === mode ? 'response-body__view--active' : ''}`}
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
              >
                {mode === 'pretty' ? 'Pretty' : 'Raw'}
              </button>
            ))}
          </div>
        )}

        <div className="response-body__actions">
          {searchOpen ? (
            <div className="response-search" role="search">
              <Icon name="search" size={13} />
              <input
                ref={searchRef}
                // Focused as it mounts, so keys typed straight after Ctrl+F land in it.
                autoFocus
                type="text"
                className="response-search__input"
                placeholder="Find in response"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    step(e.shiftKey ? -1 : 1);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    closeSearch();
                  }
                }}
                aria-label="Find in response"
              />
              <span className="response-search__count" aria-live="polite">{countLabel}</span>
              <button type="button" className="response-search__btn" onClick={() => step(-1)} disabled={matches.length === 0} aria-label="Previous match" title="Previous (Shift+Enter)">
                <Icon name="chevronUp" size={12} />
              </button>
              <button type="button" className="response-search__btn" onClick={() => step(1)} disabled={matches.length === 0} aria-label="Next match" title="Next (Enter)">
                <Icon name="chevronDown" size={12} />
              </button>
              <button type="button" className="response-search__btn" onClick={closeSearch} aria-label="Close search" title="Close (Esc)">
                <Icon name="close" size={12} />
              </button>
            </div>
          ) : (
            <button type="button" className="response-body__action" onClick={openSearch} title="Find in response (Ctrl+F)">
              <Icon name="search" size={13} /> Find
            </button>
          )}
          <button type="button" className="response-body__action" onClick={handleSave} title="Save the response to a file">
            <Icon name="download" size={13} /> Save
          </button>
          <button type="button" className="response-body__action" onClick={handleCopy}>
            <Icon name="copy" size={13} /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <pre className="response-body__pre" ref={preRef} tabIndex={0}>
        {matches.length === 0
          ? displayText
          : segment(displayText, matches).map((part, i) =>
              part.match === null ? (
                part.text
              ) : (
                <mark
                  key={i}
                  className={`response-search__hit ${part.match === current ? 'response-search__hit--current' : ''}`}
                  data-current={part.match === current ? '' : undefined}
                >
                  {part.text}
                </mark>
              ),
            )}
      </pre>
      {truncated && (
        <p className="response-body__truncated">
          Showing the first {formatBytes(MAX_DISPLAY_CHARS)} of {formatBytes(fullText.length)} —
          truncated for display. Save keeps the whole response.
        </p>
      )}
    </div>
  );
}
