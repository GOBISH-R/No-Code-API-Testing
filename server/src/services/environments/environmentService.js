import { Environment } from '../../models/Environment.js';
import { owned } from '../owned.js';

export async function createEnvironment(ownerId, { name, variables }) {
  return owned(Environment, ownerId).create({ name: name.trim(), variables: variables || [] });
}

export async function listEnvironments(ownerId) {
  return owned(Environment, ownerId).find().sort({ createdAt: 1 }).lean();
}

// byId, not findById: an environment id belonging to someone else must read as absent,
// not as a document.
export async function getEnvironment(ownerId, id) {
  return owned(Environment, ownerId).byId(id).lean();
}

export async function updateEnvironment(ownerId, id, { name, variables }) {
  const update = {};
  if (name !== undefined) update.name = name.trim();
  if (variables !== undefined) update.variables = variables;

  return owned(Environment, ownerId).updateById(id, update);
}

export async function deleteEnvironment(ownerId, id) {
  return owned(Environment, ownerId).deleteById(id);
}
