/**
 * Generates ready-to-run code for the request in the builder.
 *
 * Everything goes through one normalised model first — the same rules the server's
 * execution engine applies (enabled rows only, the body mode's default Content-Type
 * unless one was typed, auth applied last) — so every language sends the same request
 * that pressing Send does. {{variables}} are left exactly as written.
 */

export const SNIPPET_LANGUAGES = [
  { id: 'curl', label: 'cURL' },
  { id: 'fetch', label: 'JavaScript — Fetch' },
  { id: 'axios', label: 'Node.js — Axios' },
  { id: 'python', label: 'Python — Requests' },
  { id: 'powershell', label: 'PowerShell' },
];

const DEFAULT_CONTENT_TYPES = {
  json: 'application/json',
  urlencoded: 'application/x-www-form-urlencoded',
  text: 'text/plain',
};

function enabledRows(rows) {
  return (rows || [])
    .filter((r) => r?.enabled && r.key?.trim())
    .map((r) => [r.key.trim(), r.value ?? '']);
}

// encodeURIComponent, but a {{variable}} placeholder stays readable and replaceable.
function encodeQueryPart(text) {
  return encodeURIComponent(text).replace(/%7B%7B(.*?)%7D%7D/g, (_, name) => `{{${decodeURIComponent(name)}}}`);
}

function appendQuery(url, pairs) {
  if (pairs.length === 0) return url;
  const query = pairs.map(([k, v]) => `${encodeQueryPart(k)}=${encodeQueryPart(v)}`).join('&');
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** The request reduced to what goes on the wire. Exported for tests. */
export function buildSnippetModel(request) {
  const notes = [];
  const isGraphQL = request.protocol === 'graphql';
  const method = isGraphQL ? 'POST' : request.method || 'GET';
  const headers = enabledRows(request.headers);
  const query = enabledRows(request.params);
  const hasHeader = (name) => headers.some(([k]) => k.toLowerCase() === name.toLowerCase());

  let body = null;
  if (isGraphQL) {
    const payload = { query: request.graphql?.query ?? '' };
    const variables = request.graphql?.variables?.trim();
    if (variables) {
      const parsed = tryParseJson(variables);
      if (parsed.ok) payload.variables = parsed.value;
      else notes.push('The GraphQL variables are not valid JSON, so they were left out.');
    }
    if (request.graphql?.operationName?.trim()) payload.operationName = request.graphql.operationName.trim();
    body = { kind: 'json', raw: JSON.stringify(payload, null, 2), parsed: payload };
  } else {
    const { mode, raw, rows } = request.body || {};
    if (mode === 'json' && raw?.trim()) {
      const parsed = tryParseJson(raw);
      body = { kind: 'json', raw, parsed: parsed.ok ? parsed.value : undefined };
    } else if (mode === 'urlencoded') {
      const fields = enabledRows(rows);
      if (fields.length > 0) body = { kind: 'form', fields };
    } else if (mode === 'text' && raw?.trim()) {
      body = { kind: 'text', raw };
    } else if (mode === 'formdata') {
      const parts = (request.body?.form || [])
        .filter((r) => r?.enabled && r.key?.trim())
        .map((r) => ({ key: r.key.trim(), type: r.type === 'file' ? 'file' : 'text', value: r.value ?? '', fileName: r.fileName || 'file' }));
      if (parts.length > 0) body = { kind: 'multipart', parts };
    }
  }

  if (body?.kind === 'multipart') {
    // Every tool writes its own multipart Content-Type with the boundary it generates; a
    // fixed one would not match it.
    for (let i = headers.length - 1; i >= 0; i -= 1) {
      if (headers[i][0].toLowerCase() === 'content-type') headers.splice(i, 1);
    }
    if (body.parts.some((p) => p.type === 'file')) {
      notes.push('File fields point at the file by name — put the file next to the script, or change the path.');
    }
  } else if (body) {
    const mode = body.kind === 'form' ? 'urlencoded' : body.kind;
    if (!hasHeader('content-type')) headers.push(['Content-Type', DEFAULT_CONTENT_TYPES[mode]]);
  }

  // Auth last, so it wins over a same-named row — exactly as on the server.
  const setHeader = (name, value) => {
    const i = headers.findIndex(([k]) => k.toLowerCase() === name.toLowerCase());
    if (i !== -1) headers.splice(i, 1);
    headers.push([name, value]);
  };
  const auth = request.auth || {};
  let basic = null;
  switch (auth.type) {
    case 'basic':
      basic = { username: auth.basic?.username ?? '', password: auth.basic?.password ?? '' };
      break;
    case 'bearer':
      if (auth.bearer?.token) setHeader('Authorization', `Bearer ${auth.bearer.token}`);
      break;
    case 'apiKey': {
      const key = auth.apiKey?.key?.trim();
      if (key) {
        if (auth.apiKey.addTo === 'query') query.push([key, auth.apiKey.value ?? '']);
        else setHeader(key, auth.apiKey.value ?? '');
      }
      break;
    }
    case 'oauth2':
      if (auth.oauth2?.grantType === 'authorizationCode' && auth.oauth2?.accessToken) {
        setHeader('Authorization', `Bearer ${auth.oauth2.accessToken}`);
      } else {
        setHeader('Authorization', 'Bearer <access-token>');
        notes.push('OAuth 2.0 tokens are fetched when you press Send — replace <access-token> with a real one.');
      }
      break;
    default:
      break;
  }

  return {
    method,
    url: appendQuery((request.url || '').trim(), query),
    headers,
    basic,
    body,
    notes,
  };
}

// ---- String quoting -------------------------------------------------------

const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const jsString = (s) => JSON.stringify(String(s));
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function indentLines(text, pad) {
  return text.split('\n').map((line, i) => (i === 0 ? line : pad + line)).join('\n');
}

function pyLiteral(value, level = 0) {
  const pad = '    '.repeat(level + 1);
  const close = '    '.repeat(level);
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => pad + pyLiteral(v, level + 1)).join(',\n')}\n${close}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  return `{\n${entries
    .map(([k, v]) => `${pad}${JSON.stringify(k)}: ${pyLiteral(v, level + 1)}`)
    .join(',\n')}\n${close}}`;
}

