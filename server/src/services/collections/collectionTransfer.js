import { exportCollection } from '../../importExport/collectionExporter.js';
import { importCollection } from '../../importExport/collectionImporter.js';
import { validateCollectionImport } from '../../validators/importValidator.js';
import { membership, ForbiddenError } from '../workspaces/workspaceService.js';
import { deleteCollection } from './collectionService.js';
import { ValidationError } from '../../utils/errors.js';

/**
 * Copies or moves a collection between the person's own space and team workspaces.
 *
 * Goes through the export/import pipeline rather than copying documents directly: the
 * copy is validated exactly like an imported file, gets fresh ids, keeps its folders and
 * order, and its credentials are re-encrypted for the destination. Nothing about the
 * source's ids or owner can leak into the destination.
 *
 * @param {object} p
 * @param {*} p.sourceScope   owner id the collection lives under (already authorised)
 * @param {string} p.sourceRole the caller's role there — a viewer may copy, not move
 * @param {*} p.actorId       the signed-in person
 * @param {string|null} p.targetWorkspaceId null for the person's own space
 */
export async function transferCollection({ sourceScope, sourceRole, actorId, collectionId, targetWorkspaceId, mode, name }) {
  if (!['copy', 'move'].includes(mode)) throw new ValidationError('mode must be copy or move.');

  let targetScope = actorId;
  if (targetWorkspaceId) {
    const found = await membership(actorId, targetWorkspaceId);
    if (!found) throw new ValidationError('That workspace does not exist, or you are not in it.');
    if (found.role === 'viewer') throw new ForbiddenError('You are a viewer in that workspace, so you cannot add to it.');
    targetScope = found.workspace._id;
  }

  const sameSpace = String(targetScope) === String(sourceScope);
  if (mode === 'move') {
    if (sourceRole === 'viewer') throw new ForbiddenError('You are a viewer here, so you can copy this collection but not move it.');
    if (sameSpace) throw new ValidationError('It is already here. Choose another workspace to move it to.');
  }

  const document = await exportCollection(sourceScope, collectionId);
  if (!document) return null;
  const errors = validateCollectionImport(document);
  if (errors.length > 0) throw new ValidationError(errors.join(' '));

  const newName = name?.trim() || (sameSpace ? `${document.collection.name} (copy)` : document.collection.name);
  const created = await importCollection(targetScope, document, { name: newName });

  // Only once the copy exists does the original go — a failed copy loses nothing.
  if (mode === 'move') await deleteCollection(sourceScope, collectionId);

  return { collection: { _id: created._id, name: created.name }, targetWorkspaceId: targetWorkspaceId || null, mode };
}
