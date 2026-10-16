import { validateEnvironment } from '../validators/environmentValidator.js';
import { ownerId } from '../middleware/authenticate.js';
import * as environmentService from '../services/environments/environmentService.js';
import { isValidId } from '../utils/objectId.js';

export async function createEnvironmentHandler(req, res, next) {
  const errors = validateEnvironment(req.body);
  if (errors.length > 0) {
    res.status(400);
    return next(new Error(errors.join(' ')));
  }

  try {
    const environment = await environmentService.createEnvironment(ownerId(req), req.body);
    res.status(201).json(environment);
  } catch (err) {
    next(err);
  }
}

export async function listEnvironmentsHandler(req, res, next) {
  try {
    const environments = await environmentService.listEnvironments(ownerId(req));
    res.status(200).json(environments);
  } catch (err) {
    next(err);
  }
}

export async function getEnvironmentHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid environment id.'));
  }

  try {
    const environment = await environmentService.getEnvironment(ownerId(req), req.params.id);
    if (!environment) {
      res.status(404);
      return next(new Error('Environment not found.'));
    }
    res.status(200).json(environment);
  } catch (err) {
    next(err);
  }
}

export async function updateEnvironmentHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid environment id.'));
  }

  const errors = validateEnvironment(req.body);
  if (errors.length > 0) {
    res.status(400);
    return next(new Error(errors.join(' ')));
  }

  try {
    const environment = await environmentService.updateEnvironment(ownerId(req), req.params.id, req.body);
    if (!environment) {
      res.status(404);
      return next(new Error('Environment not found.'));
    }
    res.status(200).json(environment);
  } catch (err) {
    next(err);
  }
}

export async function deleteEnvironmentHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid environment id.'));
  }

  try {
    const environment = await environmentService.deleteEnvironment(ownerId(req), req.params.id);
    if (!environment) {
      res.status(404);
      return next(new Error('Environment not found.'));
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
