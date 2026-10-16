/**
 * Turns a pasted cURL command into a request the builder can load.
 *
 * Covers what API docs and browser dev tools actually produce: bash-style quoting
 * (including $'…' from Chrome's "Copy as cURL"), Windows cmd's ^-escaping, and line
 * continuations from bash (\), cmd (^) and PowerShell (`). Options that only change
 * how curl itself behaves (-L, -s, -k …) are dropped silently; anything the request
 * genuinely loses is reported back as a warning instead of being ignored quietly.
 */

const SUPPORTED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// Options that consume the next argument.
const VALUE_OPTIONS = {
  X: 'request',
  H: 'header',
  d: 'data',
  u: 'user',
  A: 'user-agent',
  b: 'cookie',
  e: 'referer',
  F: 'form',
  o: 'output',
  m: 'max-time',
  x: 'proxy',
  E: 'cert',
  w: 'write-out',
  r: 'range',
  c: 'cookie-jar',
  K: 'config',
  T: 'upload-file',
};
const LONG_VALUE_OPTIONS = new Set([
  'request', 'header', 'data', 'data-raw', 'data-binary', 'data-ascii', 'data-urlencode',
  'user', 'user-agent', 'cookie', 'referer', 'form', 'form-string', 'url', 'oauth2-bearer',
  'output', 'max-time', 'connect-timeout', 'proxy', 'proxy-user', 'cert', 'key', 'cacert',
  'capath', 'write-out', 'range', 'cookie-jar', 'config', 'upload-file', 'retry',
  'retry-delay', 'retry-max-time', 'max-redirs', 'limit-rate', 'resolve', 'connect-to',
  'interface', 'dns-servers', 'unix-socket', 'trace', 'trace-ascii', 'stderr', 'cert-type',
  'key-type', 'pass', 'ciphers', 'tls-max', 'max-filesize', 'keepalive-time',
  'expect100-timeout', 'happy-eyeballs-timeout-ms', 'speed-limit', 'speed-time', 'time-cond',
]);
// Flags that matter to the request; every other flag only changes curl's own behaviour.
const SHORT_FLAGS = { G: 'get', I: 'head' };
const HARMLESS_FLAGS = new Set([
  'location', 'insecure', 'silent', 'show-error', 'verbose', 'include', 'compressed',
  'fail', 'globoff', 'http1.0', 'http1.1', 'http2', 'http2-prior-knowledge', 'http3',
  'no-buffer', 'progress-bar', 'location-trusted', 'tr-encoding', 'no-keepalive',
  'ssl-reqd', 'tlsv1', 'tlsv1.2', 'tlsv1.3', 'ipv4', 'ipv6', 'path-as-is', 'raw',
  'fail-with-body', 'no-progress-meter', 'remote-name', 'remote-header-name', 'get', 'head',
]);
const HARMLESS_SHORT = new Set(['L', 'k', 's', 'S', 'v', 'i', 'f', 'g', 'N', 'O', 'J', '4', '6', '#', '0', '1', '2', '3']);

export class CurlParseError extends Error {}

export function isCurlCommand(text) {
  return typeof text === 'string' && /^\s*curl(\.exe)?(\s|$)/i.test(text);
}

// cmd's "Copy as cURL" escapes every special character with ^ — ^" ^& ^% ^^ — and ends
// lines with a lone ^. Undoing it first lets the bash tokenizer handle the rest.
function unescapeCmd(text) {
  return text.replace(/\^\r?\n/g, ' ').replace(/\^(.)/g, '$1');
}

function decodeAnsiC(body) {
  return body.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[0-7]{1,3}|.)/g, (_, esc) => {
    switch (esc[0]) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case 'a': return '\x07';
      case 'b': return '\b';
      case 'e': case 'E': return '\x1b';
      case 'f': return '\f';
      case 'v': return '\v';
      case 'x': case 'u': case 'U': return String.fromCodePoint(parseInt(esc.slice(1), 16));
      default:
        return /^[0-7]+$/.test(esc) ? String.fromCharCode(parseInt(esc, 8)) : esc;
    }
  });
}

