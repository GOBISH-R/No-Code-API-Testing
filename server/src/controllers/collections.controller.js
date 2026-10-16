import { validateCollection } from '../validators/collectionValidator.js';
import { ownerId } from '../middleware/authenticate.js';
import * as collectionService from '../services/collections/collectionService.js';
import { isValidId } from '../utils/objectId.js';

export async function createCollectionHandler(req, res, next) {
  const errors = validateCollection(req.body);
  if (errors.length > 0) {
    res.status(400);
    return next(new Error(errors.join(' ')));
  }

  try {
    const collection = await collectionService.createCollection(ownerId(req), req.body);
    res.status(201).json(collection);
  } catch (err) {
    next(err);
  }
}

export async function listCollectionsHandler(req, res, next) {
  try {
    const collections = await collectionService.listCollections(ownerId(req));
    res.status(200).json(collections);
  } catch (err) {
    next(err);
  }
}

export async function getCollectionHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid collection id.'));
  }

  try {
    const collection = await collectionService.getCollectionWithRequests(ownerId(req), req.params.id);
    if (!collection) {
      res.status(404);
      return next(new Error('Collection not found.'));
    }
    res.status(200).json(collection);
  } catch (err) {
    next(err);
  }
}

export async function updateCollectionHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid collection id.'));
  }

  const errors = validateCollection(req.body);
  if (errors.length > 0) {
    res.status(400);
    return next(new Error(errors.join(' ')));
  }

  try {
    const collection = await collectionService.updateCollection(ownerId(req), req.params.id, req.body);
    if (!collection) {
      res.status(404);
      return next(new Error('Collection not found.'));
    }
    res.status(200).json(collection);
  } catch (err) {
    next(err);
  }
}

export async function deleteCollectionHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid collection id.'));
  }

  try {
    const collection = await collectionService.deleteCollection(ownerId(req), req.params.id);
    if (!collection) {
      res.status(404);
      return next(new Error('Collection not found.'));
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