function hasDuplicateKeys(pairs) {
  return new Set(pairs.map(([k]) => k)).size !== pairs.length;
}

// ---- Languages ------------------------------------------------------------

function curl(m) {
  const lines = [`curl --location${m.method === 'GET' ? '' : ` --request ${m.method}`} ${shellQuote(m.url)}`];
  for (const [k, v] of m.headers) lines.push(`--header ${shellQuote(`${k}: ${v}`)}`);
  if (m.basic) lines.push(`--user ${shellQuote(`${m.basic.username}:${m.basic.password}`)}`);
  if (m.body?.kind === 'form') {
    for (const [k, v] of m.body.fields) lines.push(`--data-urlencode ${shellQuote(`${k}=${v}`)}`);
  } else if (m.body?.kind === 'multipart') {
    for (const p of m.body.parts) {
      lines.push(`--form ${shellQuote(p.type === 'file' ? `${p.key}=@"${p.fileName}"` : `${p.key}=${p.value}`)}`);
    }
  } else if (m.body) {
    lines.push(`--data-raw ${shellQuote(m.body.raw)}`);
  }
  return lines.join(' \\\n  ');
}

function jsHeaders(m, pad) {
  const entries = m.headers.map(([k, v]) => `${pad}  ${jsString(k)}: ${jsString(v)},`);
  return `{\n${entries.join('\n')}\n${pad}}`;
}

function jsFormBody(fields) {
  if (hasDuplicateKeys(fields)) {
    return `new URLSearchParams([\n${fields.map(([k, v]) => `    [${jsString(k)}, ${jsString(v)}],`).join('\n')}\n  ])`;
  }
  return `new URLSearchParams({\n${fields.map(([k, v]) => `    ${jsString(k)}: ${jsString(v)},`).join('\n')}\n  })`;
}

