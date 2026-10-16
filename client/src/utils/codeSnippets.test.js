import { describe, it, expect } from 'vitest';
import { buildSnippetModel, generateSnippet, SNIPPET_LANGUAGES } from './codeSnippets.js';
import { parseCurl } from './curlParse.js';

const row = (key, value, enabled = true) => ({ key, value, enabled });

function request(overrides = {}) {
  return {
    protocol: 'rest',
    method: 'GET',
    url: 'https://api.test/users',
    params: [],
    headers: [],
    body: { mode: 'none', raw: '', rows: [] },
    graphql: { query: '', variables: '', operationName: '' },
    auth: { type: 'none' },
    ...overrides,
  };
}

describe('buildSnippetModel', () => {
  it('sends only enabled rows and appends params, keeping {{variables}} readable', () => {
    const m = buildSnippetModel(
      request({
        url: '{{baseUrl}}/users',
        params: [row('q', 'a b'), row('id', '{{userId}}'), row('off', '1', false)],
        headers: [row('X-A', '1'), row('', 'ignored'), row('X-B', '2', false)],
      }),
    );
    expect(m.url).toBe('{{baseUrl}}/users?q=a%20b&id={{userId}}');
    expect(m.headers).toEqual([['X-A', '1']]);
  });

  it('adds the body mode default Content-Type unless one was typed', () => {
    const json = buildSnippetModel(request({ method: 'POST', body: { mode: 'json', raw: '{"a":1}', rows: [] } }));
    expect(json.headers).toEqual([['Content-Type', 'application/json']]);
    const typed = buildSnippetModel(
      request({
        method: 'POST',
        headers: [row('content-type', 'application/vnd.api+json')],
        body: { mode: 'json', raw: '{}', rows: [] },
      }),
    );
    expect(typed.headers).toEqual([['content-type', 'application/vnd.api+json']]);
  });

  it('applies auth last so it wins over a same-named header', () => {
    const m = buildSnippetModel(
      request({ headers: [row('Authorization', 'old')], auth: { type: 'bearer', bearer: { token: 't' } } }),
    );
    expect(m.headers).toEqual([['Authorization', 'Bearer t']]);
  });

  it('puts an API key in the query when asked to', () => {
    const m = buildSnippetModel(request({ auth: { type: 'apiKey', apiKey: { key: 'k', value: 'v', addTo: 'query' } } }));
    expect(m.url).toBe('https://api.test/users?k=v');
  });

  it('uses a placeholder for OAuth 2.0 tokens that are fetched on Send', () => {
    const m = buildSnippetModel(request({ auth: { type: 'oauth2', oauth2: { grantType: 'clientCredentials' } } }));
    expect(m.headers).toEqual([['Authorization', 'Bearer <access-token>']]);
    expect(m.notes).toHaveLength(1);
  });

  it('builds a GraphQL request as a POST with a JSON payload', () => {
    const m = buildSnippetModel(
      request({
        protocol: 'graphql',
        method: 'GET',
        graphql: { query: '{ me { id } }', variables: '{"x":1}', operationName: 'Me' },
      }),
    );
    expect(m.method).toBe('POST');
    expect(m.body.parsed).toEqual({ query: '{ me { id } }', variables: { x: 1 }, operationName: 'Me' });
  });
});

