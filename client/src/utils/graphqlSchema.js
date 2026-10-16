// Pure readers over a raw introspection payload (the `{ __schema: … }` object the
// backend caches). Kept free of React and of any fetching so the schema viewer,
// pre-send validation and the documentation explorer all read the schema the same
// way instead of each re-deriving it.

// Introspection's own meta-types (__Schema, __Type, …) are part of every schema but
// are never what a user is trying to browse.
export function isInternalType(name) {
  return typeof name === 'string' && name.startsWith('__');
}

/**
 * Renders an introspection type reference as GraphQL source notation.
 *
 * Type refs are nested wrappers — NON_NULL(LIST(OBJECT Character)) — which is how
 * `[Character]!` is encoded. Unwrapping recursively is the only correct way to read
 * them; the wrappers carry no `name` of their own.
 */
export function typeRefName(typeRef) {
  if (!typeRef) return 'Unknown';
  if (typeRef.kind === 'NON_NULL') return `${typeRefName(typeRef.ofType)}!`;
  if (typeRef.kind === 'LIST') return `[${typeRefName(typeRef.ofType)}]`;
  return typeRef.name || 'Unknown';
}

// The innermost named type, ignoring list/non-null wrappers — what you navigate to
// when following a field's type.
export function namedTypeOf(typeRef) {
  let current = typeRef;
  while (current?.ofType) current = current.ofType;
  return current?.name || null;
}

function rootType(schema, key) {
  const name = schema?.__schema?.[key]?.name;
  if (!name) return null;
  return findType(schema, name);
}

export function findType(schema, name) {
  if (!name) return null;
  return (schema?.__schema?.types || []).find((t) => t.name === name) || null;
}

// The three operation roots, resolved to their full type definitions. A schema with
// no mutations or subscriptions simply yields null for those.
export function rootTypes(schema) {
  return {
    query: rootType(schema, 'queryType'),
    mutation: rootType(schema, 'mutationType'),
    subscription: rootType(schema, 'subscriptionType'),
  };
}

const KIND_GROUPS = {
  OBJECT: 'objects',
  INTERFACE: 'interfaces',
  ENUM: 'enums',
  INPUT_OBJECT: 'inputs',
  SCALAR: 'scalars',
  UNION: 'unions',
};

/**
 * Groups every user-facing type by kind, excluding introspection meta-types and the
 * operation roots (which are presented separately as Queries/Mutations/Subscriptions
 * rather than as ordinary object types).
 */
export function groupTypes(schema) {
  const groups = { objects: [], interfaces: [], enums: [], inputs: [], scalars: [], unions: [] };
  const roots = schema?.__schema;
  const rootNames = new Set(
    [roots?.queryType?.name, roots?.mutationType?.name, roots?.subscriptionType?.name].filter(Boolean),
  );

  for (const type of roots?.types || []) {
    if (!type?.name || isInternalType(type.name) || rootNames.has(type.name)) continue;
    const group = KIND_GROUPS[type.kind];
    if (group) groups[group].push(type);
  }

  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => a.name.localeCompare(b.name));
  }

  return groups;
}

// Formats one argument as it would appear in a signature, including its default.
export function formatArg(arg) {
  const base = `${arg.name}: ${typeRefName(arg.type)}`;
  return arg.defaultValue !== null && arg.defaultValue !== undefined
    ? `${base} = ${arg.defaultValue}`
    : base;
}

// A field's full signature, e.g. `character(id: ID!): Character`.
export function formatFieldSignature(field) {
  const args = field.args?.length ? `(${field.args.map(formatArg).join(', ')})` : '';
  return `${field.name}${args}: ${typeRefName(field.type)}`;
}

// A schema may legitimately omit fields (scalars, unions) — callers should render
// nothing rather than crash, so this always returns an array.
export function fieldsOf(type) {
  return type?.fields || [];
}

export function schemaStats(schema) {
  const groups = groupTypes(schema);
  const roots = rootTypes(schema);
  return {
    queries: fieldsOf(roots.query).length,
    mutations: fieldsOf(roots.mutation).length,
    subscriptions: fieldsOf(roots.subscription).length,
    types: Object.values(groups).reduce((sum, list) => sum + list.length, 0),
  };
}
