import { describe, it, expect } from 'vitest';
import { validateFolder } from '../../src/validators/folderValidator.js';
import { validateCollectionImport } from '../../src/validators/importValidator.js';
import { toPortableRequest } from '../../src/importExport/collectionFormat.js';
import { FORMAT, VERSION } from '../../src/importExport/collectionFormat.js';

const VALID_ID = '507f1f77bcf86cd799439011';

describe('folder validation', () => {
  it('accepts a well-formed folder', () => {
    expect(validateFolder({ name: 'Auth', collectionId: VALID_ID })).toEqual([]);
    expect(validateFolder({ name: 'Auth', collectionId: VALID_ID, parentId: VALID_ID })).toEqual([]);
    expect(validateFolder({ name: 'Auth', collectionId: VALID_ID, parentId: null })).toEqual([]);
  });

  it('requires a name', () => {
    expect(validateFolder({ collectionId: VALID_ID }).join(' ')).toMatch(/name is required/);
    expect(validateFolder({ name: '   ', collectionId: VALID_ID }).join(' ')).toMatch(/name is required/);
  });

  it('rejects "/" in a name', () => {
    // "/" separates segments in the export format's folderPath, so a name containing
    // one would make an exported path ambiguous when re-imported.
    expect(validateFolder({ name: 'Auth/Admin', collectionId: VALID_ID }).join(' ')).toMatch(/cannot contain/);
  });

  it('rejects an over-long name', () => {
    expect(validateFolder({ name: 'x'.repeat(101), collectionId: VALID_ID }).join(' ')).toMatch(/100 characters/);
  });

  it('rejects malformed ids', () => {
    expect(validateFolder({ name: 'Auth', collectionId: 'nope' }).join(' ')).toMatch(/collectionId/);
    expect(validateFolder({ name: 'Auth', collectionId: VALID_ID, parentId: 'nope' }).join(' ')).toMatch(/parentId/);
  });
});

describe('export format — folderPath', () => {
  it('records the folder path on each request', () => {
    const portable = toPortableRequest({ name: 'Login', method: 'POST', url: 'https://x.com' }, 'Auth/Admin');
    expect(portable.folderPath).toBe('Auth/Admin');
  });

  it('defaults to root for a request in no folder', () => {
    const portable = toPortableRequest({ name: 'Ping', method: 'GET', url: 'https://x.com' });
    expect(portable.folderPath).toBe('');
  });
});

describe('import validation — folderPath', () => {
  function documentWith(request) {
    return {
      format: FORMAT,
      version: VERSION,
      collection: { name: 'C', requests: [{ name: 'R', method: 'GET', url: 'https://x.com', ...request }] },
    };
  }

  it('accepts a request with a folder path', () => {
    expect(validateCollectionImport(documentWith({ folderPath: 'Auth/Admin' }))).toEqual([]);
  });

  it('accepts a pre-folders export that has no folderPath at all', () => {
    // Backwards compatibility: files exported before folders existed must still import.
    expect(validateCollectionImport(documentWith({}))).toEqual([]);
  });

  it('rejects a non-string folderPath', () => {
    expect(validateCollectionImport(documentWith({ folderPath: 42 })).join(' ')).toMatch(/folderPath/);
  });
});
