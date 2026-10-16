import { parseSpecText, detectVersion } from './specParser.js';
import { resolveNode } from './refs.js';
import { buildExample } from './schemaExample.js';
import { mapSecurity } from './securityMapper.js';
import { ValidationError } from '../../utils/errors.js';
import { FORMAT, VERSION, MAX_IMPORT_REQUESTS } from '../../importExport/collectionFormat.js';

// Only the methods our Request Builder supports; a spec's HEAD/OPTIONS/TRACE
// operations (if any) are skipped rather than erroring the whole import.
const SUPPORTED_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function resolveBaseUrl(spec, version) {
  if (version === 'openapi3') {
    return spec.servers?.[0]?.url || '';
  }
  const host = spec.host;
  if (!host) return '';
  const scheme = spec.schemes?.[0] || 'https';
  return `${scheme}://${host}${spec.basePath || ''}`;
}

// OpenAPI path/server templates use {name}; our app's templating convention (already
// used throughout environments/globals/runtime variables) is {{name}} — one regex
// covers both path parameters and server variables in a single pass.
function templateUrl(rawUrl) {
  return rawUrl.replace(/\{([^{}]+)\}/g, '{{$1}}');
}

function paramsAt(spec, allParams, location) {
  return allParams
    .map((p) => resolveNode(spec, p) ?? p)
    .filter((p) => p?.in === location)
    .map((p) => ({
      key: String(p.name ?? ''),
      // OpenAPI 3 nests example/default under a `schema`; Swagger 2.0 non-body
      // parameters carry them directly on the parameter object itself.
      value: String(p.example ?? p.default ?? p.schema?.example ?? p.schema?.default ?? ''),
      enabled: Boolean(p.required),
    }))
    .filter((row) => row.key.trim());
}

function firstSuccessStatus(responses) {
  const codes = Object.keys(responses || {})
    .filter((code) => /^2\d\d$/.test(code))
    .sort();
  return codes[0] || '200';
}

function buildBody(spec, version, operation) {
  let schema;

  if (version === 'openapi3') {
    const requestBody = resolveNode(spec, operation.requestBody) ?? operation.requestBody;
    schema = requestBody?.content?.['application/json']?.schema;
  } else {
    const bodyParam = (operation.parameters || [])
      .map((p) => resolveNode(spec, p) ?? p)
      .find((p) => p?.in === 'body');
    schema = bodyParam?.schema;
  }

  if (!schema) return { mode: 'none', raw: '' };

  const example = buildExample(schema, spec) ?? {};
  return { mode: 'json', raw: JSON.stringify(example, null, 2) };
}

function operationName(method, path, operation) {
  if (operation.summary?.trim()) return operation.summary.trim();
  if (operation.operationId?.trim()) return operation.operationId.trim();
  return `${method.toUpperCase()} ${path}`;
}

// Converts a parsed OpenAPI 3.x / Swagger 2.0 document into the same portable
// collection format Phase 16's import/export uses — one saved request per operation,
// so the existing validate + persist (atomic, all-or-nothing) pipeline handles the
// rest with no separate code path.
export function convertOpenApiToCollection(specText, { name } = {}) {
  const spec = parseSpecText(specText);
  const version = detectVersion(spec);

  if (!version) {
    throw new ValidationError('Unsupported document — expected an OpenAPI 3.x or Swagger 2.0 spec.');
  }

  const baseUrl = resolveBaseUrl(spec, version);
  const paths = spec.paths || {};
  const requests = [];

  for (const [path, rawPathItem] of Object.entries(paths)) {
    const pathItem = resolveNode(spec, rawPathItem) ?? rawPathItem;
    if (!pathItem || typeof pathItem !== 'object') continue;

    const pathLevelParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const method of SUPPORTED_METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;

      if (requests.length >= MAX_IMPORT_REQUESTS) {
        throw new ValidationError(
          `This spec describes more than ${MAX_IMPORT_REQUESTS} operations, more than one import can create.`,
        );
      }

      const allParams = [...pathLevelParams, ...(operation.parameters || [])];

      requests.push({
        name: operationName(method, path, operation),
        method: method.toUpperCase(),
        url: templateUrl(`${baseUrl}${path}`),
        params: paramsAt(spec, allParams, 'query'),
        headers: paramsAt(spec, allParams, 'header'),
        body: buildBody(spec, version, operation),
        auth: mapSecurity(spec, version, operation.security),
        assertions: [
          {
            source: 'status',
            operator: 'equals',
            expected: firstSuccessStatus(operation.responses),
            path: '',
            headerName: '',
          },
        ],
        captures: [],
      });
    }
  }

  if (requests.length === 0) {
    throw new ValidationError('No GET/POST/PUT/PATCH/DELETE operations were found in this document.');
  }

  return {
    format: FORMAT,
    version: VERSION,
    collection: {
      name: name?.trim() || spec.info?.title?.trim() || 'Imported API',
      description: spec.info?.description || '',
      requests,
    },
  };
}
