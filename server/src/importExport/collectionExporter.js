import { getCollectionWithRequests } from '../services/collections/collectionService.js';
import { FORMAT, VERSION, FOLDER_PATH_SEPARATOR, toPortableRequest } from './collectionFormat.js';

// folderId -> "Parent/Child" path, so each request can record where it lives without
// the export carrying any database ids.
function buildFolderPaths(folders) {
  const byId = new Map(folders.map((folder) => [String(folder._id), folder]));
  const paths = new Map();

  const pathFor = (id, seen = new Set()) => {
    const key = String(id);
    if (paths.has(key)) return paths.get(key);

    const folder = byId.get(key);
    // A missing parent (or a cycle, which the model prevents but which a hand-edited
    // database could still produce) degrades to a root-level path rather than looping.
    if (!folder || seen.has(key)) return '';

    seen.add(key);
    const parentPath = folder.parentId ? pathFor(folder.parentId, seen) : '';
    const full = parentPath ? `${parentPath}${FOLDER_PATH_SEPARATOR}${folder.name}` : folder.name;

    paths.set(key, full);
    return full;
  };

  for (const folder of folders) pathFor(folder._id);
  return paths;
}

// Builds the portable export document for one collection. Reuses the existing
// collection service rather than querying models directly.
// Owner-scoped like every other read: a collection id from somebody else's account
// is simply not found, never exported.
export async function exportCollection(ownerId, collectionId) {
  const collection = await getCollectionWithRequests(ownerId, collectionId);
  if (!collection) return null;

  const folderPaths = buildFolderPaths(collection.folders || []);

  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    collection: {
      name: collection.name,
      description: collection.description || '',
      requests: collection.requests.map((request) =>
        toPortableRequest(request, request.folderId ? folderPaths.get(String(request.folderId)) || '' : ''),
      ),
    },
  };
}