function fetchSnippet(m) {
  const headers = [...m.headers.map(([k, v]) => `    ${jsString(k)}: ${jsString(v)},`)];
  if (m.basic) {
    headers.push(`    "Authorization": "Basic " + btoa(${jsString(`${m.basic.username}:${m.basic.password}`)}),`);
  }
  const options = [`  method: ${jsString(m.method)},`];
  if (headers.length > 0) options.push(`  headers: {\n${headers.join('\n')}\n  },`);
  if (m.body?.kind === 'json' && m.body.parsed !== undefined) {
    options.push(`  body: JSON.stringify(${indentLines(JSON.stringify(m.body.parsed, null, 2), '  ')}),`);
  } else if (m.body?.kind === 'form') {
    options.push(`  body: ${jsFormBody(m.body.fields)},`);
  } else if (m.body?.kind === 'multipart') {
    options.push('  body: form,');
  } else if (m.body) {
    options.push(`  body: ${jsString(m.body.raw)},`);
  }
  const before =
    m.body?.kind === 'multipart'
      ? [
          'const form = new FormData();',
          ...m.body.parts.map((p) =>
            p.type === 'file'
              ? `form.append(${jsString(p.key)}, fileInput.files[0]); // ${p.fileName}, from an <input type="file">`
              : `form.append(${jsString(p.key)}, ${jsString(p.value)});`,
          ),
          '',
        ]
      : [];
  return [
    ...before,
    `const response = await fetch(${jsString(m.url)}, {`,
    ...options,
    '});',
    '',
    'console.log(response.status);',
    'console.log(await response.text());',
  ].join('\n');
}

function axiosSnippet(m) {
  const options = [`  method: ${jsString(m.method.toLowerCase())},`, `  url: ${jsString(m.url)},`];
  if (m.headers.length > 0) options.push(`  headers: ${jsHeaders(m, '  ')},`);
  if (m.basic) {
    options.push(`  auth: { username: ${jsString(m.basic.username)}, password: ${jsString(m.basic.password)} },`);
  }
  if (m.body?.kind === 'json' && m.body.parsed !== undefined) {
    options.push(`  data: ${indentLines(JSON.stringify(m.body.parsed, null, 2), '  ')},`);
  } else if (m.body?.kind === 'form') {
    options.push(`  data: ${jsFormBody(m.body.fields)},`);
  } else if (m.body?.kind === 'multipart') {
    options.push('  data: form,');
  } else if (m.body) {
    options.push(`  data: ${jsString(m.body.raw)},`);
  }
  const multipart = m.body?.kind === 'multipart';
  const hasFile = multipart && m.body.parts.some((p) => p.type === 'file');
  return [
    "import axios from 'axios';",
    ...(hasFile ? ["import fs from 'node:fs';"] : []),
    '',
    ...(multipart
      ? [
          'const form = new FormData();',
          ...m.body.parts.map((p) =>
            p.type === 'file'
              ? `form.append(${jsString(p.key)}, new Blob([fs.readFileSync(${jsString(p.fileName)})]), ${jsString(p.fileName)});`
              : `form.append(${jsString(p.key)}, ${jsString(p.value)});`,
          ),
          '',
        ]
      : []),
    'const response = await axios({',
    ...options,
    '});',
    '',
    'console.log(response.status);',
    'console.log(response.data);',
  ].join('\n');
}

