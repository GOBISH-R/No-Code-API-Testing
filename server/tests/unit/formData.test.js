import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';

// The SSRF guard is a separate concern with its own tests; here it lets the local test
// server through so a real multipart body can be inspected on arrival.
vi.mock('../../src/services/execution/urlValidator.js', () => ({
  assertPublicUrl: async (url) => new URL(url),
}));

const { executeRequest } = await import('../../src/services/execution/executionEngine.js');
const { validateRequestConfig, FORM_LIMITS } = await import('../../src/validators/requestValidator.js');
const { Request } = await import('../../src/models/Request.js');
const { HistoryEntry } = await import('../../src/models/HistoryEntry.js');
const { toPortableRequest } = await import('../../src/importExport/collectionFormat.js');

let server;
let baseUrl;
let received;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received = { headers: req.headers, body: Buffer.concat(chunks).toString('latin1') };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const fileRow = (overrides = {}) => ({
  key: 'avatar',
  enabled: true,
  type: 'file',
  fileName: 'photo.png',
  fileType: 'image/png',
  fileSize: 5,
  data: Buffer.from('PNG!!').toString('base64'),
  ...overrides,
});

function formRequest(form, extra = {}) {
  return {
    protocol: 'rest',
    method: 'POST',
    url: `${baseUrl}/upload`,
    params: [],
    headers: [],
    body: { mode: 'formdata', form },
    auth: { type: 'none' },
    ...extra,
  };
}

describe('sending multipart/form-data', () => {
  it('sends text fields and files as real multipart parts', async () => {
    const result = await executeRequest(
      formRequest([
        { key: 'name', value: '{{user}}', enabled: true, type: 'text' },
        { key: 'skip', value: 'x', enabled: false, type: 'text' },
        fileRow(),
      ]),
      { user: 'Ada' },
    );

    expect(result.success).toBe(true);
    expect(received.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(received.body).toContain('name="name"');
    expect(received.body).toContain('Ada'); // {{user}} was resolved
    expect(received.body).not.toContain('name="skip"');
    expect(received.body).toContain('name="avatar"; filename="photo.png"');
    expect(received.body).toContain('Content-Type: image/png');
    expect(received.body).toContain('PNG!!');
  });

  it('drops a hand-typed Content-Type, which could not know the boundary', async () => {
    await executeRequest(
      formRequest([fileRow()], { headers: [{ key: 'Content-Type', value: 'multipart/form-data', enabled: true }] }),
    );
    expect(received.headers['content-type']).toMatch(/boundary=/);
  });

  it('says which field needs its file again when the contents are missing', async () => {
    const saved = fileRow();
    delete saved.data; // what a saved request, a collection run or a monitor has
    await expect(executeRequest(formRequest([saved]))).rejects.toThrow(/Choose the file for "avatar" again/);
  });
});

describe('validating form bodies', () => {
  it('accepts a well-formed form', () => {
    expect(validateRequestConfig(formRequest([fileRow(), { key: 'a', value: 'b', enabled: true, type: 'text' }]))).toEqual([]);
  });

  it('rejects bad shapes, bad base64, too many fields and too many bytes', () => {
    expect(validateRequestConfig(formRequest('nope')).join(' ')).toMatch(/array/);
    expect(validateRequestConfig(formRequest([fileRow({ data: 'not base64!' })])).join(' ')).toMatch(/base64/);
    expect(validateRequestConfig(formRequest([{ key: 'a', enabled: true, type: 'blob' }])).join(' ')).toMatch(/text or file/);

    const many = Array.from({ length: FORM_LIMITS.MAX_FIELDS + 1 }, (_, i) => ({ key: `k${i}`, value: '', enabled: true, type: 'text' }));
    expect(validateRequestConfig(formRequest(many)).join(' ')).toMatch(/up to 50 fields/);

    const big = 'A'.repeat(Math.ceil((FORM_LIMITS.MAX_FILE_BYTES * 4) / 3) + 8);
    expect(validateRequestConfig(formRequest([fileRow({ data: big })])).join(' ')).toMatch(/5 MB/);
  });
});

describe('file contents are never stored', () => {
  const body = { mode: 'formdata', form: [fileRow(), { key: 'note', value: 'hi', enabled: true, type: 'text' }] };

  it('keeps only the file’s name, type and size on a saved request, a history entry and an export', () => {
    for (const Model of [Request, HistoryEntry]) {
      const doc = new Model({ name: 'Upload', method: 'POST', url: 'https://x.test', body }).toObject();
      expect(doc.body.form[0]).toMatchObject({ key: 'avatar', type: 'file', fileName: 'photo.png', fileType: 'image/png', fileSize: 5 });
      expect(doc.body.form[0]).not.toHaveProperty('data');
    }
    const portable = toPortableRequest({ name: 'Upload', method: 'POST', url: 'https://x.test', body });
    expect(portable.body.form[0]).not.toHaveProperty('data');
    expect(portable.body.form[1]).toMatchObject({ key: 'note', value: 'hi', type: 'text' });
  });
});
