/**
 * "Chrome on Windows" from a User-Agent header, for the "Is this you?" email.
 *
 * Only a hint for a person to recognise their own request — never used to decide
 * anything — so a short list of common browsers and systems is enough, and anything
 * unrecognised reads as "an unknown browser".
 */

// Order matters: Edge and Opera also say "Chrome", and Chrome also says "Safari".
const BROWSERS = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS = [
  [/Windows/, 'Windows'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

function match(list, ua) {
  return list.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
}

export function describeDevice(userAgent) {
  const ua = String(userAgent || '').slice(0, 512);
  const browser = match(BROWSERS, ua);
  const system = match(SYSTEMS, ua);
  if (browser && system) return `${browser} on ${system}`;
  if (browser) return browser;
  if (system) return `a browser on ${system}`;
  return 'an unknown browser';
}

/** "15 Oct 2026, 10:42 UTC" — the email cannot know the reader's time zone. */
export function formatRequestTime(date) {
  const text = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(date);
  return `${text} UTC`;
}
