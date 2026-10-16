import { Folder } from '../../models/Folder.js';
import { Collection } from '../../models/Collection.js';
import { Request as SavedRequest } from '../../models/Request.js';
import { owned } from '../owned.js';
import { ValidationError } from '../../utils/errors.js';

// Deep enough for any realistic API grouping, shallow enough that the sidebar stays
// readable and a looping client cannot build an unbounded chain.
const MAX_FOLDER_DEPTH = 10;

export async function listFolders(ownerId, collectionId) {
  const filter = collectionId ? { collectionId } : {};
  return owned(Folder, ownerId).find(filter).sort({ createdAt: 1 }).lean();
}

async function depthOf(ownerId, parentId) {
  let depth = 0;
  let current = parentId;

  // Walks up to the root, bounded so a corrupt chain can never spin forever.
  while (current && depth <= MAX_FOLDER_DEPTH) {
    const parent = await owned(Folder, ownerId).byId(current).select('parentId').lean();
    if (!parent) break;
    depth += 1;
    current = parent.parentId;
  }

  return depth;
}

export async function createFolder(ownerId, { collectionId, parentId = null, name }) {
  // Scoped lookup, so "that collection no longer exists" is also the honest answer for
  // a collection that exists but belongs to somebody else.
  const collection = await owned(Collection, ownerId).byId(collectionId).select('_id').lean();
  if (!collection) throw new ValidationError('That collection no longer exists.');

  if (parentId) {
    const parent = await owned(Folder, ownerId).byId(parentId).lean();
    if (!parent) throw new ValidationError('That parent folder no longer exists.');
    if (String(parent.collectionId) !== String(collectionId)) {
      throw new ValidationError('A folder cannot be nested inside a different collection.');
    }
    if ((await depthOf(ownerId, parentId)) >= MAX_FOLDER_DEPTH) {
      throw new ValidationError(`Folders cannot be nested more than ${MAX_FOLDER_DEPTH} levels deep.`);
    }
  }

  return owned(Folder, ownerId).create({ collectionId, parentId: parentId || null, name: name.trim() });
}

export async function renameFolder(ownerId, id, name) {
  return owned(Folder, ownerId).updateById(id, { name: name.trim() });
}

/**
 * Every folder at or below `id`, so a delete takes the whole subtree in one pass.
 *
 * The scan is owner-scoped: unscoped it would read every folder in the database to
 * build the parent map, and a subtree walk over other people's rows is a leak waiting
 * for one bad parentId.
 */
async function descendantIds(ownerId, id) {
  const all = await owned(Folder, ownerId).find({}).select('_id parentId').lean();
  const childrenByParent = new Map();

  for (const folder of all) {
    const key = String(folder.parentId ?? 'root');
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(String(folder._id));
  }

  const collected = [];
  const queue = [String(id)];

  while (queue.length > 0) {
    const current = queue.shift();
    collected.push(current);
    queue.push(...(childrenByParent.get(current) || []));
  }

  return collected;
}

// Mirrors deleteCollection's cascade: a folder owns what it contains, so deleting it
// removes its nested folders and every request inside them. The UI confirms first.
export async function deleteFolder(ownerId, id) {
  const folder = await owned(Folder, ownerId).byId(id).lean();
  if (!folder) return null;

  const ids = await descendantIds(ownerId, id);
  await owned(SavedRequest, ownerId).deleteMany({ folderId: { $in: ids } });
  await owned(Folder, ownerId).deleteMany({ _id: { $in: ids } });

  return folder;
}