describe('generateSnippet', () => {
  const post = request({
    method: 'POST',
    headers: [row('X-Note', "it's")],
    body: { mode: 'json', raw: '{"name":"Ann","admin":false,"tags":null}', rows: [] },
    auth: { type: 'basic', basic: { username: 'ann', password: 'pw' } },
  });

  it('produces code for every language', () => {
    for (const { id } of SNIPPET_LANGUAGES) {
      const { code } = generateSnippet(post, id);
      expect(code).toContain('https://api.test/users');
      expect(code.length).toBeGreaterThan(40);
    }
  });

  it('quotes shell strings safely in cURL', () => {
    const { code } = generateSnippet(post, 'curl');
    expect(code).toContain(`--request POST 'https://api.test/users'`);
    expect(code).toContain(`--header 'X-Note: it'\\''s'`);
    expect(code).toContain(`--user 'ann:pw'`);
    expect(code).toContain(`--data-raw '{"name":"Ann","admin":false,"tags":null}'`);
  });

  it('round-trips through the cURL importer', () => {
    const { code } = generateSnippet(post, 'curl');
    const { config } = parseCurl(code);
    expect(config.method).toBe('POST');
    expect(config.url).toBe('https://api.test/users');
    expect(config.auth).toEqual({ type: 'basic', basic: { username: 'ann', password: 'pw' } });
    expect(config.body).toMatchObject({ mode: 'json', raw: post.body.raw });
    expect(config.headers.map((h) => [h.key, h.value])).toEqual([['X-Note', "it's"]]);
  });

  it('writes Python literals, not JSON', () => {
    const { code } = generateSnippet(post, 'python');
    expect(code).toContain('"admin": False');
    expect(code).toContain('"tags": None');
    expect(code).toContain('json=payload');
    expect(code).toContain('auth=("ann", "pw")');
  });

  it('passes Content-Type to PowerShell as -ContentType, not a header', () => {
    const { code } = generateSnippet(post, 'powershell');
    expect(code).toContain("-ContentType 'application/json'");
    expect(code).not.toMatch(/'Content-Type' =/);
    expect(code).toContain("'X-Note' = 'it''s'");
  });

  it('builds URL-encoded bodies with URLSearchParams in JavaScript', () => {
    const form = request({ method: 'POST', body: { mode: 'urlencoded', raw: '', rows: [row('a', '1'), row('b', '2')] } });
    expect(generateSnippet(form, 'fetch').code).toContain('body: new URLSearchParams({');
    expect(generateSnippet(form, 'axios').code).toContain('data: new URLSearchParams({');
    expect(generateSnippet(form, 'curl').code).toContain(`--data-urlencode 'a=1'`);
  });

  it('omits --request for a plain GET', () => {
    expect(generateSnippet(request(), 'curl').code).toBe(`curl --location 'https://api.test/users'`);
  });
});

describe('multipart form-data snippets', () => {
  const upload = request({
    method: 'POST',
    url: 'https://api.test/upload',
    headers: [row('Content-Type', 'multipart/form-data; boundary=old')],
    body: {
      mode: 'formdata',
      form: [
        { key: 'name', value: 'Ada', enabled: true, type: 'text' },
        { key: 'avatar', value: '', enabled: true, type: 'file', fileName: 'photo.png', data: 'UE5HISE=' },
        { key: 'off', value: 'x', enabled: false, type: 'text' },
      ],
    },
  });

  it('drops a fixed multipart Content-Type and never includes file contents', () => {
    const m = buildSnippetModel(upload);
    expect(m.headers).toEqual([]);
    expect(m.body.parts.map((p) => p.key)).toEqual(['name', 'avatar']);
    for (const { id } of SNIPPET_LANGUAGES) expect(generateSnippet(upload, id).code).not.toContain('UE5HISE=');
  });

  it('writes the multipart form for each language', () => {
    expect(generateSnippet(upload, 'curl').code).toContain(`--form 'avatar=@"photo.png"'`);
    expect(generateSnippet(upload, 'curl').code).toContain(`--form 'name=Ada'`);
    expect(generateSnippet(upload, 'fetch').code).toContain('const form = new FormData();');
    expect(generateSnippet(upload, 'axios').code).toContain('fs.readFileSync("photo.png")');
    expect(generateSnippet(upload, 'python').code).toContain('"avatar": open("photo.png", "rb")');
    expect(generateSnippet(upload, 'python').code).toContain('files=files');
    expect(generateSnippet(upload, 'powershell').code).toContain("'avatar' = Get-Item -Path 'photo.png'");
  });

  it('round-trips a cURL form through the importer', () => {
    const { config } = parseCurl(generateSnippet(upload, 'curl').code);
    expect(config.body.mode).toBe('formdata');
    expect(config.body.form.map((f) => [f.key, f.type, f.fileName ?? f.value])).toEqual([
      ['name', 'text', 'Ada'],
      ['avatar', 'file', 'photo.png'],
    ]);
  });
});
