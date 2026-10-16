/**
 * The icon set.
 *
 * Inline SVG rather than emoji or text glyphs. Characters like ▶ ⭳ ✕ ☾ render at the
 * mercy of whatever font resolves them — they arrive at different weights and optical
 * sizes on each platform, and some (the crescent moon especially) simply look like a
 * stray letter. These are drawn on a 16px grid with a consistent 1.5 stroke, so they
 * sit together and inherit colour from the button they live in.
 */

const PATHS = {
  sun: (
    <>
      <circle cx="8" cy="8" r="3.25" />
      <path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06M12.95 12.95l-1.06-1.06M4.11 4.11L3.05 3.05" />
    </>
  ),
  moon: <path d="M13.5 9.5A5.8 5.8 0 0 1 6.5 2.5a5.8 5.8 0 1 0 7 7z" />,
  plus: <path d="M8 3.25v9.5M3.25 8h9.5" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  // Filled: a run button reads as solid at this size, an outlined triangle does not.
  play: <path d="M5.5 3.5l6.5 4.5-6.5 4.5z" fill="currentColor" />,
  download: <path d="M8 2.5v8M4.75 7.25L8 10.5l3.25-3.25M3 13h10" />,
  upload: <path d="M8 13.5v-8M4.75 8.75L8 5.5l3.25 3.25M3 2.5h10" />,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" />,
  folder: <path d="M1.75 12.5v-9h4l1.5 2h7v7z" />,
  chevronRight: <path d="M6 3.5L10.5 8 6 12.5" />,
  chevronDown: <path d="M3.5 6L8 10.5 12.5 6" />,
  chevronUp: <path d="M3.5 10L8 5.5 12.5 10" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2L13.5 13.5" />
    </>
  ),
  copy: <path d="M5.5 5.5V3h7.5v7.5H10.5M3 5.5h7.5V13H3z" />,
  refresh: <path d="M13 8a5 5 0 1 1-1.6-3.66M13 2.5V5.5h-3" />,
  code: <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3l-2 10" />,
  menu: <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />,
  // A door with an arrow leaving it.
  signOut: <path d="M6.5 2.5h-3v11h3M10.5 5l3 3-3 3M13.5 8H6.5" />,
  // A cog, drawn on a 24px grid and scaled down; the stroke is scaled up to match.
  settings: (
    <g transform="scale(0.6667)" strokeWidth="2.25">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </g>
  ),
};

export default function Icon({ name, size = 14, className = '', title }) {
  const path = PATHS[name];
  if (!path) return null;

  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative by default: the control around it carries the accessible name.
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {path}
    </svg>
  );
}
