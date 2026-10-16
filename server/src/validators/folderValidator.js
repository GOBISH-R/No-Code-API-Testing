import { isValidId } from '../utils/objectId.js';

const MAX_NAME_LENGTH = 100;

export function validateFolder(payload, { requireCollectionId = true } = {}) {
  if (!payload || typeof payload !== 'object') return ['A folder is required.'];

  const errors = [];
  const { name, collectionId, parentId } = payload;

  if (typeof name !== 'string' || !name.trim()) {
    errors.push('name is required.');
  } else if (name.trim().length > MAX_NAME_LENGTH) {
    errors.push(`name must be ${MAX_NAME_LENGTH} characters or fewer.`);
  } else if (name.includes('/')) {
    // "/" separates segments in the export format's folderPath, so allowing it in a
    // name would make an exported path ambiguous on import.
    errors.push('name cannot contain "/".');
  }

  if (requireCollectionId && !isValidId(collectionId)) {
    errors.push('collectionId must be a valid id.');
  }

  if (parentId !== undefined && parentId !== null && !isValidId(parentId)) {
    errors.push('parentId must be a valid id or null.');
  }

  return errors;
}
