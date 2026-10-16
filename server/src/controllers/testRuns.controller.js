import * as testRunService from '../services/runner/testRunService.js';
import { ownerId } from '../middleware/authenticate.js';
import { isValidId } from '../utils/objectId.js';

export async function listTestRunsHandler(req, res, next) {
  const { collectionId, monitorId, limit } = req.query;

  if (collectionId !== undefined && !isValidId(collectionId)) {
    res.status(400);
    return next(new Error('Invalid collection id.'));
  }
  if (monitorId !== undefined && !isValidId(monitorId)) {
    res.status(400);
    return next(new Error('Invalid monitor id.'));
  }

  try {
    const runs = await testRunService.listTestRuns(ownerId(req), { collectionId, monitorId, limit });
    res.status(200).json(runs);
  } catch (err) {
    next(err);
  }
}

export async function getTestRunHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid test run id.'));
  }

  try {
    const run = await testRunService.getTestRun(ownerId(req), req.params.id);
    if (!run) {
      res.status(404);
      return next(new Error('Test run not found.'));
    }
    res.status(200).json(run);
  } catch (err) {
    next(err);
  }
}
