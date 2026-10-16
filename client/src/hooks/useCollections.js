import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchCollections,
  createCollection as apiCreateCollection,
  updateCollection as apiUpdateCollection,
  deleteCollection as apiDeleteCollection,
} from '../services/collectionService.js';
import {
  deleteSavedRequest as apiDeleteSavedRequest,
  updateSavedRequest as apiUpdateSavedRequest,
} from '../services/savedRequestService.js';
import {
  createFolder as apiCreateFolder,
  renameFolder as apiRenameFolder,
  deleteFolder as apiDeleteFolder,
} from '../services/folderService.js';

function messageFor(err, fallback) {
  return err.response?.data?.message || err.message || fallback;
}

export function useCollections({ onRemoved } = {}) {
  const [collections, setCollections] = useState([]);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);

  // A refresh keeps the current list on screen rather than flipping back to 'loading'
  // (which flashed "Loading…" after every save), and only the newest request may
  // update state — a slow earlier response must not overwrite a newer one.
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const call = ++latest.current;
    return fetchCollections().then(
      (data) => {
        // A newer refresh is under way; its answer is the one that counts.
        if (call !== latest.current) return data;
        setCollections(data);
        setError(null);
        setStatus('ready');
        return data;
      },
      (err) => {
        if (call === latest.current) {
          setError(messageFor(err, 'Failed to load collections.'));
          setStatus('error');
        }
        return null;
      },
    );
  }, []);

  // After anything that deletes requests — directly, or with the folder or collection
  // that held them — the caller learns what still exists, so a request that is open in
  // the builder but no longer in the database can be closed rather than left editable.
  const refreshAfterRemoval = async () => {
    const data = await refresh();
    if (data) onRemoved?.(new Set(data.flatMap((c) => c.requests.map((r) => String(r._id)))));
  };

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Sidebar actions are secondary/infrequent — a simple alert is enough feedback on
  // failure without building a full inline error UI for each one.
  const createCollection = async (name) => {
    try {
      await apiCreateCollection({ name });
      await refresh();
    } catch (err) {
      window.alert(messageFor(err, 'Failed to create the collection.'));
    }
  };

  const renameCollection = async (id, name) => {
    try {
      await apiUpdateCollection(id, { name });
      await refresh();
    } catch (err) {
      window.alert(messageFor(err, 'Failed to rename the collection.'));
    }
  };

  const deleteCollection = async (id) => {
    try {
      await apiDeleteCollection(id);
      await refreshAfterRemoval();
    } catch (err) {
      window.alert(messageFor(err, 'Failed to delete the collection.'));
    }
  };

  const deleteRequest = async (id) => {
    try {
      await apiDeleteSavedRequest(id);
      await refreshAfterRemoval();
    } catch (err) {
      window.alert(messageFor(err, 'Failed to delete the request.'));
    }
  };

  const createFolder = async ({ collectionId, parentId = null, name }) => {
    try {
      await apiCreateFolder({ collectionId, parentId, name });
      await refresh();
    } catch (err) {
      window.alert(messageFor(err, 'Failed to create the folder.'));
    }
  };

  const renameFolder = async (id, name) => {
    try {
      await apiRenameFolder(id, name);
      await refresh();
    } catch (err) {
      window.alert(messageFor(err, 'Failed to rename the folder.'));
    }
  };

  const deleteFolder = async (id) => {
    try {
      await apiDeleteFolder(id);
      await refreshAfterRemoval();
    } catch (err) {
      window.alert(messageFor(err, 'Failed to delete the folder.'));
    }
  };

  // The update endpoint validates a whole request (a partial patch would fail its
  // "name is required" rule), so a move re-sends the request it already has with only
  // folderId changed — no separate move endpoint needed.
  const moveRequest = async (request, folderId) => {
    try {
      await apiUpdateSavedRequest(request._id, { ...request, folderId: folderId || null });
      await refresh();
    } catch (err) {
      window.alert(messageFor(err, 'Failed to move the request.'));
    }
  };

  return {
    collections,
    status,
    error,
    refresh,
    createCollection,
    renameCollection,
    deleteCollection,
    deleteRequest,
    createFolder,
    renameFolder,
    deleteFolder,
    moveRequest,
  };
}
