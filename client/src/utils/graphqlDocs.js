import { typeRefName, namedTypeOf, groupTypes, rootTypes, fieldsOf, isInternalType } from './graphqlSchema.js';

// Search over an introspected schema. Built on the readers in graphqlSchema.js rather
// than re-walking the introspection payload, so the documentation explorer and the
// schema viewer always agree about what the schema contains.

const SCORE = {
  EXACT: 100,
  PREFIX: 50,
  CONTAINS: 25,
  DESCRIPTION: 10,
};

function entry({ kind, name, parent, signature, description, typeName }) {
  return {
    id: parent ? `${parent}.${name}` : name,
    kind,
    name,
    parent: parent || null,
    signature: signature || name,
    description: description || '',
    // The named type this entry points at, so a result can be navigated to.
    typeName: typeName || null,
  };
}

/**
 * Flattens the schema into everything a user might search for: types, their fields,
 * each field's arguments, input fields and enum values.
 */
export function buildSearchIndex(schema) {
  if (!schema?.__schema) return [];

  const index = [];
  const roots = rootTypes(schema);
  const groups = groupTypes(schema);

  const addFields = (type, operationKind) => {
    for (const field of fieldsOf(type)) {
      index.push(
        entry({
          kind: operationKind || 'field',
          name: field.name,
          parent: type.name,
          signature: `${field.name}: ${typeRefName(field.type)}`,
          description: field.description,
          typeName: namedTypeOf(field.type),
        }),
      );

      for (const arg of field.args || []) {
        index.push(
          entry({
            kind: 'argument',
            name: arg.name,
            parent: `${type.name}.${field.name}`,
            signature: `${arg.name}: ${typeRefName(arg.type)}`,
            description: arg.description,
            typeName: namedTypeOf(arg.type),
          }),
        );
      }
    }
  };

  // Operation roots are indexed with their own kinds so a result can say "query"
  // rather than the less useful "field on Query".
  if (roots.query) addFields(roots.query, 'query');
  if (roots.mutation) addFields(roots.mutation, 'mutation');
  if (roots.subscription) addFields(roots.subscription, 'subscription');

  for (const type of Object.values(groups).flat()) {
    if (isInternalType(type.name)) continue;

    index.push(
      entry({
        kind: 'type',
        name: type.name,
        signature: type.name,
        description: type.description,
        typeName: type.name,
      }),
    );

    addFields(type);

    for (const field of type.inputFields || []) {
      index.push(
        entry({
          kind: 'inputField',
          name: field.name,
          parent: type.name,
          signature: `${field.name}: ${typeRefName(field.type)}`,
          description: field.description,
          typeName: namedTypeOf(field.type),
        }),
      );
    }

    for (const value of type.enumValues || []) {
      index.push(
        entry({
          kind: 'enumValue',
          name: value.name,
          parent: type.name,
          signature: value.name,
          description: value.description,
          typeName: type.name,
        }),
      );
    }
  }

  return index;
}

function scoreEntry(item, needle) {
  const name = item.name.toLowerCase();

  if (name === needle) return SCORE.EXACT;
  if (name.startsWith(needle)) return SCORE.PREFIX;
  if (name.includes(needle)) return SCORE.CONTAINS;
  if (item.description.toLowerCase().includes(needle)) return SCORE.DESCRIPTION;
  return 0;
}

/**
 * Ranked search. Name matches always beat description matches, so searching "country"
 * surfaces the `country` field before every type that merely mentions countries.
 */
export function searchIndex(index, query, limit = 60) {
  const needle = (query || '').trim().toLowerCase();
  if (!needle) return [];

  return index
    .map((item) => ({ item, score: scoreEntry(item, needle) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map(({ item }) => item);
}

// Human label for a result's kind, used as a badge in the results list.
export function kindLabel(kind) {
  switch (kind) {
    case 'query':
      return 'query';
    case 'mutation':
      return 'mutation';
    case 'subscription':
      return 'subscription';
    case 'argument':
      return 'arg';
    case 'enumValue':
      return 'enum value';
    case 'inputField':
      return 'input field';
    case 'type':
      return 'type';
    default:
      return 'field';
  }
}
