import { validateRequestConfig, validateRuntimeVariables } from '../validators/requestValidator.js';
import { ownerId } from '../middleware/authenticate.js';
import { validateAssertions } from '../validators/assertionValidator.js';
import { validateCaptures } from '../validators/captureValidator.js';
import { validateSavedRequest } from '../validators/savedRequestValidator.js';
import { executeRequest } from '../services/execution/executionEngine.js';
import { runAssertions } from '../services/assertions/assertionEngine.js';
import { runCaptures } from '../services/variables/captureEngine.js';
import * as savedRequestService from '../services/collections/savedRequestService.js';
import { resolveRequestVariables } from '../services/variables/variableContext.js';
import { ValidationError } from '../utils/errors.js';
import { isValidId } from '../utils/objectId.js';
import { recordSend } from './history.controller.js';

export async function executeRequestHandler(req, res, next) {
  const errors = [
    ...validateRequestConfig(req.body),
    ...validateAssertions(req.body.assertions),
    ...validateCaptures(req.body.captures),
    ...validateRuntimeVariables(req.body.runtimeVariables),
  ];
  if (errors.length > 0) {
    res.status(400);
    return next(new Error(errors.join(' ')));
  }

  try {
    // Precedence: global < environment < runtime (captured).
    const variables = await resolveRequestVariables(
      ownerId(req),
      req.body.environmentId,
      req.body.runtimeVariables,
    );
    const result = await executeRequest(req.body, variables);
    // Only REST and GraphQL go through here; WebSocket has its own gateway.
    await recordSend(req, result);

    const context = result.success && {
      status: result.response.status,
      headers: result.response.headers,
      body: result.response.body,
      time: result.meta.time,
    };

    const assertions = req.body.assertions;
    result.assertions =
      context && Array.isArray(assertions) && assertions.length > 0
        ? runAssertions(assertions, context, variables)
        : null;

    const captures = req.body.captures;
    result.captures =
      context && Array.isArray(captures) && captures.length > 0
        ? runCaptures(captures, context)
        : null;

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof ValidationError) {
      // Refused before it left — an unresolved variable, a blocked address. Still
      // recorded: the request as typed is exactly what the user wants back to fix it.
      await recordSend(req, { error: err.message });
      res.status(400);
      return next(err);
    }
    next(err);
  }
}

export async function createSavedRequestHandler(req, res, next) {
  const errors = validateSavedRequest(req.body);
  if (errors.length > 0) {
    res.status(400);
    return next(new Error(errors.join(' ')));
  }

  try {
    const saved = await savedRequestService.createSavedRequest(ownerId(req), req.body);
    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
}

export async function getSavedRequestHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid request id.'));
  }

  try {
    const saved = await savedRequestService.getSavedRequest(ownerId(req), req.params.id);
    if (!saved) {
      res.status(404);
      return next(new Error('Request not found.'));
    }
    res.status(200).json(saved);
  } catch (err) {
    next(err);
  }
}

export async function updateSavedRequestHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid request id.'));
  }

  const errors = validateSavedRequest(req.body, { requireCollectionId: false });
  if (errors.length > 0) {
    res.status(400);
    return next(new Error(errors.join(' ')));
  }

  try {
    const saved = await savedRequestService.updateSavedRequest(ownerId(req), req.params.id, req.body);
    if (!saved) {
      res.status(404);
      return next(new Error('Request not found.'));
    }
    res.status(200).json(saved);
  } catch (err) {
    next(err);
  }
}

export async function deleteSavedRequestHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid request id.'));
  }

  try {
    const saved = await savedRequestService.deleteSavedRequest(ownerId(req), req.params.id);
    if (!saved) {
      res.status(404);
      return next(new Error('Request not found.'));
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
