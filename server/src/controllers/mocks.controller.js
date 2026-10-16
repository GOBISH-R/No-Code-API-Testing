import { validateMock } from '../validators/mockValidator.js';
import { actorId } from '../middleware/authenticate.js';
import * as mockService from '../services/mocking/mockService.js';
import { isValidId } from '../utils/objectId.js';

export async function createMockHandler(req, res, next) {
  const errors = validateMock(req.body);
  if (errors.length > 0) {
    res.status(400);
    return next(new Error(errors.join(' ')));
  }

  try {
    const mock = await mockService.createMock(actorId(req), req.body);
    res.status(201).json(mock);
  } catch (err) {
    next(err);
  }
}

export async function listMocksHandler(req, res, next) {
  try {
    const mocks = await mockService.listMocks(actorId(req));
    res.status(200).json(mocks);
  } catch (err) {
    next(err);
  }
}

export async function getMockHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid mock id.'));
  }

  try {
    const mock = await mockService.getMock(actorId(req), req.params.id);
    if (!mock) {
      res.status(404);
      return next(new Error('Mock not found.'));
    }
    res.status(200).json(mock);
  } catch (err) {
    next(err);
  }
}

export async function updateMockHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid mock id.'));
  }

  const errors = validateMock(req.body);
  if (errors.length > 0) {
    res.status(400);
    return next(new Error(errors.join(' ')));
  }

  try {
    const mock = await mockService.updateMock(actorId(req), req.params.id, req.body);
    if (!mock) {
      res.status(404);
      return next(new Error('Mock not found.'));
    }
    res.status(200).json(mock);
  } catch (err) {
    next(err);
  }
}

export async function deleteMockHandler(req, res, next) {
  if (!isValidId(req.params.id)) {
    res.status(400);
    return next(new Error('Invalid mock id.'));
  }

  try {
    const mock = await mockService.deleteMock(actorId(req), req.params.id);
    if (!mock) {
      res.status(404);
      return next(new Error('Mock not found.'));
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
