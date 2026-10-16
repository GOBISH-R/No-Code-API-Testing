// Maps an OpenAPI/Swagger security requirement to our auth shape. Only what our
// Request Builder can actually represent gets mapped (see Phase 17): HTTP basic,
// HTTP bearer, apiKey, and OAuth2 Client Credentials specifically. Anything else
// (Authorization Code, implicit, password grant, openIdConnect) has no representation
// here and falls back to "none" — the user fills auth in by hand for those.

function blankAuth() {
  return {
    type: 'none',
    basic: { username: '', password: '' },
    bearer: { token: '' },
    apiKey: { key: '', value: '', addTo: 'header' },
    oauth2: { tokenUrl: '', clientId: '', clientSecret: '', scope: '' },
  };
}

function schemesFor(spec, version) {
  return version === 'openapi3'
    ? spec.components?.securitySchemes || {}
    : spec.securityDefinitions || {};
}

export function mapSecurity(spec, version, operationSecurity) {
  const requirement = operationSecurity ?? spec.security;
  const auth = blankAuth();

  if (!Array.isArray(requirement) || requirement.length === 0) return auth;

  const firstRequirement = requirement.find((r) => r && Object.keys(r).length > 0);
  if (!firstRequirement) return auth;

  const [schemeName, scopes] = Object.entries(firstRequirement)[0];
  const scheme = schemesFor(spec, version)[schemeName];
  if (!scheme) return auth;

  if (scheme.type === 'http' && scheme.scheme === 'bearer') {
    auth.type = 'bearer';
  } else if ((scheme.type === 'http' && scheme.scheme === 'basic') || scheme.type === 'basic') {
    // Swagger 2.0 spells HTTP Basic as its own top-level type; OpenAPI 3 nests it
    // under type "http".
    auth.type = 'basic';
  } else if (scheme.type === 'apiKey') {
    auth.type = 'apiKey';
    auth.apiKey.key = scheme.name || '';
    auth.apiKey.addTo = scheme.in === 'query' ? 'query' : 'header';
  } else if (scheme.type === 'oauth2') {
    // Swagger 2.0 calls the client-credentials-shaped flow "application"; OpenAPI 3
    // nests named flows under `flows`.
    const flow = version === 'openapi3' ? scheme.flows?.clientCredentials : scheme.flow === 'application' ? scheme : null;
    if (flow) {
      auth.type = 'oauth2';
      auth.oauth2.tokenUrl = flow.tokenUrl || '';
      auth.oauth2.scope = Array.isArray(scopes) && scopes.length > 0
        ? scopes.join(' ')
        : Object.keys(flow.scopes || {}).join(' ');
    }
  }

  return auth;
}
