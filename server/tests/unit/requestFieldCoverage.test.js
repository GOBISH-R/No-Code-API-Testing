import { describe, it, expect } from 'vitest';
import { Request as SavedRequest } from '../../src/models/Request.js';
import { documentFields } from '../../src/services/collections/savedRequestService.js';
import { toPortableRequest } from '../../src/importExport/collectionFormat.js';

/**
 * Guards the project's most expensive recurring bug.
 *
 * Adding a field to the Request model is only two thirds of the job: it must also be
 * carried by the save path and by the export format. Miss either and the field is
 * dropped in silence — no error, no failing test, just a request that quietly forgets
 * half of itself. That has happened twice already (protocol, then websocket), each time
 * discovered by a user-visible symptom rather than by the suite.
 *
 * These tests fail the moment a new field is added without wiring it through, and the
 * failure message names the field.
 */

// Bookkeeping Mongoose adds, plus ownership.
//
// `userId` is deliberately absent from both the save path and the export format, and
// for different reasons: owned() stamps it on write, so accepting it from a payload
// would let a caller plant a document in somebody else's account; and an export is a
// portable definition, where another installation's account id means nothing.
const NOT_CONTENT = new Set(['_id', '__v', 'createdAt', 'updatedAt', 'userId']);
const CONDITIONAL = new Set(['collectionId', 'folderId']);

function modelFields() {
  const top = new Set();
  for (const path of Object.keys(SavedRequest.schema.paths)) {
    const [head] = path.split('.');
    if (!NOT_CONTENT.has(head)) top.add(head);
  }
  return [...top];
}

// A payload with every field populated, so nothing is dropped merely for being absent.
function fullPayload() {
  return {
    collectionId: '000000000000000000000001',
    folderId: '000000000000000000000002',
    name: 'Everything',
    protocol: 'websocket',
    method: 'POST',
    url: 'wss://example.com/socket',
    params: [{ key: 'a', value: '1', enabled: true }],
    headers: [{ key: 'X-A', value: '1', enabled: true }],
    body: { mode: 'raw', raw: '{}', rows: [] },
    graphql: { query: 'query { a }', variables: '{}', operationName: 'Q' },
    websocket: { subprotocols: 'graphql-ws', steps: [] },
    auth: { type: 'bearer', bearer: { token: 't' } },
    assertions: [{ source: 'status', operator: 'equals', expected: '200' }],
    captures: [{ source: 'json', path: '$.id', variableName: 'id' }],
  };
}

describe('every Request field survives being saved', () => {
  it('is carried by documentFields', () => {
    const saved = documentFields(fullPayload());
    const missing = modelFields().filter((field) => saved[field] === undefined);

    expect(missing, `documentFields() drops: ${missing.join(', ')}`).toEqual([]);
  });

  it('writes the conditional fields when they are supplied', () => {
    const saved = documentFields(fullPayload());
    for (const field of CONDITIONAL) expect(saved[field]).toBeDefined();
  });

  it('ignores a caller-supplied owner', () => {
    // The owner comes from the session via owned(), never from the request body —
    // otherwise a crafted payload could file a document under another account.
    const saved = documentFields({ ...fullPayload(), userId: 'somebody-elses-id' });
    expect(saved).not.toHaveProperty('userId');
  });

  it('omits collectionId when it is not supplied, so an update cannot blank it', () => {
    const { collectionId: _omitted, ...rest } = fullPayload();
    expect(documentFields(rest)).not.toHaveProperty('collectionId');
  });

  it('moves a request to the root when folderId is explicitly null', () => {
    expect(documentFields({ ...fullPayload(), folderId: null }).folderId).toBeNull();
  });
});

describe('every Request field survives being exported', () => {
  it('is carried by toPortableRequest', () => {
    const portable = toPortableRequest(fullPayload(), '');
    // Ids are deliberately absent from an export — it is a definition, not a record.
    const expected = modelFields().filter((f) => !CONDITIONAL.has(f));
    const missing = expected.filter((field) => portable[field] === undefined);

    expect(missing, `toPortableRequest() drops: ${missing.join(', ')}`).toEqual([]);
  });

  it('carries folder membership as a path rather than an id', () => {
    const portable = toPortableRequest(fullPayload(), 'Auth/Login');
    expect(portable.folderPath).toBe('Auth/Login');
    expect(portable).not.toHaveProperty('folderId');
    expect(portable).not.toHaveProperty('collectionId');
    expect(portable).not.toHaveProperty('_id');
  });

  it('never writes an owner into an export file', () => {
    // An export is shared and re-imported elsewhere. Carrying an account id would leak
    // one, and would be meaningless in any other installation.
    const portable = toPortableRequest({ ...fullPayload(), userId: 'abc123' }, '');
    expect(portable).not.toHaveProperty('userId');
  });
});
