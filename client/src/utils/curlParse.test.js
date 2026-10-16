import { describe, it, expect } from 'vitest';
import { CurlParseError, isCurlCommand, parseCurl, tokenize } from './curlParse.js';

const pairs = (rows) => rows.map((r) => [r.key, r.value]);

describe('isCurlCommand', () => {
  it('recognises curl and curl.exe, ignoring leading whitespace', () => {
    expect(isCurlCommand('curl https://a.test')).toBe(true);
    expect(isCurlCommand('  curl.exe -X POST x')).toBe(true);
    expect(isCurlCommand('CURL x')).toBe(true);
  });

  it('does not mistake URLs or words starting with curl for a command', () => {
    expect(isCurlCommand('https://curl.se')).toBe(false);
    expect(isCurlCommand('curly')).toBe(false);
    expect(isCurlCommand(undefined)).toBe(false);
  });
});

describe('tokenize', () => {
  it('handles single, double and $\'…\' quoting', () => {
    expect(tokenize(`curl 'a b' "c \\"d\\"" $'e\\nf'`)).toEqual(['curl', 'a b', 'c "d"', 'e\nf']);
  });

  it('joins bash, cmd and PowerShell line continuations', () => {
    expect(tokenize('curl \\\n  -X POST \\\r\n  x')).toEqual(['curl', '-X', 'POST', 'x']);
    expect(tokenize('curl ^"https://a.test^" ^\n  -H ^"A: b^"')).toEqual(['curl', 'https://a.test', '-H', 'A: b']);
    expect(tokenize('curl `\n -X PUT x')).toEqual(['curl', '-X', 'PUT', 'x']);
  });

  it('rejects an unclosed quote', () => {
    expect(() => tokenize(`curl 'abc`)).toThrow(CurlParseError);
  });
});

