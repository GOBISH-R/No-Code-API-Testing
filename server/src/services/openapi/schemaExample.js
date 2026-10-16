import { resolveNode } from './refs.js';

// Bounds recursion on a malformed or circular schema (e.g. a self-referencing object).
const MAX_DEPTH = 6;

function exampleForPrimitive(schema) {
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  switch (schema.type) {
    case 'string':
      return schema.format === 'date-time' ? new Date().toISOString() : '';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

// Walks an OpenAPI/Swagger (JSON Schema-ish) node and produces a plausible example
// value — real example/default values where the spec provides them, sensible
// type-shaped placeholders otherwise. Not a full JSON Schema implementation (no
// pattern/format generation beyond date-time); good enough to seed a usable body.
export function buildExample(schemaNode, spec, depth = 0) {
  if (!schemaNode || depth > MAX_DEPTH) return null;

  const schema = resolveNode(spec, schemaNode) ?? schemaNode;
  if (!schema || typeof schema !== 'object') return null;

  if (schema.example !== undefined) return schema.example;

  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce(
      (acc, sub) => ({ ...acc, ...buildExample(sub, spec, depth + 1) }),
      {},
    );
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return buildExample(schema.oneOf[0], spec, depth + 1);
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return buildExample(schema.anyOf[0], spec, depth + 1);
  }

  if (schema.type === 'object' || schema.properties) {
    const result = {};
    for (const [key, propSchema] of Object.entries(schema.properties || {})) {
      result[key] = buildExample(propSchema, spec, depth + 1);
    }
    return result;
  }

  if (schema.type === 'array') {
    if (!schema.items) return [];
    return [buildExample(schema.items, spec, depth + 1)];
  }

  return exampleForPrimitive(schema);
}
