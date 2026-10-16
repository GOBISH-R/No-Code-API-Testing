/**
 * Narrows the sidebar tree to what matches a search, the way Postman's filter does.
 *
 * A request matches on its name, URL or method. A collection whose own name matches is
 * kept whole — searching for a collection means you want to see inside it. Otherwise a
 * collection survives only if something in it matches, and it keeps exactly the folders
 * on the path to those matches, so every result stays where it lives in the tree.
 */
export function filterCollections(collections, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return collections;

  const matches = (text) => String(text ?? '').toLowerCase().includes(needle);
  const requestMatches = (r) => matches(r.name) || matches(r.url) || matches(r.method);

  const out = [];
  for (const collection of collections) {
    if (matches(collection.name)) {
      out.push(collection);
      continue;
    }

    const folders = collection.folders || [];
    const byId = new Map(folders.map((f) => [String(f._id), f]));
    const matchedFolders = folders.filter((f) => matches(f.name));
    const matchedFolderIds = new Set(matchedFolders.map((f) => String(f._id)));

    // A request inside a matching folder (at any depth) is shown too.
    const insideMatchedFolder = (folderId) => {
      const seen = new Set();
      let id = folderId ? String(folderId) : null;
      while (id && !seen.has(id)) {
        if (matchedFolderIds.has(id)) return true;
        seen.add(id);
        id = byId.get(id)?.parentId ? String(byId.get(id).parentId) : null;
      }
      return false;
    };

    const requests = collection.requests.filter((r) => requestMatches(r) || insideMatchedFolder(r.folderId));

    // Keep every folder on the path from the root to a kept request or matched folder.
    const keep = new Set();
    const keepAncestors = (folderId) => {
      let id = folderId ? String(folderId) : null;
      while (id && byId.has(id) && !keep.has(id)) {
        keep.add(id);
        id = byId.get(id).parentId ? String(byId.get(id).parentId) : null;
      }
    };
    requests.forEach((r) => keepAncestors(r.folderId));
    matchedFolders.forEach((f) => keepAncestors(f._id));

    if (requests.length === 0 && keep.size === 0) continue;
    out.push({ ...collection, requests, folders: folders.filter((f) => keep.has(String(f._id))) });
  }
  return out;
}
