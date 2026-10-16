import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { onWorkspaceAccessLost, setWorkspace } from '../services/api.js';
import * as service from '../services/workspaceService.js';

const STORAGE_KEY = 'apiforge.workspace';

function storedId() {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function store(id) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Only a convenience: the choice is just not remembered across reloads.
  }
}

/**
 * The workspaces this person is in, which one is open, and invitations waiting for them.
 *
 * `ready` stays false until the list has loaded, so the workbench never fetches data
 * for a remembered workspace the person may since have been removed from.
 */
export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState([]);
  const [invites, setInvites] = useState([]);
  const [ready, setReady] = useState(false);
  const [requestedId, setRequestedId] = useState(storedId);
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const call = ++latest.current;
    return Promise.all([service.fetchWorkspaces(), service.fetchMyInvites()]).then(
      ([list, mine]) => {
        if (call !== latest.current) return;
        setWorkspaces(list);
        setInvites(mine);
        setReady(true);
      },
      () => {
        // Without the list, fall back to personal data rather than blocking the app.
        if (call === latest.current) setReady(true);
      },
    );
  }, []);

  useEffect(() => {
    refresh();
    // Coming back to the tab picks up a new role, a new invitation, or a removal made
    // by someone else in the meantime.
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  // A remembered or requested workspace counts only once we know we are still in it.
  const current = workspaces.find((w) => w._id === requestedId) ?? null;
  const currentId = current?._id ?? null;

  // A layout effect, so the header is set before the workbench's own effects fetch.
  useLayoutEffect(() => {
    setWorkspace(currentId);
  }, [currentId]);

  const open = useCallback((id) => {
    setRequestedId(id || null);
    store(id || null);
  }, []);

  // Removed while working: back to personal data, and a fresh list.
  useEffect(() => {
    onWorkspaceAccessLost(() => {
      open(null);
      refresh();
    });
    return () => onWorkspaceAccessLost(null);
  }, [open, refresh]);

  const create = async (name) => {
    const created = await service.createWorkspace(name);
    await refresh();
    return created;
  };

  const rename = async (id, name) => {
    await service.renameWorkspace(id, name);
    await refresh();
  };

  const remove = async (id) => {
    await service.deleteWorkspace(id);
    if (id === currentId) open(null);
    await refresh();
  };

  const leave = async (id, myUserId) => {
    await service.removeMember(id, myUserId);
    if (id === currentId) open(null);
    await refresh();
  };

  const accept = async (inviteId) => {
    const joined = await service.acceptInvite(inviteId);
    await refresh();
    return joined;
  };

  const decline = async (inviteId) => {
    await service.declineInvite(inviteId);
    await refresh();
  };

  return {
    workspaces,
    invites,
    ready,
    current,
    currentId,
    role: current?.role ?? 'owner',
    open,
    refresh,
    create,
    rename,
    remove,
    leave,
    accept,
    decline,
  };
}
