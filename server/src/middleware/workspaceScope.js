import { membership } from '../services/workspaces/workspaceService.js';

const WORKSPACE_HEADER = 'x-workspace-id';

// Methods that only read.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * What a viewer may still do with POST: send a request, load a GraphQL schema, run a
 * collection, get an OAuth token for a request, and copy a collection somewhere they can
 * edit — testing and reading, not changing what this workspace holds. (Moving it out is
 * refused separately, in collectionTransfer.js.)
 */
const VIEWER_ACTIONS = [
  /^\/api\/requests\/execute\/?$/,
  /^\/api\/graphql\/introspect\/?$/,
  /^\/api\/collections\/[^/]+\/run\/?$/,
  /^\/api\/collections\/[^/]+\/copy\/?$/,
  /^\/api\/oauth\//,
];

/**
 * Decides whose data this request works on, and whether it may change it.
 *
 * With no X-Workspace-Id header it is the signed-in person's own data, exactly as before
 * workspaces existed. With one, the person must be a member of that workspace — checked
 * against the database on every request, so removing someone takes effect at once — and
 * the workspace's id becomes the owner id every query is scoped to.
 *
 * Mounted after requireAuth, on the routers that hold shareable data only. Personal
 * things (history, mocks, the account itself) never read this header.
 */
export async function workspaceScope(req, res, next) {
  const header = req.get(WORKSPACE_HEADER);
  if (!header) {
    req.scope = { ownerId: req.user._id, workspaceId: null, role: 'owner' };
    return next();
  }

  try {
    const found = await membership(req.user._id, header);
    if (!found) {
      res.status(403);
      const err = new Error('You are not a member of that workspace.');
      err.code = 'NOT_A_MEMBER';
      return next(err);
    }

    req.scope = { ownerId: found.workspace._id, workspaceId: found.workspace._id, role: found.role };

    const path = `${req.baseUrl}${req.path}`;
    if (found.role === 'viewer' && !SAFE_METHODS.has(req.method) && !VIEWER_ACTIONS.some((p) => p.test(path))) {
      res.status(403);
      const err = new Error('You are a viewer in this workspace: you can send requests and run collections, but not change them.');
      err.code = 'VIEWER_READ_ONLY';
      return next(err);
    }
    return next();
  } catch (err) {
    return next(err);
  }
}
