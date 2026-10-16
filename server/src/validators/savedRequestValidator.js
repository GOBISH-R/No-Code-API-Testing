import { validateRequestConfig } from './requestValidator.js';
import { validateAssertions } from './assertionValidator.js';
import { validateCaptures } from './captureValidator.js';
import { isValidId } from '../utils/objectId.js';

// A saved request is a request configuration (reusing the same validation as
// /api/requests/execute) plus a name and the collection it belongs to.
export function validateSavedRequest(payload, { requireCollectionId = true } = {}) {
  if (!payload || typeof payload !== 'object') return ['A request is required.'];

  const errors = [];

  if (typeof payload.name !== 'string' || !payload.name.trim()) {
    errors.push('name is required.');
  }

  if (requireCollectionId && !isValidId(payload.collectionId)) {
    errors.push('collectionId must be a valid id.');
  } else if (payload.collectionId !== undefined && !isValidId(payload.collectionId)) {
    errors.push('collectionId must be a valid id.');
  }

  // null/'' is meaningful: it moves the request back to the collection's root.
  if (payload.folderId !== undefined && payload.folderId !== null && payload.folderId !== '') {
    if (!isValidId(payload.folderId)) errors.push('folderId must be a valid id or null.');
  }

  errors.push(...validateRequestConfig(payload));
  errors.push(...validateAssertions(payload.assertions));
  errors.push(...validateCaptures(payload.captures));

  return errors;
}
