import { validateFolder } from '../validators/folderValidator.js';
import { ownerId } from '../middleware/authenticate.js';
import * as folderService from '../services/collections/folderService.js';
import { ValidationError } from '../utils/errors.js';
import { isValidId } from '../utils/objectId.js';

export async function listFoldersHandler(req, res, next) {
  const { collectionId } = req.query;
  if (collectionId !== undefined && !isValidId(collectionId)) {
    res.status(400);
    return next(new Error('Invalid collection id.'));
  }

  try {
    res.status(200).json(await folderService.listFolders(ownerId(req), collectionId));
  } catch (err) {
    next(err);
  }
}

export async function createFolderHandler(req, res, next) {
  const errors = validateFolder(req.body);
  if (errors.length > 0) {
    res.status(400);
    return next(new Error(errors.join(' ')));
  }

  try {
    const folder = await folderService.createFolder(ownerId(req), req.body);
    res.status(201).json(folder);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400);
      return next(err);
    }
    next(err);
  }
}

export async function updateFolderHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid folder id.'));
  }

  const errors = validateFolder(req.body, { requireCollectionId: false });
  if (errors.length > 0) {
    res.status(400);
    return next(new Error(errors.join(' ')));
  }

  try {
    const folder = await folderService.renameFolder(ownerId(req), req.params.id, req.body.name);
    if (!folder) {
      res.status(404);
      return next(new Error('Folder not found.'));
    }
    res.status(200).json(folder);
  } catch (err) {
    next(err);
  }
}

export async function deleteFolderHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid folder id.'));
  }

  try {
    const folder = await folderService.deleteFolder(ownerId(req), req.params.id);
    if (!folder) {
      res.status(404);
      return next(new Error('Folder not found.'));
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
