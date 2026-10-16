import { actorId } from '../middleware/authenticate.js';
import * as workspaces from '../services/workspaces/workspaceService.js';
import { ValidationError } from '../utils/errors.js';
import { isValidId } from '../utils/objectId.js';

/**
 * Workspace management. Never scoped by X-Workspace-Id: every call names the workspace
 * it is about, and the service checks the caller's membership and role in it.
 * "Not found" and "not a member" read the same (404), so ids cannot be probed.
 */
function handle(fn, { status = 200 } = {}) {
  return async (req, res, next) => {
    for (const key of ['id', 'memberId']) {
      if (req.params[key] !== undefined && !isValidId(req.params[key])) {
        res.status(400);
        return next(new Error('Invalid id.'));
      }
    }
    try {
      const result = await fn(req);
      if (result === null || result === undefined || result === false) {
        res.status(404);
        return next(new Error('Workspace or invitation not found.'));
      }
      if (status === 204) return res.status(204).send();
      return res.status(status).json(result);
    } catch (err) {
      if (err instanceof ValidationError) res.status(400);
      else if (err instanceof workspaces.ForbiddenError) res.status(403);
      return next(err);
    }
  };
}

export const list = handle((req) => workspaces.listWorkspaces(actorId(req)));
export const create = handle((req) => workspaces.createWorkspace(actorId(req), req.body?.name), { status: 201 });
export const rename = handle((req) => workspaces.renameWorkspace(actorId(req), req.params.id, req.body?.name));
export const remove = handle((req) => workspaces.deleteWorkspace(actorId(req), req.params.id), { status: 204 });

export const members = handle((req) => workspaces.listMembers(actorId(req), req.params.id));
export const invite = handle(
  (req) => workspaces.inviteMember(actorId(req), req.params.id, { email: req.body?.email, role: req.body?.role }),
  { status: 201 },
);
export const revokeInvite = handle(
  (req) => workspaces.revokeInvite(actorId(req), req.params.id, req.params.inviteId),
  { status: 204 },
);
export const changeRole = handle((req) =>
  workspaces.changeRole(actorId(req), req.params.id, req.params.memberId, req.body?.role),
);
export const removeMember = handle(
  (req) => workspaces.removeMember(actorId(req), req.params.id, req.params.memberId),
  { status: 204 },
);

export const myInvites = handle((req) => workspaces.listMyInvites(req.user));
export const acceptInvite = handle((req) => workspaces.acceptInvite(req.user, req.params.inviteId));
export const declineInvite = handle((req) => workspaces.declineInvite(req.user, req.params.inviteId), { status: 204 });
