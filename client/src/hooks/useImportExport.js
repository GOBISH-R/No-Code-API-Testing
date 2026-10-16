import { useState } from 'react';
import {
  exportCollection as apiExport,
  importCollection as apiImport,
  importOpenApi as apiImportOpenApi,
} from '../services/importExportService.js';
import { downloadJson } from '../utils/download.js';
import { summarizeSecrets } from '../utils/exportSecrets.js';

// Must match server/src/importExport/collectionFormat.js's FORMAT constant — frontend
// and backend are separate deployables with no shared module, so this one string is
// duplicated rather than imported.
const NATIVE_FORMAT = 'visual-api-testing-suite.collection';

function fileNameFor(collectionName) {
  const slug = String(collectionName || 'collection')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'collection'}.json`;
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}

export function useImportExport({ onImported } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // A fetched export waiting on the user to confirm it may contain credentials.
  const [pendingExport, setPendingExport] = useState(null);

  const clearMessages = () => {
    setError(null);
    setNotice(null);
  };

  /**
   * Fetches the export, then either saves it or asks first.
   *
   * An export carries whatever credentials were saved on each request, which is what
   * makes a re-imported collection work — but it also makes the file a secret, and
   * people attach these to tickets. When there is something sensitive in it the
   * download pauses here and the UI confirms; otherwise it saves as before.
   */
  const exportCollection = async (id, collectionName) => {
    setBusy(true);
    clearMessages();
    try {
      const document = await apiExport(id);
      const fileName = fileNameFor(document.collection.name || collectionName);
      const secrets = summarizeSecrets(document);

      if (secrets.total > 0) {
        setPendingExport({ document, fileName, secrets });
        return;
      }

      downloadJson(fileName, document);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to export the collection.');
    } finally {
      setBusy(false);
    }
  };

  const confirmExport = () => {
    if (!pendingExport) return;
    downloadJson(pendingExport.fileName, pendingExport.document);
    setPendingExport(null);
  };

  const cancelExport = () => setPendingExport(null);

  // One control handles both formats: a native export (JSON, our own format marker)
  // goes straight to the native importer; anything else (OpenAPI/Swagger, JSON or
  // YAML) is handed to the backend's OpenAPI converter instead of guessing further
  // client-side — the backend already owns "what is this document" via detectVersion.
  const importCollection = async (file) => {
    setBusy(true);
    clearMessages();
    try {
      const text = await readFileAsText(file);

      let nativeDocument = null;
      try {
        const parsed = JSON.parse(text);
        if (parsed?.format === NATIVE_FORMAT) nativeDocument = parsed;
      } catch {
        // Not JSON — falls through to the OpenAPI path, which also accepts YAML.
      }

      const created = nativeDocument
        ? await apiImport(nativeDocument)
        : await apiImportOpenApi(text);

      setNotice(`Imported "${created.name}" with ${created.requests.length} request(s).`);
      onImported?.(created);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to import the collection.');
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    error,
    notice,
    pendingExport,
    exportCollection,
    confirmExport,
    cancelExport,
    importCollection,
    clearMessages,
  };
}
