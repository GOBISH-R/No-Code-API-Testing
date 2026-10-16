import mongoose from 'mongoose';
import * as environmentService from '../environments/environmentService.js';
import * as globalService from '../globals/globalService.js';
import { toVariableMap } from './variableResolver.js';
import { ValidationError } from '../../utils/errors.js';
import { isValidId } from '../../utils/objectId.js';
import { validateRuntimeVariables } from '../../validators/requestValidator.js';

// Environment storage lives here rather than in the execution engine, so executing a
// request without an environment needs no database at all.
async function loadEnvironmentVariables(ownerId, environmentId) {
  if (!environmentId) return {};

  if (!isValidId(environmentId)) {
    throw new ValidationError('Invalid environment id.');
  }

  const environment = await environmentService.getEnvironment(ownerId, environmentId);
  if (!environment) {
    throw new ValidationError('The selected environment no longer exists.');
  }

  return toVariableMap(environment.variables);
}

// Globals are always-on (no selection needed), but execution must keep working with no
// database at all when no environment is selected either — so a disconnected DB here
// degrades to "no global variables" instead of failing the request.
async function loadGlobalVariables(ownerId) {
  if (mongoose.connection.readyState !== 1) return {};

  const globals = await globalService.getGlobals(ownerId);
  return toVariableMap(globals.variables);
}

// The global+environment layer shared by both a single execute call and a collection
// run — the caller adds its own more-specific layer (runtimeVariables, or a run's
// accumulated captures) on top.
export async function loadBaseVariables(ownerId, environmentId) {
  const [globalVariables, environmentVariables] = await Promise.all([
    loadGlobalVariables(ownerId),
    loadEnvironmentVariables(ownerId, environmentId),
  ]);
  return { ...globalVariables, ...environmentVariables };
}

/**
 * The full variable set for one request: global < environment < runtime, each layer
 * overriding the one before it as it is more specific to the current chain.
 *
 * Runtime variables come from the browser, so they are checked here — once, for every
 * caller (HTTP execute, GraphQL introspection, the WebSocket gateway) — rather than
 * trusted wherever they happen to be spread.
 */
export async function resolveRequestVariables(ownerId, environmentId, runtimeVariables) {
  const errors = validateRuntimeVariables(runtimeVariables);
  if (errors.length > 0) throw new ValidationError(errors.join(' '));
  const base = await loadBaseVariables(ownerId, environmentId);
  return { ...base, ...runtimeVariables };
}
