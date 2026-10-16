import { runCollection } from '../services/runner/collectionRunner.js';
import { loadBaseVariables } from '../services/variables/variableContext.js';
import { validateDataset } from '../validators/datasetValidator.js';
import { ownerId } from '../middleware/authenticate.js';
import { ValidationError, TooBusyError } from '../utils/errors.js';
import { isValidId } from '../utils/objectId.js';

export async function runCollectionHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid collection id.'));
  }

  const { environmentId, dataset } = req.body || {};
  if (environmentId !== undefined && environmentId !== null && !isValidId(environmentId)) {
    res.status(400);
    return next(new Error('Invalid environment id.'));
  }

  try {
    // Validated here rather than trusted from the browser: these rows become variables
    // that every request in the run is resolved against.
    const rows = validateDataset(dataset);
    const variables = await loadBaseVariables(ownerId(req), environmentId);
    const run = await runCollection(ownerId(req), req.params.id, { environmentId, variables, dataset: rows });
    if (!run) {
      res.status(404);
      return next(new Error('Collection not found.'));
    }
    res.status(201).json(run);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400);
      return next(err);
    }
    if (err instanceof TooBusyError) {
      res.status(429);
      return next(err);
    }
    next(err);
  }
}