export function tokenize(input) {
  let text = input;
  if (/\^"/.test(text) || /\^\r?\n/.test(text)) text = unescapeCmd(text);
  // Bash and PowerShell line continuations.
  text = text.replace(/\\\r?\n/g, ' ').replace(/`\r?\n/g, ' ');

  const tokens = [];
  let current = '';
  let inToken = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
      i += 1;
      continue;
    }

    inToken = true;

    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) throw new CurlParseError('The cURL command has an unclosed single quote.');
      current += text.slice(i + 1, end);
      i = end + 1;
    } else if (ch === '$' && text[i + 1] === "'") {
      let j = i + 2;
      let body = '';
      while (j < text.length && text[j] !== "'") {
        if (text[j] === '\\' && j + 1 < text.length) {
          body += text[j] + text[j + 1];
          j += 2;
        } else {
          body += text[j];
          j += 1;
        }
      }
      if (j >= text.length) throw new CurlParseError('The cURL command has an unclosed $\'…\' quote.');
      current += decodeAnsiC(body);
      i = j + 1;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\' && '"\\$`'.includes(text[j + 1])) {
          current += text[j + 1];
          j += 2;
        } else {
          current += text[j];
          j += 1;
        }
      }
      if (j >= text.length) throw new CurlParseError('The cURL command has an unclosed double quote.');
      i = j + 1;
    } else if (ch === '\\' && i + 1 < text.length) {
      current += text[i + 1];
      i += 2;
    } else {
      current += ch;
      i += 1;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}

// Splits argv into options and positional arguments, normalising -XPOST, -sSL,
// --request=POST and friends to { name, value } pairs keyed by the long name.
function readOptions(args, warnings) {
  const options = [];
  const positionals = [];
  let i = 0;

  const takeValue = (name, inline) => {
    if (inline !== undefined && inline !== '') return inline;
    i += 1;
    if (i >= args.length) throw new CurlParseError(`The --${name} option is missing its value.`);
    return args[i];
  };

  for (; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = (eq === -1 ? arg.slice(2) : arg.slice(2, eq)).toLowerCase();
      const inline = eq === -1 ? undefined : arg.slice(eq + 1);
      if (LONG_VALUE_OPTIONS.has(name)) {
        options.push({ name, value: takeValue(name, inline) });
      } else if (name === 'get' || name === 'head') {
        options.push({ name });
      } else if (!HARMLESS_FLAGS.has(name)) {
        warnings.push(`Ignored the --${name} option.`);
      }
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      for (let c = 1; c < arg.length; c += 1) {
        const letter = arg[c];
        if (VALUE_OPTIONS[letter]) {
          const name = VALUE_OPTIONS[letter];
          options.push({ name, value: takeValue(name, arg.slice(c + 1)) });
          break;
        }
        if (SHORT_FLAGS[letter]) options.push({ name: SHORT_FLAGS[letter] });
        else if (!HARMLESS_SHORT.has(letter)) warnings.push(`Ignored the -${letter} option.`);
      }
      continue;
    }

    positionals.push(arg);
  }

  return { options, positionals };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function parsePairs(encoded) {
  return encoded
    .split('&')
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      return eq === -1
        ? { key: safeDecode(part), value: '' }
        : { key: safeDecode(part.slice(0, eq)), value: safeDecode(part.slice(eq + 1)) };
    });
}

// --data-urlencode takes "content", "=content", "name=content" (and @file forms).
function encodeDataUrlencode(value, warnings) {
  const eq = value.indexOf('=');
  const at = value.indexOf('@');
  if (at !== -1 && (eq === -1 || at < eq)) {
    warnings.push('A --data-urlencode value read from a file was skipped.');
    return null;
  }
  if (eq === -1) return encodeURIComponent(value);
  if (eq === 0) return encodeURIComponent(value.slice(1));
  return `${value.slice(0, eq)}=${encodeURIComponent(value.slice(eq + 1))}`;
}

