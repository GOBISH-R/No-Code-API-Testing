import { Collection } from '../../models/Collection.js';
import { Request as SavedRequest } from '../../models/Request.js';
import { Folder } from '../../models/Folder.js';
import { Monitor } from '../../models/Monitor.js';
import { owned } from '../owned.js';
import { decryptRequestSecrets } from '../security/fieldCrypto.js';

/**
 * Every function here takes the owner as its first argument.
 *
 * Deliberately first and deliberately required: a forgotten owner is a thrown error
 * from owned(), not a query that quietly returns everyone's collections.
 */

function groupBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = String(keyOf(item));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export async function createCollection(ownerId, { name, description }) {
  return owned(Collection, ownerId).create({
    name: name.trim(),
    description: description?.trim() || '',
  });
}

/**
 * Every collection with its requests and folders embedded — one round trip for the
 * sidebar. Folders and requests come back flat, each carrying its parent id, so the
 * client can still look a request up by id without walking a tree.
 */
export async function listCollections(ownerId) {
  const [collections, requests, folders] = await Promise.all([
    owned(Collection, ownerId).find().sort({ createdAt: -1 }).lean(),
    owned(SavedRequest, ownerId).find().sort({ createdAt: 1 }).lean(),
    owned(Folder, ownerId).find().sort({ createdAt: 1 }).lean(),
  ]);

  // Decrypted here because these are lean objects going straight to the owner's UI;
  // without this the auth editor would show ciphertext.
  const requestsByCollection = groupBy(requests.map(decryptRequestSecrets), (r) => r.collectionId);
  const foldersByCollection = groupBy(folders, (f) => f.collectionId);

  return collections.map((collection) => ({
    ...collection,
    requests: requestsByCollection.get(String(collection._id)) || [],
    folders: foldersByCollection.get(String(collection._id)) || [],
  }));
}

/**
 * Ordered by creation time regardless of folder: folders are organizational only, so
 * introducing one must never silently reorder an existing collection run's chain.
 *
 * The child queries are scoped by owner as well as by collectionId. That is redundant
 * while the collection lookup above already proved ownership — and it is exactly the
 * redundancy that keeps a future refactor of this function from leaking.
 */
export async function getCollectionWithRequests(ownerId, id) {
  const collection = await owned(Collection, ownerId).byId(id).lean();
  if (!collection) return null;

  const [requests, folders] = await Promise.all([
    owned(SavedRequest, ownerId).find({ collectionId: id }).sort({ createdAt: 1 }).lean(),
    owned(Folder, ownerId).find({ collectionId: id }).sort({ createdAt: 1 }).lean(),
  ]);

  return { ...collection, requests: requests.map(decryptRequestSecrets), folders };
}

export async function updateCollection(ownerId, id, { name, description }) {
  const update = {};
  if (name !== undefined) update.name = name.trim();
  if (description !== undefined) update.description = description.trim();

  return owned(Collection, ownerId).updateById(id, update);
}

/**
 * Deleting a collection also deletes its folders and saved requests — a request always
 * belongs to exactly one collection, so there is no orphan to preserve.
 */
export async function deleteCollection(ownerId, id) {
  const collection = await owned(Collection, ownerId).deleteById(id);
  if (collection) {
    await Promise.all([
      owned(SavedRequest, ownerId).deleteMany({ collectionId: id }),
      owned(Folder, ownerId).deleteMany({ collectionId: id }),
      owned(Monitor, ownerId).deleteMany({ collectionId: id }),
    ]);
  }
  return collection;
}
