import { exportCollection } from '../importExport/collectionExporter.js';
import { importCollection } from '../importExport/collectionImporter.js';
import { toFileName } from '../importExport/collectionFormat.js';
import { validateCollectionImport } from '../validators/importValidator.js';
import { convertOpenApiToCollection } from '../services/openapi/openApiConverter.js';
import { ValidationError } from '../utils/errors.js';
import { isValidId } from '../utils/objectId.js';
import { ownerId, actorId } from '../middleware/authenticate.js';
import { transferCollection } from '../services/collections/collectionTransfer.js';
import { ForbiddenError } from '../services/workspaces/workspaceService.js';

export async function exportCollectionHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid collection id.'));
  }

  try {
    const document = await exportCollection(ownerId(req), req.params.id);
    if (!document) {
      res.status(404);
      return next(new Error('Collection not found.'));
    }

    // Set so opening the URL directly (or curl -OJ) saves a sensibly-named file; the
    // frontend downloads via a Blob and doesn't rely on this.
    res.set('Content-Disposition', `attachment; filename="${toFileName(document.collection.name)}"`);
    res.status(200).json(document);
  } catch (err) {
    next(err);
  }
}

export async function importCollectionHandler(req, res, next) {
  const { name, ...document } = req.body || {};

  const errors = validateCollectionImport(document);
  if (errors.length > 0) {
    res.status(400);
    return next(new Error(errors.join(' ')));
  }

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    res.status(400);
    return next(new Error('name, when provided, must be a non-empty string.'));
  }

  try {
    const created = await importCollection(ownerId(req), document, { name });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}

export async function importOpenApiHandler(req, res, next) {
  const { name, text } = req.body || {};

  if (typeof text !== 'string' || !text.trim()) {
    res.status(400);
    return next(new Error('text (the raw OpenAPI/Swagger file content) is required.'));
  }

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    res.status(400);
    return next(new Error('name, when provided, must be a non-empty string.'));
  }

  try {
    // Converting produces the same portable format the native importer validates —
    // run it through that exact validation rather than trusting the converter alone.
    // The name override is applied once, at persist time, same as the native import.
    const document = convertOpenApiToCollection(text);
    const errors = validateCollectionImport(document);
    if (errors.length > 0) {
      res.status(400);
      return next(new Error(errors.join(' ')));
    }

    const created = await importCollection(ownerId(req), document, { name });
    res.status(201).json(created);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400);
      return next(err);
    }
    next(err);
  }
}

/**
 * POST /collections/:id/copy — { targetWorkspaceId: null | id, mode: 'copy' | 'move', name? }
 * The source is the workspace this request is scoped to; the target is checked here.
 */
export async function transferCollectionHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid collection id.'));
  }
  const { targetWorkspaceId = null, mode = 'copy', name } = req.body || {};
  if (targetWorkspaceId !== null && targetWorkspaceId !== '' && !isValidId(targetWorkspaceId)) {
    res.status(400);
    return next(new Error('Invalid workspace id.'));
  }
  if (name !== undefined && (typeof name !== 'string' || name.length > 200)) {
    res.status(400);
    return next(new Error('name must be text of up to 200 characters.'));
  }

  try {
    const result = await transferCollection({
      sourceScope: ownerId(req),
      sourceRole: req.scope?.role ?? 'owner',
      actorId: actorId(req),
      collectionId: req.params.id,
      targetWorkspaceId: targetWorkspaceId || null,
      mode,
      name,
    });
    if (!result) {
      res.status(404);
      return next(new Error('Collection not found.'));
    }
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof ValidationError) res.status(400);
    else if (err instanceof ForbiddenError) res.status(403);
    next(err);
  }
}
