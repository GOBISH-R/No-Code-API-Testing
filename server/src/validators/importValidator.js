import { validateSavedRequest } from './savedRequestValidator.js';
import { FORMAT, VERSION, MAX_IMPORT_REQUESTS } from '../importExport/collectionFormat.js';

// An import document is fully user-supplied and gets persisted, so every request in it
// is validated with the same rules a request saved through the UI goes through — the
// import path must not be a way around them.
export function validateCollectionImport(payload) {
  if (!payload || typeof payload !== 'object') return ['An import document is required.'];

  if (payload.format !== FORMAT) {
    return [`Unrecognized file. Expected a "${FORMAT}" export.`];
  }

  if (payload.version !== VERSION) {
    return [`Unsupported export version ${payload.version}. This build reads version ${VERSION}.`];
  }

  const collection = payload.collection;
  if (!collection || typeof collection !== 'object') {
    return ['The file has no collection to import.'];
  }

  const errors = [];

  if (typeof collection.name !== 'string' || !collection.name.trim()) {
    errors.push('collection.name is required.');
  }

  if (collection.description !== undefined && typeof collection.description !== 'string') {
    errors.push('collection.description must be a string.');
  }

  if (!Array.isArray(collection.requests)) {
    errors.push('collection.requests must be an array.');
    return errors;
  }

  if (collection.requests.length > MAX_IMPORT_REQUESTS) {
    errors.push(`A collection may not import more than ${MAX_IMPORT_REQUESTS} requests.`);
    return errors;
  }

  collection.requests.forEach((request, index) => {
    // folderPath is optional (absent in pre-folders exports) but must be a string
    // when present, since the importer splits it to rebuild the folder tree.
    if (request?.folderPath !== undefined && typeof request.folderPath !== 'string') {
      errors.push(`Request ${index + 1}: folderPath must be a string.`);
    }

    const requestErrors = validateSavedRequest(request, { requireCollectionId: false });
    // Prefix so a failure in a 40-request file says which request is at fault.
    errors.push(...requestErrors.map((e) => `Request ${index + 1}: ${e}`));
  });

  return errors;
}
