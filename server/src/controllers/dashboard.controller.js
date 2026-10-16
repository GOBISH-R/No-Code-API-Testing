import { getDashboardSummary } from '../services/runner/dashboardService.js';
import { ownerId } from '../middleware/authenticate.js';
import { isValidId } from '../utils/objectId.js';

export async function getDashboardHandler(req, res, next) {
  const { collectionId } = req.query;

  if (collectionId !== undefined && !isValidId(collectionId)) {
    res.status(400);
    return next(new Error('Invalid collection id.'));
  }

  try {
    const summary = await getDashboardSummary(ownerId(req), { collectionId });
    res.status(200).json(summary);
  } catch (err) {
    next(err);
  }
}