function isJson(text) {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function decodeBasic(encoded) {
  try {
    const decoded = atob(encoded.trim());
    const colon = decoded.indexOf(':');
    if (colon === -1) return null;
    return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
  } catch {
    return null;
  }
}

const row = (key, value) => ({ key, value, enabled: true });

/**
 * @returns {{ config: object, warnings: string[] }} config is the shape
 *   useRequestBuilder().loadRequest() accepts.
 * @throws {CurlParseError} when the text is not a usable cURL command.
 */
export function parseCurl(input) {
  if (!isCurlCommand(input)) throw new CurlParseError('That is not a cURL command.');

  const warnings = [];
  const args = tokenize(input.trim()).slice(1);
  const { options, positionals } = readOptions(args, warnings);

  let method = null;
  let url = null;
  let forceGet = false;
  let isHead = false;
  const headers = [];
  const dataParts = [];
  const formFields = [];
  let sawUrlencode = false;
  let auth = { type: 'none' };

  for (const { name, value } of options) {
    switch (name) {
      case 'request':
        method = value.toUpperCase();
        break;
      case 'url':
        url = url ?? value;
        break;
      case 'header': {
        const colon = value.indexOf(':');
        if (colon === -1) {
          // "-H 'X-Empty;'" is curl's way to send a header with an empty value.
          if (value.endsWith(';')) headers.push(row(value.slice(0, -1).trim(), ''));
          break;
        }
        const key = value.slice(0, colon).trim();
        const headerValue = value.slice(colon + 1).trim();
        // "-H 'Name:'" removes a header curl would add itself — nothing to send.
        if (key && headerValue !== '') headers.push(row(key, headerValue));
        break;
      }
      case 'data':
      case 'data-ascii':
      case 'data-binary':
        if (value.startsWith('@')) {
          warnings.push(`The body read from the file ${value.slice(1)} was skipped.`);
        } else {
          dataParts.push(value);
        }
        break;
      case 'data-raw':
        dataParts.push(value);
        break;
      case 'data-urlencode': {
        const encoded = encodeDataUrlencode(value, warnings);
        if (encoded !== null) {
          dataParts.push(encoded);
          sawUrlencode = true;
        }
        break;
      }
      case 'form':
      case 'form-string': {
        const eq = value.indexOf('=');
        const key = eq === -1 ? value : value.slice(0, eq);
        const fieldValue = eq === -1 ? '' : value.slice(eq + 1);
        if (name === 'form' && /^[@<]/.test(fieldValue)) {
          // -F 'file=@photo.png;type=image/png;filename=me.png' — a file is described,
          // but a pasted command cannot bring its bytes, so it must be picked again.
          const [path, ...options] = fieldValue.slice(1).replace(/^"(.*)"$/, '$1').split(';');
          const option = (n) => options.find((o) => o.trim().startsWith(`${n}=`))?.split('=').slice(1).join('=').trim();
          formFields.push({
            key,
            value: '',
            enabled: true,
            type: 'file',
            fileName: option('filename') || path.split(/[\\/]/).pop(),
            fileType: option('type') || '',
            fileSize: 0,
          });
          warnings.push(`Choose the file for "${key}" again — a pasted command cannot bring the file with it.`);
        } else {
          formFields.push({ ...row(key, fieldValue), type: 'text' });
        }
        break;
      }
      case 'user': {
        const colon = value.indexOf(':');
        auth = {
          type: 'basic',
          basic: colon === -1
            ? { username: value, password: '' }
            : { username: value.slice(0, colon), password: value.slice(colon + 1) },
        };
        break;
      }
      case 'oauth2-bearer':
        auth = { type: 'bearer', bearer: { token: value } };
        break;
      case 'user-agent':
        headers.push(row('User-Agent', value));
        break;
      case 'referer':
        headers.push(row('Referer', value));
        break;
      case 'cookie':
        if (value.includes('=')) headers.push(row('Cookie', value));
        else warnings.push('Cookies read from a file were skipped.');
        break;
      case 'get':
        forceGet = true;
        break;
      case 'head':
        isHead = true;
        break;
      case 'upload-file':
        warnings.push('The uploaded file (-T) was skipped.');
        break;
      default:
        break;
    }
  }

  url = url ?? positionals[0] ?? null;
  if (positionals.length > (url === positionals[0] ? 1 : 0)) {
    warnings.push('Only the first URL was imported.');
  }
  if (!url) throw new CurlParseError('The cURL command has no URL.');

  if (!method) {
    if (isHead) method = 'HEAD';
    else if (!forceGet && (dataParts.length > 0 || formFields.length > 0)) method = 'POST';
    else method = 'GET';
  }
  if (!SUPPORTED_METHODS.includes(method)) {
    throw new CurlParseError(
      `ApIForge sends ${SUPPORTED_METHODS.join(', ')} requests — this cURL command uses ${method}.`,
    );
  }

  // Authorization headers become the Auth tab, where they are editable as what they are.
  const authIndex = headers.findIndex((h) => h.key.toLowerCase() === 'authorization');
  if (authIndex !== -1 && auth.type === 'none') {
    const value = headers[authIndex].value;
    const bearer = /^Bearer\s+(.+)$/i.exec(value);
    const basic = /^Basic\s+(.+)$/i.exec(value);
    const credentials = basic && decodeBasic(basic[1]);
    if (bearer) {
      auth = { type: 'bearer', bearer: { token: bearer[1].trim() } };
      headers.splice(authIndex, 1);
    } else if (credentials) {
      auth = { type: 'basic', basic: credentials };
      headers.splice(authIndex, 1);
    }
  }

  // Fragment never reaches the server; the query string moves to the Params tab.
  let baseUrl = url.split('#')[0];
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl) && !baseUrl.startsWith('{{')) {
    baseUrl = `http://${baseUrl}`;
  }
  const params = [];
  const q = baseUrl.indexOf('?');
  if (q !== -1) {
    params.push(...parsePairs(baseUrl.slice(q + 1)).map((p) => row(p.key, p.value)));
    baseUrl = baseUrl.slice(0, q);
  }

  const data = dataParts.join('&');
  let body = { mode: 'none', raw: '', rows: [] };

  if (forceGet && data) {
    // -G moves the data into the query string instead of the body.
    params.push(...parsePairs(data).map((p) => row(p.key, p.value)));
  } else if (formFields.length > 0) {
    body = { mode: 'formdata', raw: '', rows: [], form: formFields };
    // The boundary in a copied Content-Type belongs to that one request; a new one is made.
    const ct = headers.findIndex((h) => h.key.toLowerCase() === 'content-type' && /multipart/i.test(h.value));
    if (ct !== -1) headers.splice(ct, 1);
  } else if (data) {
    const ctIndex = headers.findIndex((h) => h.key.toLowerCase() === 'content-type');
    const contentType = ctIndex === -1 ? '' : headers[ctIndex].value.toLowerCase();
    const dropContentType = (defaultType) => {
      if (ctIndex !== -1 && contentType.trim() === defaultType) headers.splice(ctIndex, 1);
    };

    if (contentType.includes('json') || (!contentType && !sawUrlencode && isJson(data))) {
      // Kept byte-for-byte: re-formatting through JSON.parse would round large numbers.
      body = { mode: 'json', raw: data, rows: [] };
      dropContentType('application/json');
    } else if (
      contentType.includes('x-www-form-urlencoded') ||
      (!contentType && (sawUrlencode || /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(data)))
    ) {
      body = { mode: 'urlencoded', raw: '', rows: parsePairs(data).map((p) => row(p.key, p.value)) };
      dropContentType('application/x-www-form-urlencoded');
    } else {
      body = { mode: 'text', raw: data, rows: [] };
      dropContentType('text/plain');
    }
  }

  return {
    config: { protocol: 'rest', method, url: baseUrl, params, headers, body, auth },
    warnings,
  };
}
