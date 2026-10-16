import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/authContext.js';
import * as service from '../../services/workspaceService.js';
import { fromNow } from '../../utils/relativeTime.js';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

const ROLE_LABEL = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };
const ROLE_HELP = {
  editor: 'Editors can add and change collections, environments and monitors.',
  viewer: 'Viewers can open, send and run requests, but not change anything.',
};

function errorMessage(err, fallback) {
  return err.response?.data?.message || err.message || fallback;
}

/**
 * Team workspaces: create them, answer invitations, and — for the owner — invite people,
 * set their role and remove them. Everything is enforced by the server; this window only
 * offers what the person's role allows, so they are not shown buttons that would fail.
 */
export default function WorkspacesModal({ workspacesState, onClose }) {
  useEscapeToClose(onClose);
  const { user } = useAuth();
  const { workspaces, invites, currentId } = workspacesState;
  const [selectedId, setSelectedId] = useState(() => currentId ?? workspaces[0]?._id ?? null);
  const [details, setDetails] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [rename, setRename] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const latest = useRef(0);

  const selected = workspaces.find((w) => w._id === selectedId) ?? null;
  const isOwner = selected?.role === 'owner';

  const loadDetails = useCallback((id) => {
    const call = ++latest.current;
    if (!id) return Promise.resolve();
    return service.fetchMembers(id).then(
      (data) => {
        if (call !== latest.current) return;
        setDetails(data);
        setRename(data.workspace.name);
      },
      (err) => {
        if (call === latest.current) setError(errorMessage(err, 'Could not load the workspace.'));
      },
    );
  }, []);

  useEffect(() => {
    loadDetails(selectedId);
  }, [selectedId, loadDetails]);

  // Runs an action, then reports how it went.
  const run = async (fn, { success, failure, after } = {}) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      if (success) setNotice(typeof success === 'function' ? success(result) : success);
      await after?.(result);
      return result;
    } catch (err) {
      setError(errorMessage(err, failure || 'That did not work.'));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const select = (id) => {
    setSelectedId(id);
    setDetails(null);
    setError(null);
    setNotice(null);
  };

  const createWorkspace = (e) => {
    e.preventDefault();
    run(() => workspacesState.create(newName.trim()), {
      failure: 'The workspace could not be created.',
      after: (created) => {
        setNewName('');
        select(created._id);
      },
    });
  };

  const sendInvite = (e) => {
    e.preventDefault();
    run(() => service.inviteMember(selectedId, inviteEmail.trim(), inviteRole), {
      success: (invite) => `Invitation sent to ${invite.email}.`,
      failure: 'The invitation could not be sent.',
      after: () => {
        setInviteEmail('');
        return loadDetails(selectedId);
      },
    });
  };

  const deleteWorkspace = () => {
    if (!window.confirm(`Delete “${selected.name}” and everything in it — its collections, environments, runs and monitors — for every member? This cannot be undone.`)) return;
    run(() => workspacesState.remove(selectedId), {
      failure: 'The workspace could not be deleted.',
      after: () => select(workspaces.find((w) => w._id !== selectedId)?._id ?? null),
    });
  };

  const leaveWorkspace = () => {
    if (!window.confirm(`Leave “${selected.name}”? You will lose access until someone invites you again.`)) return;
    run(() => workspacesState.leave(selectedId, user.id), {
      failure: 'Could not leave the workspace.',
      after: () => select(null),
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ws-title"
        className="modal modal--wide ws-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="ws-title" className="modal__title">Team workspaces</h3>
        <p className="ws-modal__lead">
          Share collections, environments, runs and monitors with your team. Your request history and
          mocks always stay private.
        </p>

        {invites.length > 0 && (
          <section className="ws-invites" aria-label="Invitations">
            {invites.map((invite) => (
              <div key={invite._id} className="ws-invite">
                <span>
                  <strong>{invite.invitedBy}</strong> invited you to <strong>{invite.workspaceName}</strong> as{' '}
                  {invite.role === 'editor' ? 'an editor' : 'a viewer'}.
                </span>
                <span className="ws-invite__actions">
                  <button type="button" disabled={busy}
                    onClick={() => run(() => workspacesState.decline(invite._id), { failure: 'Could not decline.' })}>
                    Decline
                  </button>
                  <button type="button" className="modal__confirm" disabled={busy}
                    onClick={() => run(() => workspacesState.accept(invite._id), {
                      success: (joined) => `You joined “${joined.name}”.`,
                      failure: 'Could not accept the invitation.',
                      // Straight into the workspace just joined.
                      after: (joined) => workspacesState.open(joined._id),
                    })}>
                    Accept
                  </button>
                </span>
              </div>
            ))}
          </section>
        )}

        {error && <p className="modal__error">{error}</p>}
        {notice && <p className="ws-modal__notice">{notice}</p>}

        <div className="ws-layout">
          <aside className="ws-list">
            {workspaces.length === 0 && <p className="ws-muted">No team workspaces yet.</p>}
            {workspaces.map((w) => (
              <button
                key={w._id}
                type="button"
                className={`ws-list__item ${w._id === selectedId ? 'ws-list__item--active' : ''}`}
                onClick={() => select(w._id)}
              >
                <span className="ws-list__name">{w.name}</span>
                <span className="ws-list__meta">
                  {ROLE_LABEL[w.role]} · {w.memberCount} {w.memberCount === 1 ? 'person' : 'people'}
                  {w._id === currentId && ' · open'}
                </span>
              </button>
            ))}
            <form className="ws-new" onSubmit={createWorkspace}>
              <input
                type="text"
                value={newName}
                maxLength={60}
                placeholder="New workspace name"
                aria-label="New workspace name"
                onChange={(e) => setNewName(e.target.value)}
              />
              <button type="submit" disabled={busy || !newName.trim()}>Create</button>
            </form>
          </aside>

          <section className="ws-detail">
            {!selected && (
              <p className="ws-muted">
                Create a workspace for your team, then invite people by email. Anything you create while it is
                open — collections, environments, monitors — belongs to the team.
              </p>
            )}

            {selected && (
              <>
                <div className="ws-detail__head">
                  {isOwner ? (
                    <form className="ws-rename" onSubmit={(e) => {
                      e.preventDefault();
                      run(() => workspacesState.rename(selectedId, rename.trim()), {
                        success: 'Renamed.',
                        failure: 'Could not rename the workspace.',
                      });
                    }}>
                      <input type="text" value={rename} maxLength={60} aria-label="Workspace name"
                        onChange={(e) => setRename(e.target.value)} />
                      {rename.trim() && rename.trim() !== selected.name && (
                        <button type="submit" disabled={busy}>Save name</button>
                      )}
                    </form>
                  ) : (
                    <h4 className="ws-detail__name">{selected.name}</h4>
                  )}
                  {selected._id === currentId ? (
                    <span className="ws-chip">Open now</span>
                  ) : (
                    <button type="button" className="modal__confirm" onClick={() => {
                      workspacesState.open(selected._id);
                      onClose();
                    }}>
                      Open workspace
                    </button>
                  )}
                </div>

                <h5 className="ws-section">People</h5>
                <ul className="ws-members">
                  {(details?.members ?? []).map((m) => {
                    const isMe = String(m.userId) === user?.id;
                    return (
                      <li key={m.userId} className="ws-member">
                        <span className="ws-member__who">
                          <span className="ws-member__name">{m.name}{isMe && ' (you)'}</span>
                          <span className="ws-member__email">{m.email}</span>
                        </span>
                        {isOwner && m.role !== 'owner' ? (
                          <>
                            <select value={m.role} aria-label={`Role for ${m.name}`} disabled={busy}
                              onChange={(e) => run(() => service.changeRole(selectedId, m.userId, e.target.value), {
                                success: `${m.name} is now ${e.target.value === 'editor' ? 'an editor' : 'a viewer'}.`,
                                failure: 'Could not change the role.',
                                after: () => loadDetails(selectedId),
                              })}>
                              <option value="editor">Editor</option>
                              <option value="viewer">Viewer</option>
                            </select>
                            <button type="button" className="ws-danger-link" disabled={busy}
                              onClick={() => window.confirm(`Remove ${m.name} from “${selected.name}”?`) &&
                                run(() => service.removeMember(selectedId, m.userId), {
                                  success: `${m.name} was removed.`,
                                  failure: 'Could not remove them.',
                                  after: async () => {
                                    await loadDetails(selectedId);
                                    await workspacesState.refresh();
                                  },
                                })}>
                              Remove
                            </button>
                          </>
                        ) : (
                          <span className="ws-chip">{ROLE_LABEL[m.role]}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {isOwner && (
                  <>
                    <h5 className="ws-section">Invite someone</h5>
                    <form className="ws-invite-form" onSubmit={sendInvite}>
                      <input type="email" required value={inviteEmail} placeholder="teammate@example.com"
                        aria-label="Email to invite" onChange={(e) => setInviteEmail(e.target.value)} />
                      <select value={inviteRole} aria-label="Role" onChange={(e) => setInviteRole(e.target.value)}>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button type="submit" className="modal__confirm" disabled={busy || !inviteEmail.trim()}>Invite</button>
                    </form>
                    <p className="ws-muted ws-help">
                      {ROLE_HELP[inviteRole]} They accept by signing in to ApIForge with that address — an account can be
                      created with it if they have none.
                    </p>

                    {details?.invites?.length > 0 && (
                      <ul className="ws-members">
                        {details.invites.map((invite) => (
                          <li key={invite._id} className="ws-member ws-member--pending">
                            <span className="ws-member__who">
                              <span className="ws-member__name">{invite.email}</span>
                              <span className="ws-member__email">
                                Invited as {ROLE_LABEL[invite.role].toLowerCase()} · expires {fromNow(invite.expiresAt)}
                              </span>
                            </span>
                            <button type="button" className="ws-danger-link" disabled={busy}
                              onClick={() => run(() => service.revokeInvite(selectedId, invite._id), {
                                success: `Invitation to ${invite.email} withdrawn.`,
                                failure: 'Could not withdraw the invitation.',
                                after: () => loadDetails(selectedId),
                              })}>
                              Withdraw
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}

                <div className="ws-danger">
                  {isOwner ? (
                    <button type="button" className="ws-danger__btn" onClick={deleteWorkspace} disabled={busy}>
                      Delete workspace
                    </button>
                  ) : (
                    <button type="button" className="ws-danger__btn" onClick={leaveWorkspace} disabled={busy}>
                      Leave workspace
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        </div>

        <div className="modal__actions">
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
