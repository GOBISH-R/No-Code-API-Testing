/**
 * The large round red cross at the top of a status page — "Couldn't verify just now".
 * Decorative: the heading beside it says the same thing in words.
 */
export default function StatusIcon() {
  return (
    <span className="status-icon status-icon--failed" aria-hidden="true">
      <svg viewBox="0 0 48 48" width="30" height="30">
        <path className="status-icon__draw" d="M16 16l16 16M32 16L16 32" />
      </svg>
    </span>
  );
}
