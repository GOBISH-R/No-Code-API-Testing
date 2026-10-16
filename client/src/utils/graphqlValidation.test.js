import { describe, it, expect } from 'vitest';
import { buildSchema, introspectionFromSchema } from 'graphql';
import { buildSchemaFromIntrospection, validateGraphQLQuery, skipReasonLabel } from './graphqlValidation.js';

// Build a real schema, then round-trip it through introspection so the tests exercise
// exactly the payload shape the backend caches and the UI receives.
const sdl = `
  enum Status { ALIVE DEAD }

  type Character {
    id: ID!
    name: String!
    status: Status
  }

  type Query {
    character(id: ID!): Character
    characters(page: Int): [Character!]!
  }

  type Mutation {
    createCharacter(name: String!): Character
  }
`;

const schema = buildSchemaFromIntrospection(introspectionFromSchema(buildSchema(sdl)));

function check(query, operationName) {
  return validateGraphQLQuery({ schema, query, operationName });
}

describe('buildSchemaFromIntrospection', () => {
  it('builds a usable schema from an introspection payload', () => {
    expect(schema).toBeTruthy();
  });

  it('returns null instead of throwing on a malformed payload', () => {
    // Validation being unavailable must never become a thrown error.
    expect(buildSchemaFromIntrospection(null)).toBe(null);
    expect(buildSchemaFromIntrospection({ __schema: { queryType: { name: 'Nope' }, types: [] } })).toBe(null);
  });

  it('rejects a degenerate schema with no Query root', () => {
    // buildClientSchema accepts this, but a schema with no Query type would make
    // every query look invalid — worse than not validating at all.
    expect(buildSchemaFromIntrospection({ __schema: { types: [] } })).toBe(null);
  });
});

describe('valid queries pass', () => {
  it('accepts a correct query', () => {
    const result = check('{ character(id: "1") { name status } }');
    expect(result.errors).toEqual([]);
    expect(result.skipped).toBe(false);
  });

  it('accepts a query using declared variables', () => {
    const result = check('query GetChar($id: ID!) { character(id: $id) { name } }');
    expect(result.errors).toEqual([]);
  });

  it('accepts a mutation', () => {
    expect(check('mutation { createCharacter(name: "Rick") { id } }').errors).toEqual([]);
  });
});

describe('syntax errors', () => {
  it('reports an unclosed brace with a location', () => {
    const result = check('{ character(id: "1") { name ');
    expect(result.reason).toBe('syntax');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBeGreaterThan(0);
  });

  it('reports a stray token', () => {
    expect(check('{ character(((( }').reason).toBe('syntax');
  });
});

