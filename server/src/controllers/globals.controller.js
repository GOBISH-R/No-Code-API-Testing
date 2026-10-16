import { validateGlobals } from '../validators/globalValidator.js';
import { ownerId } from '../middleware/authenticate.js';
import * as globalService from '../services/globals/globalService.js';

export async function getGlobalsHandler(req, res, next) {
  try {
    const globals = await globalService.getGlobals(ownerId(req));
    res.status(200).json(globals);
  } catch (err) {
    next(err);
  }
}

export async function updateGlobalsHandler(req, res, next) {
  const errors = validateGlobals(req.body);
  if (errors.length > 0) {
    res.status(400);
    return next(new Error(errors.join(' ')));
  }

  try {
    const globals = await globalService.updateGlobals(ownerId(req), req.body);
    res.status(200).json(globals);
  } catch (err) {
    next(err);
  }
}