function pythonSnippet(m) {
  const lines = ['import requests', '', `url = ${JSON.stringify(m.url)}`];
  const args = ['url'];
  if (m.headers.length > 0) {
    lines.push(`headers = {\n${m.headers.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n}`);
    args.push('headers=headers');
  }
  if (m.body?.kind === 'json' && m.body.parsed !== undefined) {
    lines.push(`payload = ${pyLiteral(m.body.parsed)}`);
    args.push('json=payload');
  } else if (m.body?.kind === 'form') {
    lines.push(
      hasDuplicateKeys(m.body.fields)
        ? `payload = [\n${m.body.fields.map(([k, v]) => `    (${JSON.stringify(k)}, ${JSON.stringify(v)}),`).join('\n')}\n]`
        : `payload = {\n${m.body.fields.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n}`,
    );
    args.push('data=payload');
  } else if (m.body?.kind === 'multipart') {
    const text = m.body.parts.filter((p) => p.type === 'text');
    const files = m.body.parts.filter((p) => p.type === 'file');
    if (text.length > 0) {
      lines.push(`payload = {\n${text.map((p) => `    ${JSON.stringify(p.key)}: ${JSON.stringify(p.value)},`).join('\n')}\n}`);
      args.push('data=payload');
    }
    if (files.length > 0) {
      lines.push(`files = {\n${files.map((p) => `    ${JSON.stringify(p.key)}: open(${JSON.stringify(p.fileName)}, "rb"),`).join('\n')}\n}`);
      args.push('files=files');
    }
  } else if (m.body) {
    lines.push(`payload = ${JSON.stringify(m.body.raw)}`);
    args.push('data=payload');
  }
  if (m.basic) args.push(`auth=(${JSON.stringify(m.basic.username)}, ${JSON.stringify(m.basic.password)})`);
  lines.push(
    '',
    `response = requests.request(${JSON.stringify(m.method)}, ${args.join(', ')})`,
    '',
    'print(response.status_code)',
    'print(response.text)',
  );
  return lines.join('\n');
}

function powershellSnippet(m) {
  // Windows PowerShell 5.1 rejects Content-Type in -Headers; it has its own parameter.
  const contentType = m.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1];
  const headers = m.headers.filter(([k]) => k.toLowerCase() !== 'content-type');
  const lines = [];
  const params = [`-Uri ${psQuote(m.url)}`, `-Method ${m.method[0]}${m.method.slice(1).toLowerCase()}`];

  if (headers.length > 0 || m.basic) {
    lines.push(
      headers.length === 0
        ? '$headers = @{}'
        : `$headers = @{\n${headers.map(([k, v]) => `    ${psQuote(k)} = ${psQuote(v)}`).join('\n')}\n}`,
    );
    if (m.basic) {
      lines.push(
        `$credentials = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(${psQuote(`${m.basic.username}:${m.basic.password}`)}))`,
        "$headers['Authorization'] = \"Basic $credentials\"",
      );
    }
    params.push('-Headers $headers');
  }
  if (contentType) params.push(`-ContentType ${psQuote(contentType)}`);

  if (m.body?.kind === 'multipart') {
    lines.push(
      '# -Form needs PowerShell 7 or later.',
      `$form = @{\n${m.body.parts
        .map((p) => `    ${psQuote(p.key)} = ${p.type === 'file' ? `Get-Item -Path ${psQuote(p.fileName)}` : psQuote(p.value)}`)
        .join('\n')}\n}`,
    );
    params.push('-Form $form');
  } else if (m.body) {
    const raw = m.body.kind === 'form'
      ? m.body.fields.map(([k, v]) => `${encodeQueryPart(k)}=${encodeQueryPart(v)}`).join('&')
      : m.body.raw;
    // A here-string keeps multi-line JSON readable; it cannot contain its own terminator.
    lines.push(raw.includes('\n') && !/^'@/m.test(raw) ? `$body = @'\n${raw}\n'@` : `$body = ${psQuote(raw)}`);
    params.push('-Body $body');
  }

  lines.push('', `$response = Invoke-RestMethod ${params.join(' `\n    ')}`, '$response | ConvertTo-Json -Depth 10');
  return lines.join('\n').replace(/^\n/, '');
}

const GENERATORS = {
  curl,
  fetch: fetchSnippet,
  axios: axiosSnippet,
  python: pythonSnippet,
  powershell: powershellSnippet,
};

/** @returns {{ code: string, notes: string[] }} */
export function generateSnippet(request, language) {
  const model = buildSnippetModel(request);
  const generate = GENERATORS[language] ?? GENERATORS.curl;
  return { code: generate(model), notes: model.notes };
}