describe('parseCurl', () => {
  it('reads a simple GET and moves the query string to params', () => {
    const { config, warnings } = parseCurl('curl "https://api.test/users?page=2&q=a%20b#top"');
    expect(config.method).toBe('GET');
    expect(config.url).toBe('https://api.test/users');
    expect(pairs(config.params)).toEqual([['page', '2'], ['q', 'a b']]);
    expect(config.body.mode).toBe('none');
    expect(warnings).toEqual([]);
  });

  it('reads method, headers and a JSON body, dropping the redundant Content-Type', () => {
    const { config } = parseCurl(
      `curl -X PUT https://api.test/u/1 -H 'Content-Type: application/json' -H 'X-Trace: 7' -d '{"name":"Ann","id":12345678901234567890}'`,
    );
    expect(config.method).toBe('PUT');
    expect(pairs(config.headers)).toEqual([['X-Trace', '7']]);
    expect(config.body.mode).toBe('json');
    // Kept verbatim so large numbers are not rounded.
    expect(config.body.raw).toBe('{"name":"Ann","id":12345678901234567890}');
  });

  it('defaults to POST when there is data, and detects JSON without a Content-Type', () => {
    const { config } = parseCurl(`curl https://api.test -d '{"a":1}'`);
    expect(config.method).toBe('POST');
    expect(config.body.mode).toBe('json');
  });

  it('reads form data into URL-encoded rows', () => {
    const { config } = parseCurl(`curl https://api.test --data 'a=1&b=x+y' --data-urlencode 'c=d&e'`);
    expect(config.body.mode).toBe('urlencoded');
    expect(pairs(config.body.rows)).toEqual([['a', '1'], ['b', 'x y'], ['c', 'd&e']]);
  });

  it('keeps other bodies as raw text with their Content-Type', () => {
    const { config } = parseCurl(`curl https://api.test -H 'Content-Type: application/xml' -d '<a/>'`);
    expect(config.body).toMatchObject({ mode: 'text', raw: '<a/>' });
    expect(pairs(config.headers)).toEqual([['Content-Type', 'application/xml']]);
  });

  it('turns Authorization headers and -u into the Auth tab', () => {
    expect(parseCurl(`curl x -H 'Authorization: Bearer abc.def'`).config.auth).toEqual({
      type: 'bearer',
      bearer: { token: 'abc.def' },
    });
    const basicHeader = parseCurl(`curl x -H 'Authorization: Basic ${btoa('ann:p:w')}'`).config;
    expect(basicHeader.auth).toEqual({ type: 'basic', basic: { username: 'ann', password: 'p:w' } });
    expect(basicHeader.headers).toEqual([]);
    expect(parseCurl(`curl -u bob:secret x`).config.auth).toEqual({
      type: 'basic',
      basic: { username: 'bob', password: 'secret' },
    });
  });

  it('accepts attached and combined short options and --opt=value', () => {
    const { config, warnings } = parseCurl(`curl -sSL -XPATCH --header='A: 1' --url https://api.test`);
    expect(config.method).toBe('PATCH');
    expect(config.url).toBe('https://api.test');
    expect(pairs(config.headers)).toEqual([['A', '1']]);
    expect(warnings).toEqual([]);
  });

  it('moves data into the query string with -G', () => {
    const { config } = parseCurl(`curl -G https://api.test -d q=1 -d r=2`);
    expect(config.method).toBe('GET');
    expect(config.body.mode).toBe('none');
    expect(pairs(config.params)).toEqual([['q', '1'], ['r', '2']]);
  });

  it('maps -A, -e and -b to headers', () => {
    const { config } = parseCurl(`curl x -A 'Bot/1' -e https://ref.test -b 'sid=1'`);
    expect(pairs(config.headers)).toEqual([
      ['User-Agent', 'Bot/1'],
      ['Referer', 'https://ref.test'],
      ['Cookie', 'sid=1'],
    ]);
  });

  it('adds http:// to a bare host but leaves a {{variable}} URL alone', () => {
    expect(parseCurl('curl api.test/x').config.url).toBe('http://api.test/x');
    expect(parseCurl('curl {{baseUrl}}/x').config.url).toBe('{{baseUrl}}/x');
  });

  it('warns about what it could not import', () => {
    const { warnings } = parseCurl(`curl x -d @body.json --weird-flag -F 'f=@a.png' -F 'n=1'`);
    expect(warnings.join(' ')).toMatch(/body\.json/);
    expect(warnings.join(' ')).toMatch(/--weird-flag/);
    expect(warnings.join(' ')).toMatch(/Choose the file for "f" again/);
  });

  it('reads -F into form-data fields, files described but not attached', () => {
    const { config } = parseCurl(
      `curl https://api.test/upload -H 'Content-Type: multipart/form-data; boundary=xyz' -F 'name=Ada' -F 'avatar=@/home/ada/photo.png;type=image/png'`,
    );
    expect(config.method).toBe('POST');
    expect(config.body.mode).toBe('formdata');
    expect(config.body.form).toEqual([
      { key: 'name', value: 'Ada', enabled: true, type: 'text' },
      { key: 'avatar', value: '', enabled: true, type: 'file', fileName: 'photo.png', fileType: 'image/png', fileSize: 0 },
    ]);
    // The copied boundary is dropped; a fresh one is made when it is sent.
    expect(config.headers).toEqual([]);
    // A Windows path keeps only the file's name.
    expect(parseCurl(`curl x -F "doc=@C:\\\\Users\\\\ada\\\\report.pdf"`).config.body.form[0].fileName).toBe('report.pdf');
  });

  it('parses a Chrome "Copy as cURL (bash)" command', () => {
    const { config } = parseCurl(
      "curl 'https://api.test/graphql' \\\n  -H 'accept: */*' \\\n  -H 'content-type: application/json' \\\n  --data-raw $'{\"q\":\"it\\'s\"}' \\\n  --compressed",
    );
    expect(config.method).toBe('POST');
    expect(config.body).toMatchObject({ mode: 'json', raw: `{"q":"it's"}` });
    expect(pairs(config.headers)).toEqual([['accept', '*/*']]);
  });

  it('rejects methods ApIForge cannot send and commands without a URL', () => {
    expect(() => parseCurl('curl -I https://api.test')).toThrow(/HEAD/);
    expect(() => parseCurl('curl -X OPTIONS https://api.test')).toThrow(/OPTIONS/);
    expect(() => parseCurl('curl -X POST')).toThrow(/no URL/);
    expect(() => parseCurl('curl -H')).toThrow(/missing its value/);
    expect(() => parseCurl('wget x')).toThrow(CurlParseError);
  });
});
