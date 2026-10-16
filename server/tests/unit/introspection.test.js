import { describe, it, expect } from 'vitest';
import { interpretIntrospectionResponse } from '../../src/services/graphql/introspectionService.js';
import { schemaSizeOf, MAX_SCHEMA_BYTES } from '../../src/services/graphql/schemaService.js';
import { ValidationError } from '../../src/utils/errors.js';

// A minimal but structurally valid introspection result — buildClientSchema must be
// able to build a real schema from it, so the shape matters.
function validIntrospection() {
  const scalar = (name) => ({ kind: 'SCALAR', name, description: null, fields: null, inputFields: null, interfaces: null, enumValues: null, possibleTypes: null });

  return {
    __schema: {
      queryType: { name: 'Query' },
      mutationType: null,
      subscriptionType: null,
      types: [
        {
          kind: 'OBJECT',
          name: 'Query',
          description: null,
          fields: [
            {
              name: 'hello',
              description: 'A greeting',
              args: [],
              type: { kind: 'SCALAR', name: 'String', ofType: null },
              isDeprecated: false,
              deprecationReason: null,
            },
          ],
          inputFields: null,
          interfaces: [],
          enumValues: null,
          possibleTypes: null,
        },
        scalar('String'),
        scalar('Boolean'),
      ],
      directives: [],
    },
  };
}

function okResult(body, status = 200) {
  return { success: true, meta: { time: 12 }, response: { status, headers: {}, body, size: 10 }, error: null };
}

describe('interpretIntrospectionResponse — success', () => {
  it('returns the introspection payload for a valid schema', () => {
    // A GraphQL response always nests the payload under `data`.
    const introspection = interpretIntrospectionResponse(okResult({ data: validIntrospection() }));
    expect(introspection.__schema.queryType.name).toBe('Query');
  });

  it('preserves field descriptions, which the docs explorer depends on', () => {
    const introspection = interpretIntrospectionResponse(okResult({ data: validIntrospection() }));
    const query = introspection.__schema.types.find((t) => t.name === 'Query');
    expect(query.fields[0].description).toBe('A greeting');
  });
});

describe('interpretIntrospectionResponse — transport failures', () => {
  it('surfaces a timeout from the executor rather than inventing its own message', () => {
    const result = { success: false, response: null, error: { message: 'The request timed out after 15s.', code: 'TIMEOUT' } };
    expect(() => interpretIntrospectionResponse(result)).toThrow(/timed out/);
  });

  it('surfaces a DNS failure', () => {
    const result = { success: false, response: null, error: { message: 'Could not resolve the host.', code: 'DNS_ERROR' } };
    expect(() => interpretIntrospectionResponse(result)).toThrow(/resolve the host/);
  });
});

describe('interpretIntrospectionResponse — authentication', () => {
  it('points at the Auth tab on 401', () => {
    expect(() => interpretIntrospectionResponse(okResult({}, 401))).toThrow(/Auth tab/);
  });

  it('points at the Auth tab on 403', () => {
    expect(() => interpretIntrospectionResponse(okResult({}, 403))).toThrow(/Auth tab/);
  });

  it('reports other non-2xx statuses plainly', () => {
    expect(() => interpretIntrospectionResponse(okResult({}, 500))).toThrow(/HTTP 500/);
  });
});

describe('interpretIntrospectionResponse — introspection disabled', () => {
  it('explains the errors array that a locked-down server returns', () => {
    // The most common real-world failure: HTTP 200 with a refusal in `errors`.
    const body = { errors: [{ message: 'GraphQL introspection is not allowed' }] };
    expect(() => interpretIntrospectionResponse(okResult(body))).toThrow(/refused introspection/);
    expect(() => interpretIntrospectionResponse(okResult(body))).toThrow(/introspection is not allowed/);
  });

  it('mentions that disabling introspection is a deliberate choice', () => {
    const body = { errors: [{ message: 'nope' }] };
    expect(() => interpretIntrospectionResponse(okResult(body))).toThrow(/disable introspection deliberately/);
  });
});

describe('interpretIntrospectionResponse — malformed responses', () => {
  it('rejects a non-JSON body', () => {
    expect(() => interpretIntrospectionResponse(okResult('<html>not graphql</html>'))).toThrow(/did not return JSON/);
  });

  it('rejects JSON with no __schema', () => {
    expect(() => interpretIntrospectionResponse(okResult({ data: { something: 1 } }))).toThrow(/no __schema/);
  });

  it('rejects a __schema that cannot be built into a real schema', () => {
    const broken = { data: { __schema: { queryType: { name: 'Query' }, types: [] } } };
    expect(() => interpretIntrospectionResponse(okResult(broken))).toThrow(/could not be parsed/);
  });

  it('always throws ValidationError so the controller maps it to 400', () => {
    expect(() => interpretIntrospectionResponse(okResult('nope'))).toThrow(ValidationError);
  });
});

describe('schema size guard', () => {
  it('measures serialized size', () => {
    expect(schemaSizeOf({ a: 'bc' })).toBe(JSON.stringify({ a: 'bc' }).length);
  });

  it('has a limit well under MongoDB document ceiling', () => {
    expect(MAX_SCHEMA_BYTES).toBeLessThan(16 * 1024 * 1024);
  });
});
