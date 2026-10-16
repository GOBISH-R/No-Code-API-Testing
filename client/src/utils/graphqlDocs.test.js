import { describe, it, expect } from 'vitest';
import { buildSearchIndex, searchIndex, kindLabel } from './graphqlDocs.js';

// Searching as the Docs panel does: build the index once, then search it.
const searchSchema = (schema, query, limit) => searchIndex(buildSearchIndex(schema), query, limit);

const NON_NULL = (inner) => ({ kind: 'NON_NULL', name: null, ofType: inner });
const NAMED = (kind, name) => ({ kind, name, ofType: null });

const schema = {
  __schema: {
    queryType: { name: 'Query' },
    mutationType: { name: 'Mutation' },
    subscriptionType: { name: 'Subscription' },
    types: [
      {
        kind: 'OBJECT',
        name: 'Query',
        fields: [
          {
            name: 'country',
            description: 'Look up a single country by its code',
            args: [{ name: 'code', description: 'ISO country code', type: NON_NULL(NAMED('SCALAR', 'ID')), defaultValue: null }],
            type: NAMED('OBJECT', 'Country'),
          },
        ],
      },
      {
        kind: 'OBJECT',
        name: 'Mutation',
        fields: [{ name: 'createCountry', description: null, args: [], type: NAMED('OBJECT', 'Country') }],
      },
      {
        kind: 'OBJECT',
        name: 'Subscription',
        fields: [{ name: 'countryAdded', description: null, args: [], type: NAMED('OBJECT', 'Country') }],
      },
      {
        kind: 'OBJECT',
        name: 'Country',
        description: 'A sovereign state',
        fields: [
          { name: 'name', description: 'The common name', args: [], type: NAMED('SCALAR', 'String') },
          { name: 'capital', description: null, args: [], type: NAMED('SCALAR', 'String') },
        ],
      },
      {
        kind: 'ENUM',
        name: 'Region',
        description: 'Geographic region',
        enumValues: [
          { name: 'EUROPE', description: 'The European region' },
          { name: 'ASIA', description: null },
        ],
      },
      {
        kind: 'INPUT_OBJECT',
        name: 'CountryFilter',
        inputFields: [{ name: 'continent', description: 'Filter by continent', type: NAMED('SCALAR', 'String') }],
      },
      { kind: 'SCALAR', name: 'ID' },
      { kind: 'OBJECT', name: '__Type', fields: [] },
    ],
  },
};

describe('buildSearchIndex', () => {
  const index = buildSearchIndex(schema);
  const byId = (id) => index.find((e) => e.id === id);

  it('indexes root operations with their own kinds', () => {
    expect(byId('Query.country').kind).toBe('query');
    expect(byId('Mutation.createCountry').kind).toBe('mutation');
    expect(byId('Subscription.countryAdded').kind).toBe('subscription');
  });

  it('indexes types', () => {
    expect(byId('Country').kind).toBe('type');
    expect(byId('Country').description).toBe('A sovereign state');
  });

  it('indexes fields of object types', () => {
    expect(byId('Country.name').signature).toBe('name: String');
  });

  it('indexes arguments, scoped to their field', () => {
    const arg = byId('Query.country.code');
    expect(arg.kind).toBe('argument');
    expect(arg.signature).toBe('code: ID!');
    expect(arg.description).toBe('ISO country code');
  });

  it('indexes enum values and input fields', () => {
    expect(byId('Region.EUROPE').kind).toBe('enumValue');
    expect(byId('CountryFilter.continent').kind).toBe('inputField');
  });

  it('records the named type each entry points at, for navigation', () => {
    expect(byId('Query.country').typeName).toBe('Country');
    expect(byId('Query.country.code').typeName).toBe('ID');
  });

  it('excludes introspection meta-types', () => {
    expect(index.some((e) => e.name === '__Type')).toBe(false);
  });

  it('returns an empty index for a missing schema', () => {
    expect(buildSearchIndex(null)).toEqual([]);
    expect(buildSearchIndex({})).toEqual([]);
  });
});

describe('searchSchema ranking', () => {
  it('ranks an exact name match first', () => {
    const results = searchSchema(schema, 'country');
    expect(results[0].name).toBe('country');
  });

  it('finds fields by prefix', () => {
    const names = searchSchema(schema, 'crea').map((r) => r.name);
    expect(names).toContain('createCountry');
  });

  it('finds entries by substring', () => {
    const names = searchSchema(schema, 'apit').map((r) => r.name);
    expect(names).toContain('capital');
  });

  it('matches descriptions when the name does not match', () => {
    // "sovereign" appears only in Country's description.
    const results = searchSchema(schema, 'sovereign');
    expect(results.map((r) => r.name)).toContain('Country');
  });

  it('ranks name matches above description matches', () => {
    // `country` (exact name) must beat entries that merely mention countries.
    const results = searchSchema(schema, 'country');
    expect(results[0].name).toBe('country');
    const descOnly = results.findIndex((r) => r.name === 'CountryFilter');
    expect(results.findIndex((r) => r.name === 'country')).toBeLessThan(descOnly === -1 ? Infinity : descOnly);
  });

  it('is case-insensitive', () => {
    expect(searchSchema(schema, 'COUNTRY').length).toBeGreaterThan(0);
  });

  it('finds enum values', () => {
    expect(searchSchema(schema, 'EUROPE').map((r) => r.name)).toContain('EUROPE');
  });

  it('finds arguments', () => {
    expect(searchSchema(schema, 'code').map((r) => r.name)).toContain('code');
  });

  it('returns nothing for an empty query', () => {
    expect(searchSchema(schema, '')).toEqual([]);
    expect(searchSchema(schema, '   ')).toEqual([]);
  });

  it('returns nothing for a term that appears nowhere', () => {
    expect(searchSchema(schema, 'zzzznotathing')).toEqual([]);
  });

  it('respects the result limit', () => {
    expect(searchSchema(schema, 'o', 3)).toHaveLength(3);
  });
});

describe('kindLabel', () => {
  it('labels each kind for display', () => {
    expect(kindLabel('query')).toBe('query');
    expect(kindLabel('argument')).toBe('arg');
    expect(kindLabel('enumValue')).toBe('enum value');
    expect(kindLabel('inputField')).toBe('input field');
    expect(kindLabel('field')).toBe('field');
  });
});