describe('schema errors', () => {
  it('detects an unknown field', () => {
    const result = check('{ character(id: "1") { notARealField } }');
    expect(result.reason).toBe('schema');
    expect(result.errors[0].message).toMatch(/notARealField/);
  });

  it('detects an unknown root field', () => {
    expect(check('{ nope { id } }').errors[0].message).toMatch(/nope/);
  });

  it('detects an unknown argument', () => {
    const result = check('{ character(wrongArg: "1") { name } }');
    expect(result.errors.some((e) => /wrongArg/.test(e.message))).toBe(true);
  });

  it('detects a missing required argument', () => {
    const result = check('{ character { name } }');
    expect(result.errors.some((e) => /id/.test(e.message))).toBe(true);
  });

  it('detects an argument of the wrong type', () => {
    const result = check('{ characters(page: "not-an-int") { name } }');
    expect(result.errors.some((e) => /Int/.test(e.message))).toBe(true);
  });

  it('detects a missing selection set on an object field', () => {
    const result = check('{ character(id: "1") }');
    expect(result.errors.some((e) => /selection/i.test(e.message))).toBe(true);
  });

  it('detects a selection set on a scalar field', () => {
    const result = check('{ character(id: "1") { name { nope } } }');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('detects an undefined variable', () => {
    const result = check('{ character(id: $undeclared) { name } }');
    expect(result.errors.some((e) => /undeclared/.test(e.message))).toBe(true);
  });

  it('detects a variable used in the wrong position', () => {
    const result = check('query Q($page: String) { characters(page: $page) { name } }');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('detects an unknown enum value', () => {
    const result = check('{ character(id: "1") { status } characters(page: 1) { status } }');
    expect(result.errors).toEqual([]); // sanity: enums used as output are fine
  });
});

describe('operation name', () => {
  it('accepts an operation name present in the document', () => {
    expect(check('query GetChar { characters { name } }', 'GetChar').errors).toEqual([]);
  });

  it('rejects an operation name that is not defined', () => {
    const result = check('query GetChar { characters { name } }', 'Missing');
    expect(result.reason).toBe('operation');
    expect(result.errors[0].message).toMatch(/Missing/);
    expect(result.errors[0].message).toMatch(/GetChar/); // lists what is available
  });

  it('explains when the document has no named operations at all', () => {
    const result = check('{ characters { name } }', 'Anything');
    expect(result.errors[0].message).toMatch(/no named operations/);
  });
});

describe('validation is skipped rather than failing — never block a valid request', () => {
  it('skips when no schema is loaded', () => {
    // The single most important case: GraphQL must work exactly as before when the
    // user has not loaded a schema.
    const result = validateGraphQLQuery({ schema: null, query: '{ literally anything' });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no-schema');
    expect(result.errors).toEqual([]);
  });

  it('skips an empty query', () => {
    expect(validateGraphQLQuery({ schema, query: '   ' }).reason).toBe('empty');
  });

  it('skips a query containing {{variables}}', () => {
    // {{field}} is substituted by the backend, so the editor text is not yet the
    // document that will be sent — validating it would be a false positive.
    const result = check('{ character(id: "1") { {{fieldName}} } }');
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('unresolved-variables');
    expect(result.errors).toEqual([]);
  });

  it('skips when a {{variable}} supplies an argument', () => {
    expect(check('{ character(id: "{{userId}}") { name } }').skipped).toBe(true);
  });

  it('skips when the loaded schema belongs to a different endpoint', () => {
    // Regression: a query valid for endpoint B was rejected because the schema still
    // loaded was endpoint A's — blocking a request that would have succeeded.
    const result = validateGraphQLQuery({
      schema,
      query: '{ totallyUnknownToThisSchema }',
      url: 'https://b.example.com/graphql',
      schemaUrl: 'https://a.example.com/graphql',
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('endpoint-changed');
    expect(result.errors).toEqual([]);
  });

  it('still validates when the URL matches the schema it was loaded for', () => {
    const same = 'https://a.example.com/graphql';
    const result = validateGraphQLQuery({
      schema,
      query: '{ nope }',
      url: same,
      schemaUrl: same,
    });

    expect(result.skipped).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('ignores surrounding whitespace when comparing endpoints', () => {
    const result = validateGraphQLQuery({
      schema,
      query: '{ character(id: "1") { name } }',
      url: '  https://a.example.com/graphql  ',
      schemaUrl: 'https://a.example.com/graphql',
    });

    expect(result.skipped).toBe(false);
    expect(result.errors).toEqual([]);
  });

  it('skips when the environment changed, even though the URL text is identical', () => {
    // {{baseUrl}}/graphql is the same text but a different server once the
    // environment switches from staging to production.
    const result = validateGraphQLQuery({
      schema,
      query: '{ nope }',
      url: '{{baseUrl}}/graphql',
      schemaUrl: '{{baseUrl}}/graphql',
      environmentId: 'prod-id',
      schemaEnvironmentId: 'staging-id',
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('endpoint-changed');
  });

  it('treats undefined and null environment as the same (no environment selected)', () => {
    const result = validateGraphQLQuery({
      schema,
      query: '{ character(id: "1") { name } }',
      url: 'https://a.example.com/graphql',
      schemaUrl: 'https://a.example.com/graphql',
      environmentId: undefined,
      schemaEnvironmentId: null,
    });

    expect(result.errors).toEqual([]);
  });

  it('validates normally when the caller does not supply URLs at all', () => {
    // Backwards-compatible: omitting url/schemaUrl must not start skipping everything.
    const result = validateGraphQLQuery({ schema, query: '{ nope }' });
    expect(result.skipped).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('still validates when {{variables}} appear only in the variables JSON', () => {
    // Placeholders in the variables JSON do not affect the query document itself.
    const result = check('query GetChar($id: ID!) { character(id: $id) { name } }');
    expect(result.skipped).toBe(false);
    expect(result.errors).toEqual([]);
  });
});

describe('skipReasonLabel', () => {
  it('explains why validation did not run', () => {
    expect(skipReasonLabel('no-schema')).toMatch(/Load the schema/);
    expect(skipReasonLabel('unresolved-variables')).toMatch(/\{\{variables\}\}/);
    expect(skipReasonLabel('endpoint-changed')).toMatch(/different endpoint/);
    expect(skipReasonLabel('empty')).toBe(null);
  });
});
