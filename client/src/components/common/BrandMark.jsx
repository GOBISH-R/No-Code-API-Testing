/**
 * The ApIForge mark: a white flame in an orange circle, with a code slash cut through
 * it — "forge" and "code" in one shape.
 *
 * One component so every place that shows the logo (top bars, account pages, landing
 * page) draws exactly the same thing. The same drawing lives in public/favicon.svg for
 * the browser tab; keep the two in step if the mark ever changes.
 *
 * The colours are fixed rather than theme tokens: a logo is the one thing that should
 * look identical in light and dark mode.
 */
const BRAND_ORANGE = '#ff6c37';

export default function BrandMark({ size = 28, className = '', title }) {
  return (
    <svg
      className={`brand-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <circle cx="24" cy="24" r="24" fill={BRAND_ORANGE} />
      <path
        d="M24 8c1 6 9 9.5 9 18.5A9 9 0 0 1 15 26.5c0-4 2-6.5 4-8.5 0 3 1.5 5 3.5 5.5C21.5 18 22 12 24 8z"
        fill="#fff"
      />
      <path d="M27.5 22 20.5 36" stroke={BRAND_ORANGE} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
