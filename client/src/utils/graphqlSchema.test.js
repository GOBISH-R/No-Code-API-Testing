import { describe, it, expect } from 'vitest';
import {
  isInternalType,
  typeRefName,
  namedTypeOf,
  findType,
  rootTypes,
  groupTypes,
  formatArg,
  formatFieldSignature,
  fieldsOf,
  schemaStats,
} from './graphqlSchema.js';

// Shapes mirror real introspection output: type references are nested wrappers,
// not flat names.
const NON_NULL = (inner) => ({ kind: 'NON_NULL', name: null, ofType: inner });
const LIST = (inner) => ({ kind: 'LIST', name: null, ofType: inner });
const NAMED = (kind, name) => ({ kind, name, ofType: null });

const schema = {
  __schema: {
    queryType: { name: 'Query' },
    mutationType: { name: 'Mutation' },
    subscriptionType: null,
    types: [
      {
        kind: 'OBJECT',
        name: 'Query',
        fields: [
          {
            name: 'character',
            description: 'Get a character by id',
            args: [{ name: 'id', type: NON_NULL(NAMED('SCALAR', 'ID')), defaultValue: null }],
            type: NAMED('OBJECT', 'Character'),
          },
          {
            name: 'characters',
            description: null,
            args: [{ name: 'page', type: NAMED('SCALAR', 'Int'), defaultValue: '1' }],
            type: NON_NULL(LIST(NON_NULL(NAMED('OBJECT', 'Character')))),
          },
        ],
      },
      { kind: 'OBJECT', name: 'Mutation', fields: [{ name: 'createCharacter', description: null, args: [], type: NAMED('OBJECT', 'Character') }] },
      {
        kind: 'OBJECT',
        name: 'Character',
        description: 'A character',
        fields: [{ name: 'name', description: null, args: [], type: NAMED('SCALAR', 'String') }],
      },
      { kind: 'ENUM', name: 'Status', enumValues: [{ name: 'ALIVE' }, { name: 'DEAD' }] },
      { kind: 'INPUT_OBJECT', name: 'FilterInput', inputFields: [] },
      { kind: 'INTERFACE', name: 'Node', fields: [] },
      { kind: 'UNION', name: 'SearchResult' },
      { kind: 'SCALAR', name: 'ID' },
      { kind: 'SCALAR', name: 'String' },
      // Introspection meta-types are always present and must never be shown.
      { kind: 'OBJECT', name: '__Schema', fields: [] },
      { kind: 'OBJECT', name: '__Type', fields: [] },
    ],
  },
};

describe('isInternalType', () => {
  it('identifies introspection meta-types', () => {
    expect(isInternalType('__Schema')).toBe(true);
    expect(isInternalType('Character')).toBe(false);
    expect(isInternalType(undefined)).toBe(false);
  });
});

describe('typeRefName', () => {
  it('renders a plain named type', () => {
    expect(typeRefName(NAMED('OBJECT', 'Character'))).toBe('Character');
  });

  it('renders non-null', () => {
    expect(typeRefName(NON_NULL(NAMED('SCALAR', 'ID')))).toBe('ID!');
  });

  it('renders a list', () => {
    expect(typeRefName(LIST(NAMED('OBJECT', 'Character')))).toBe('[Character]');
  });

  it('renders deeply nested wrappers in GraphQL notation', () => {
    // NON_NULL(LIST(NON_NULL(Character))) is how `[Character!]!` is encoded.
    expect(typeRefName(NON_NULL(LIST(NON_NULL(NAMED('OBJECT', 'Character')))))).toBe('[Character!]!');
  });

  it('degrades gracefully on a missing or malformed ref', () => {
    expect(typeRefName(null)).toBe('Unknown');
    expect(typeRefName({ kind: 'OBJECT', name: null })).toBe('Unknown');
  });
});

describe('namedTypeOf', () => {
  it('unwraps to the innermost named type', () => {
    expect(namedTypeOf(NON_NULL(LIST(NON_NULL(NAMED('OBJECT', 'Character')))))).toBe('Character');
    expect(namedTypeOf(NAMED('SCALAR', 'String'))).toBe('String');
  });

  it('returns null when there is nothing to unwrap', () => {
    expect(namedTypeOf(null)).toBe(null);
  });
});

describe('findType / rootTypes', () => {
  it('finds a type by name', () => {
    expect(findType(schema, 'Character').kind).toBe('OBJECT');
    expect(findType(schema, 'Nope')).toBe(null);
  });

  it('resolves operation roots to full type definitions', () => {
    const roots = rootTypes(schema);
    expect(roots.query.name).toBe('Query');
    expect(roots.mutation.name).toBe('Mutation');
  });

  it('returns null for an absent subscription root', () => {
    // Most schemas have no subscriptions — that must not be an error.
    expect(rootTypes(schema).subscription).toBe(null);
  });

  it('survives an empty or missing schema', () => {
    expect(rootTypes(null).query).toBe(null);
    expect(rootTypes({}).query).toBe(null);
  });
});

describe('groupTypes', () => {
  const groups = groupTypes(schema);

  it('groups each kind', () => {
    expect(groups.objects.map((t) => t.name)).toEqual(['Character']);
    expect(groups.enums.map((t) => t.name)).toEqual(['Status']);
    expect(groups.inputs.map((t) => t.name)).toEqual(['FilterInput']);
    expect(groups.interfaces.map((t) => t.name)).toEqual(['Node']);
    expect(groups.unions.map((t) => t.name)).toEqual(['SearchResult']);
  });

  it('excludes introspection meta-types', () => {
    const all = Object.values(groups).flat().map((t) => t.name);
    expect(all).not.toContain('__Schema');
    expect(all).not.toContain('__Type');
  });

  it('excludes operation roots, which are presented separately', () => {
    expect(groups.objects.map((t) => t.name)).not.toContain('Query');
    expect(groups.objects.map((t) => t.name)).not.toContain('Mutation');
  });

  it('sorts each group by name', () => {
    expect(groups.scalars.map((t) => t.name)).toEqual(['ID', 'String']);
  });

  it('survives a missing schema', () => {
    expect(groupTypes(null).objects).toEqual([]);
  });
});

describe('signatures', () => {
  it('formats an argument', () => {
    expect(formatArg({ name: 'id', type: NON_NULL(NAMED('SCALAR', 'ID')), defaultValue: null })).toBe('id: ID!');
  });

  it('includes a default value when present', () => {
    expect(formatArg({ name: 'page', type: NAMED('SCALAR', 'Int'), defaultValue: '1' })).toBe('page: Int = 1');
  });

  it('formats a full field signature', () => {
    const field = findType(schema, 'Query').fields[0];
    expect(formatFieldSignature(field)).toBe('character(id: ID!): Character');
  });

  it('omits empty parentheses for a field with no arguments', () => {
    const field = findType(schema, 'Character').fields[0];
    expect(formatFieldSignature(field)).toBe('name: String');
  });
});

describe('fieldsOf', () => {
  it('returns an array even for types that legitimately have no fields', () => {
    // Scalars and unions have no `fields` — the viewer must render nothing, not crash.
    expect(fieldsOf(findType(schema, 'ID'))).toEqual([]);
    expect(fieldsOf(null)).toEqual([]);
  });
});

describe('schemaStats', () => {
  it('counts operations and types', () => {
    const stats = schemaStats(schema);
    expect(stats.queries).toBe(2);
    expect(stats.mutations).toBe(1);
    expect(stats.subscriptions).toBe(0);
    expect(stats.types).toBe(7);
  });
});
