import * as collectionService from '../services/collections/collectionService.js';
import * as savedRequestService from '../services/collections/savedRequestService.js';
import * as folderService from '../services/collections/folderService.js';
import { FOLDER_PATH_SEPARATOR } from './collectionFormat.js';

// Recreates the folder tree the export recorded as "Parent/Child" paths, creating each
// segment once and returning a path -> folderId map. A file with no folderPath
// anywhere (including any export written before folders existed) creates no folders.
async function createFolderTree(ownerId, collectionId, requests) {
  const paths = new Set();

  for (const request of requests) {
    const path = typeof request.folderPath === 'string' ? request.folderPath.trim() : '';
    if (!path) continue;

    // Register every ancestor too, so "A/B/C" creates A, then A/B, then A/B/C.
    const segments = path.split(FOLDER_PATH_SEPARATOR).filter((s) => s.trim());
    for (let i = 1; i <= segments.length; i += 1) {
      paths.add(segments.slice(0, i).join(FOLDER_PATH_SEPARATOR));
    }
  }

  // Shortest first, so a parent always exists before the child that references it.
  const ordered = [...paths].sort((a, b) => a.split(FOLDER_PATH_SEPARATOR).length - b.split(FOLDER_PATH_SEPARATOR).length);
  const idByPath = new Map();

  for (const path of ordered) {
    const segments = path.split(FOLDER_PATH_SEPARATOR);
    const name = segments[segments.length - 1];
    const parentPath = segments.slice(0, -1).join(FOLDER_PATH_SEPARATOR);

    const folder = await folderService.createFolder(ownerId, {
      collectionId,
      parentId: parentPath ? idByPath.get(parentPath) : null,
      name,
    });

    idByPath.set(path, folder._id);
  }

  return idByPath;
}

/**
 * Persists a validated import document as a brand-new collection.
 *
 * The document is expected to have passed validateCollectionImport already — this
 * only handles persistence. An import is all-or-nothing: if the folders or requests
 * fail to insert, the collection created a moment earlier is removed rather than left
 * behind as an empty shell. Everything is created in `ownerId`'s account.
 */
export async function importCollection(ownerId, document, { name } = {}) {
  const source = document.collection;
  const collection = await collectionService.createCollection(ownerId, {
    name: name?.trim() || source.name,
    description: source.description || '',
  });

  if (source.requests.length === 0) {
    return { ...collection.toObject(), requests: [], folders: [] };
  }

  try {
    const idByPath = await createFolderTree(ownerId, collection._id, source.requests);

    const requests = await savedRequestService.createSavedRequests(
      ownerId,
      collection._id,
      source.requests.map((request) => ({
        ...request,
        folderId: request.folderPath ? idByPath.get(request.folderPath.trim()) || null : null,
      })),
    );

    const folders = await folderService.listFolders(ownerId, collection._id);
    return { ...collection.toObject(), requests, folders };
  } catch (err) {
    // deleteCollection cascades to any folders/requests created before the failure.
    await collectionService.deleteCollection(ownerId, collection._id);
    throw err;
  }
}
