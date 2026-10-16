import { describe, it, expect } from 'vitest';
import { validateRequestConfig } from '../../src/validators/requestValidator.js';

// Regression: the validator used to JSON.parse body/variables *before* {{placeholder}}
// substitution ran, rejecting requests that resolve to perfectly valid JSON. An
// unquoted placeholder — {"id": {{userId}}} — is the case that broke.

function restBody(raw) {
  return validateRequestConfig({
    protocol: 'rest',
    method: 'POST',
    url: 'https://api.example.com',
    body: { mode: 'json', raw },
  });
}

function graphqlVariables(variables) {
  return validateRequestConfig({
    protocol: 'graphql',
    method: 'POST',
    url: 'https://api.example.com/graphql',
    graphql: { query: '{ ok }', variables, operationName: '' },
  });
}

describe('JSON validation defers to substitution — GraphQL variables', () => {
  it('accepts an unquoted placeholder used as a numeric value', () => {
    expect(graphqlVariables('{"id": {{userId}}}')).toEqual([]);
  });

  it('accepts a quoted placeholder', () => {
    expect(graphqlVariables('{"id": "{{userId}}"}')).toEqual([]);
  });

  it('accepts a placeholder used as a whole object', () => {
    expect(graphqlVariables('{{wholePayload}}')).toEqual([]);
  });

  it('still rejects genuinely malformed JSON with no placeholder', () => {
    expect(graphqlVariables('{"id": }').join(' ')).toMatch(/valid JSON/);
  });

  it('still rejects a non-string', () => {
    expect(graphqlVariables(42).join(' ')).toMatch(/string of JSON/);
  });
});

describe('JSON validation defers to substitution — REST json body', () => {
  it('accepts an unquoted placeholder used as a numeric value', () => {
    expect(restBody('{"id": {{userId}}}')).toEqual([]);
  });

  it('accepts an unquoted placeholder used as a boolean', () => {
    expect(restBody('{"active": {{isActive}}}')).toEqual([]);
  });

  it('accepts a quoted placeholder', () => {
    expect(restBody('{"id": "{{userId}}"}')).toEqual([]);
  });

  it('still rejects genuinely malformed JSON with no placeholder', () => {
    expect(restBody('{broken').join(' ')).toMatch(/valid JSON/);
  });

  it('still accepts ordinary valid JSON', () => {
    expect(restBody('{"id": 1}')).toEqual([]);
  });

  it('still accepts an empty body', () => {
    expect(restBody('')).toEqual([]);
  });
});
