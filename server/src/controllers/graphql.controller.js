import { validateIntrospectionRequest } from '../validators/graphqlValidator.js';
import { loadSchema } from '../services/graphql/introspectionService.js';
import { getCachedSchema, deleteCachedSchema } from '../services/graphql/schemaService.js';
import { resolveRequestVariables } from '../services/variables/variableContext.js';
import { ownerId } from '../middleware/authenticate.js';
import { ValidationError } from '../utils/errors.js';

export async function introspectHandler(req, res, next) {
  const errors = validateIntrospectionRequest(req.body);
  if (errors.length > 0) {
    res.status(400);
    return next(new Error(errors.join(' ')));
  }

  try {
    // Same precedence as executing a request: global < environment < runtime.
    const variables = await resolveRequestVariables(
      ownerId(req),
      req.body.environmentId,
      req.body.runtimeVariables,
    );

    const result = await loadSchema(
      ownerId(req),
      { url: req.body.url, headers: req.body.headers, auth: req.body.auth },
      variables,
    );

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400);
      return next(err);
    }
    next(err);
  }
}

export async function getSchemaHandler(req, res, next) {
  const endpoint = req.query.endpoint;
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    res.status(400);
    return next(new Error('An endpoint query parameter is required.'));
  }

  try {
    const cached = await getCachedSchema(ownerId(req), endpoint);
    if (!cached) {
      res.status(404);
      return next(new Error('No schema has been loaded for that endpoint yet.'));
    }
    res.status(200).json({ endpoint: cached.endpoint, schema: cached.schema, fetchedAt: cached.fetchedAt });
  } catch (err) {
    next(err);
  }
}

export async function deleteSchemaHandler(req, res, next) {
  const endpoint = req.query.endpoint;
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    res.status(400);
    return next(new Error('An endpoint query parameter is required.'));
  }

  try {
    const removed = await deleteCachedSchema(ownerId(req), endpoint);
    if (!removed) {
      res.status(404);
      return next(new Error('No schema has been loaded for that endpoint yet.'));
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
