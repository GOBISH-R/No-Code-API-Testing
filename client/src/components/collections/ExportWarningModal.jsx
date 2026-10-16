import { describeSecrets } from '../../utils/exportSecrets.js';
import './collections.css';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

const MAX_NAMED_REQUESTS = 5;

/**
 * Confirms an export that contains credentials.
 *
 * Not a blocker — including credentials is what makes a re-imported collection work.
 * The point is that the file becomes a secret at the moment it is written, and people
 * attach export files to tickets and commit them, so that should be a decision rather
 * than a surprise.
 */
export default function ExportWarningModal({ pendingExport, onConfirm, onCancel }) {
  useEscapeToClose(onCancel);
  if (!pendingExport) return null;

  const { fileName, secrets } = pendingExport;
  const extra = secrets.requestNames.length - MAX_NAMED_REQUESTS;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div role="dialog" aria-modal="true" className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">Export contains credentials</h3>

        <p className="export-warning__lead">
          <code>{fileName}</code> will include {describeSecrets(secrets)} saved on{' '}
          {secrets.requestCount} request{secrets.requestCount === 1 ? '' : 's'}.
        </p>

        <ul className="export-warning__requests">
          {secrets.requestNames.slice(0, MAX_NAMED_REQUESTS).map((name, i) => (
            <li key={`${name}-${i}`}>{name}</li>
          ))}
          {extra > 0 && <li className="export-warning__more">…and {extra} more</li>}
        </ul>

        <p className="export-warning__note">
          They are kept so the collection still works when it is imported again. Treat the
          file as a secret — do not attach it to a ticket or commit it to a repository.
        </p>

        <div className="modal__actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="modal__confirm" onClick={onConfirm}>
            Export anyway
          </button>
        </div>
      </div>
    </div>
  );
}
