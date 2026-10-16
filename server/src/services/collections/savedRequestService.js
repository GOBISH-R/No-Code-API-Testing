import { Request as SavedRequest } from '../../models/Request.js';
import { owned } from '../owned.js';
import { encryptRequestSecrets, decryptRequestSecrets } from '../security/fieldCrypto.js';

// Every top-level field a saved request has must be listed here. A field present on
// the model but missing from this destructure is silently dropped on every save —
// which has bitten this project before (protocol/graphql), so treat adding a new
// request field and adding it here as one inseparable change.
// Exported so a test can hold it against the model's own field list; nothing else
// should call it directly.
export function documentFields(payload) {
  const {
    collectionId,
    folderId,
    name,
    protocol,
    method,
    url,
    params,
    headers,
    body,
    graphql,
    websocket,
    auth,
    assertions,
    captures,
  } = payload;
  const fields = {
    name,
    protocol,
    method,
    url,
    params,
    headers,
    body,
    graphql,
    websocket,
    auth,
    assertions,
    captures,
  };
  if (collectionId !== undefined) fields.collectionId = collectionId;
  // Explicitly settable to null, which is how a request is moved back to the root.
  if (folderId !== undefined) fields.folderId = folderId || null;
  return fields;
}

export async function createSavedRequest(ownerId, payload) {
  const saved = await owned(SavedRequest, ownerId).create(
    encryptRequestSecrets(documentFields(payload)),
  );
  // Returned decrypted: the caller is the owner, and the UI echoes this straight back
  // into the auth editor.
  return decryptRequestSecrets(saved.toObject());
}

// Bulk insert for imports. Every read path orders requests by createdAt, and a plain
// bulk insert would stamp them all with the same millisecond — leaving the order of an
// imported collection (which the runner executes in, and chaining depends on)
// undefined. Spacing createdAt by index keeps the file's order authoritative.
export async function createSavedRequests(ownerId, collectionId, requests) {
  const base = Date.now();
  const documents = requests.map((request, index) => ({
    ...documentFields({ ...request, collectionId }),
    createdAt: new Date(base + index),
  }));

  return owned(SavedRequest, ownerId).insertMany(documents.map(encryptRequestSecrets));
}

export async function getSavedRequest(ownerId, id) {
  return decryptRequestSecrets(await owned(SavedRequest, ownerId).byId(id).lean());
}

export async function updateSavedRequest(ownerId, id, payload) {
  const saved = await owned(SavedRequest, ownerId).updateById(
    id,
    encryptRequestSecrets(documentFields(payload)),
  );
  return saved ? decryptRequestSecrets(saved.toObject()) : saved;
}

export async function deleteSavedRequest(ownerId, id) {
  return owned(SavedRequest, ownerId).deleteById(id);
}
