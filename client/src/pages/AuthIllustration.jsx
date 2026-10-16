/**
 * The line-art picture on the sign-in and sign-up pages: a request window sending a
 * GET, the 200 OK that came back, a card of passing tests and a response-time gauge.
 *
 * Drawn here rather than shipped as an image so it follows the light and dark themes —
 * every colour is a CSS variable — and costs no extra request. Purely decorative, so
 * it is hidden from screen readers.
 */
export default function AuthIllustration() {
  return (
    <svg className="auth-art" viewBox="0 0 460 330" aria-hidden="true" focusable="false">
      {/* Soft glow behind everything. */}
      <circle cx="245" cy="180" r="140" className="auth-art__glow" />

      {/* Request window. */}
      <g className="auth-art__float auth-art__float--slow">
        <rect x="70" y="60" width="280" height="190" rx="12" className="auth-art__card" />
        <circle cx="90" cy="80" r="4" className="auth-art__dot" />
        <circle cx="104" cy="80" r="4" className="auth-art__dot" />
        <circle cx="118" cy="80" r="4" className="auth-art__dot" />
        <line x1="70" y1="96" x2="350" y2="96" className="auth-art__rule" />

        <rect x="88" y="110" width="38" height="20" rx="4" className="auth-art__accent" />
        <text x="107" y="124" textAnchor="middle" className="auth-art__badge">
          GET
        </text>
        <rect x="132" y="110" width="160" height="20" rx="4" className="auth-art__field" />
        <line x1="142" y1="120" x2="252" y2="120" className="auth-art__text-line" />
        <rect x="298" y="110" width="38" height="20" rx="4" className="auth-art__accent auth-art__accent--soft" />

        <line x1="88" y1="148" x2="114" y2="148" className="auth-art__tab-active" />
        <line x1="124" y1="148" x2="146" y2="148" className="auth-art__text-line" />
        <line x1="156" y1="148" x2="176" y2="148" className="auth-art__text-line" />

        <text x="88" y="178" className="auth-art__code">
          {'{'}
        </text>
        <line x1="104" y1="188" x2="210" y2="188" className="auth-art__text-line" />
        <line x1="104" y1="204" x2="240" y2="204" className="auth-art__text-line" />
        <line x1="104" y1="220" x2="180" y2="220" className="auth-art__text-line" />
        <text x="88" y="240" className="auth-art__code">
          {'}'}
        </text>
      </g>

      {/* Passing tests. */}
      <g className="auth-art__float">
        <rect x="318" y="26" width="118" height="64" rx="10" className="auth-art__card" />
        <circle cx="338" cy="47" r="7" className="auth-art__ok" />
        <path d="M334.5 47l2.4 2.4 4.6-4.6" className="auth-art__tick" />
        <line x1="352" y1="47" x2="418" y2="47" className="auth-art__text-line" />
        <circle cx="338" cy="69" r="7" className="auth-art__ok" />
        <path d="M334.5 69l2.4 2.4 4.6-4.6" className="auth-art__tick" />
        <line x1="352" y1="69" x2="404" y2="69" className="auth-art__text-line" />
      </g>

      {/* The response. */}
      <g className="auth-art__float auth-art__float--late">
        <rect x="262" y="178" width="160" height="112" rx="10" className="auth-art__card" />
        <circle cx="290" cy="206" r="13" className="auth-art__ok" />
        <path d="M284 206l4 4 8-8" className="auth-art__tick auth-art__tick--big" />
        <text x="312" y="211" className="auth-art__status">
          200 OK
        </text>
        <line x1="280" y1="236" x2="402" y2="236" className="auth-art__text-line" />
        <line x1="280" y1="252" x2="384" y2="252" className="auth-art__text-line" />
        <line x1="280" y1="268" x2="352" y2="268" className="auth-art__text-line" />
      </g>

      {/* Response-time gauge. */}
      <g className="auth-art__float auth-art__float--slow">
        <rect x="22" y="206" width="112" height="84" rx="10" className="auth-art__card" />
        <path d="M44 272a34 34 0 0 1 68 0" className="auth-art__gauge-track" />
        <path d="M44 272a34 34 0 0 1 57-25" className="auth-art__gauge" />
        <line x1="78" y1="272" x2="96" y2="254" className="auth-art__needle" />
        <circle cx="78" cy="272" r="3.5" className="auth-art__accent" />
      </g>

      {/* Sparkles. */}
      <path d="M40 70l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" className="auth-art__spark" />
      <path d="M438 146l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" className="auth-art__spark" />
      <circle cx="170" cy="30" r="3" className="auth-art__speck" />
      <circle cx="30" cy="160" r="2.5" className="auth-art__speck" />
      <circle cx="444" cy="300" r="3" className="auth-art__speck" />
    </svg>
  );
}
