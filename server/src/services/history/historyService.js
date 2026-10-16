import { HistoryEntry } from '../../models/HistoryEntry.js';
import { owned } from '../owned.js';
import { encryptRequestSecrets, decryptRequestSecrets } from '../security/fieldCrypto.js';

/** Newest entries kept per account; older ones are trimmed as new ones arrive. */
export const MAX_ENTRIES_PER_ACCOUNT = 100;

/**
 * Bodies larger than this are not kept. The request limit is 1MB, and a hundred of
 * those per account would make history the largest thing in the database for no real
 * benefit — a body that big is a file, and it belongs in a saved request.
 */
export const MAX_KEPT_BODY_CHARS = 100_000;

// The fields shown in the sidebar list. Params are included because they are part of
// the URL as the user sees it (?page=2 is what tells two sends apart); auth, headers
// and bodies are left out — the list is read on every page load and has no use for them.
const SUMMARY_FIELDS = 'protocol method url params status time size error createdAt';

function entryFields(request) {
  const { protocol, method, url, params, headers, body, graphql, auth, assertions, captures } = request;
  const isGraphQL = protocol === 'graphql';
  const raw = body?.raw ?? '';
  const bodyOmitted = !isGraphQL && raw.length > MAX_KEPT_BODY_CHARS;

  return {
    protocol: isGraphQL ? 'graphql' : 'rest',
    // GraphQL is always sent as POST, whatever the payload says.
    method: isGraphQL ? 'POST' : method,
    url,
    params,
    headers,
    body: bodyOmitted ? { ...body, raw: '' } : body,
    graphql,
    auth,
    assertions,
    captures,
    bodyOmitted,
  };
}

/**
 * Records one send.
 *
 * `outcome` is either the execution result or `{ error }` when the request was refused
 * before it left (an unresolved variable, a blocked address) — those are still worth
 * keeping, since the request typed is exactly what the user would want back to fix.
 */
export async function recordHistory(ownerId, request, outcome) {
  // A WebSocket connection is a session, not a send; it has no single outcome to list.
  if (request?.protocol === 'websocket') return null;
  const scope = owned(HistoryEntry, ownerId);
  const summary = outcome?.success
    ? {
        status: outcome.response.status,
        time: outcome.meta?.time ?? null,
        size: outcome.response.size ?? null,
        error: null,
      }
    : {
        status: null,
        time: outcome?.meta?.time ?? null,
        size: null,
        error: String(outcome?.error?.message ?? outcome?.error ?? 'The request failed.').slice(0, 500),
      };

  const entry = await scope.create({ ...encryptRequestSecrets(entryFields(request)), ...summary });

  // Trim to the newest N. Reads ids past the cap from the { userId, createdAt } index,
  // so the cost stays flat however long the account has been sending.
  const overflow = await scope
    .find()
    .sort({ createdAt: -1, _id: -1 })
    .skip(MAX_ENTRIES_PER_ACCOUNT)
    .select('_id')
    .lean();
  if (overflow.length > 0) {
    await scope.deleteMany({ _id: { $in: overflow.map((e) => e._id) } });
  }

  return entry;
}

export async function listHistory(ownerId) {
  return owned(HistoryEntry, ownerId)
    .find()
    .sort({ createdAt: -1, _id: -1 })
    .limit(MAX_ENTRIES_PER_ACCOUNT)
    .select(SUMMARY_FIELDS)
    .lean();
}

export async function getHistoryEntry(ownerId, id) {
  return decryptRequestSecrets(await owned(HistoryEntry, ownerId).byId(id).lean());
}

export async function deleteHistoryEntry(ownerId, id) {
  return owned(HistoryEntry, ownerId).deleteById(id);
}

export async function clearHistory(ownerId) {
  const { deletedCount } = await owned(HistoryEntry, ownerId).deleteMany();
  return deletedCount;
}
