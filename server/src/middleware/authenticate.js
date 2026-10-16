import { User } from '../models/User.js';

/**
 * Whether a signed-in session is still good for this account.
 *
 * A password change or reset ends every session that began before it — on every device
 * — the way Google, GitHub and Postman do: whoever had access to an old session, or knew
 * the old password, is out. `authAt` is stamped at sign-in; a session from before this
 * existed gets stamped now, so it too ends at the next password change.
 */
export function sessionIsCurrent(session, user) {
  if (!session.authAt) session.authAt = Date.now();
  const changedAt = user.passwordSetAt ? new Date(user.passwordSetAt).getTime() : 0;
  return session.authAt >= changedAt;
}

/**
 * Turns a session cookie into `req.user`.
 *
 * The session stores only an id, and the account is loaded fresh on every request.
 * That costs one indexed lookup and buys the property that matters: a deleted or
 * changed account takes effect immediately, rather than whenever a cached copy in the
 * session happens to expire.
 */
export async function attachUser(req, _res, next) {
  req.user = null;

  const userId = req.session?.userId;
  if (!userId) return next();

  try {
    const user = await User.findById(userId);
    // The account is gone, or its password changed after this session began: drop the
    // session rather than carrying it on.
    if (!user || !sessionIsCurrent(req.session, user)) {
      req.session.userId = undefined;
      return next();
    }
    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Refuses the request unless someone is signed in.
 *
 * Every route that touches stored data sits behind this. It establishes that `req.user`
 * exists; it does **not** establish that the requested document belongs to them — that
 * is ownership scoping, and it is enforced separately at the query.
 */
export function requireAuth(req, res, next) {
  // Sign-in already refuses an unverified address; this makes sure no other path —
  // an old session, a future bug — can reach stored data without one either.
  if (req.user && !req.user.emailVerified) {
    res.status(403);
    return next(new Error('Verify your email address to continue.'));
  }
  if (req.user) return next();

  res.status(401);
  return next(new Error('Sign in to continue.'));
}

/**
 * The id every scoped query filters on.
 *
 * Throws rather than returning undefined when nobody is signed in: `{ userId: undefined }`
 * is not a filter that matches nothing, it is a filter Mongoose drops — which would
 * silently return every document in the collection. Failing loudly here is the whole
 * point.
 */
export function ownerId(req) {
  // In a team workspace this is the workspace's id (see middleware/workspaceScope.js);
  // otherwise the person's own. Either way it is the owner every query is scoped to.
  const id = req.scope?.ownerId ?? req.user?._id;
  if (!id) throw new Error('ownerId() called without an authenticated user.');
  return id;
}

/**
 * The signed-in person, whatever workspace they are working in. For what is personal
 * rather than shared — their request history, their mocks.
 */
export function actorId(req) {
  const id = req.user?._id;
  if (!id) throw new Error('actorId() called without an authenticated user.');
  return id;
}
