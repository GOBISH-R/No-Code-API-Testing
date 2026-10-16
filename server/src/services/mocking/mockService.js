import { MockEndpoint } from '../../models/MockEndpoint.js';
import { User } from '../../models/User.js';
import { owned } from '../owned.js';

/**
 * Managing mock endpoints, and serving them.
 *
 * These are two different trust contexts and the split matters. Everything above
 * `listEnabledMocksByKey` is the owner administering their own mocks, behind the auth
 * gate. That one function is the public path — called with no session, by whatever
 * client is under test — so it resolves an account from the URL's mock key instead.
 */

export async function createMock(ownerId, payload) {
  return owned(MockEndpoint, ownerId).create({
    name: payload.name?.trim() || '',
    method: payload.method,
    path: payload.path.trim(),
    statusCode: payload.statusCode ?? 200,
    headers: payload.headers || [],
    body: payload.body ?? '',
    delayMs: payload.delayMs ?? 0,
    enabled: payload.enabled ?? true,
  });
}

export async function listMocks(ownerId) {
  return owned(MockEndpoint, ownerId).find().sort({ createdAt: 1 }).lean();
}

export async function getMock(ownerId, id) {
  return owned(MockEndpoint, ownerId).byId(id).lean();
}

export async function updateMock(ownerId, id, payload) {
  const update = {};
  if (payload.name !== undefined) update.name = payload.name.trim();
  if (payload.method !== undefined) update.method = payload.method;
  if (payload.path !== undefined) update.path = payload.path.trim();
  if (payload.statusCode !== undefined) update.statusCode = payload.statusCode;
  if (payload.headers !== undefined) update.headers = payload.headers;
  if (payload.body !== undefined) update.body = payload.body;
  if (payload.delayMs !== undefined) update.delayMs = payload.delayMs;
  if (payload.enabled !== undefined) update.enabled = payload.enabled;

  return owned(MockEndpoint, ownerId).updateById(id, update);
}

export async function deleteMock(ownerId, id) {
  return owned(MockEndpoint, ownerId).deleteById(id);
}

/**
 * The public path: the enabled mocks belonging to whoever owns this key.
 *
 * Returns an empty list for an unknown key rather than throwing, so a wrong key looks
 * exactly like an account with no matching mock — a 404 either way. Distinguishing
 * them would turn this into an oracle for guessing valid keys.
 */
export async function listEnabledMocksByKey(mockKey) {
  if (!mockKey) return [];

  const user = await User.findOne({ mockKey: String(mockKey) }).select('_id').lean();
  if (!user) return [];

  return owned(MockEndpoint, user._id).find({ enabled: true }).sort({ createdAt: 1 }).lean();
}
