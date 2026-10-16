import mongoose from 'mongoose';
import { Workspace, WORKSPACE_ROLES } from '../../models/Workspace.js';
import { WorkspaceInvite, INVITE_TTL_DAYS } from '../../models/WorkspaceInvite.js';
import { User } from '../../models/User.js';
import { owned, OWNED_MODELS } from '../owned.js';
import { sendWorkspaceInviteEmail } from '../accounts/mailer.js';
import { ValidationError } from '../../utils/errors.js';
// Every owned model must be registered for deleteWorkspace to reach it.
import '../../models/Collection.js';
import '../../models/Request.js';
import '../../models/Folder.js';
import '../../models/Environment.js';
import '../../models/Global.js';
import '../../models/MockEndpoint.js';
import '../../models/TestRun.js';
import '../../models/GraphQLSchema.js';
import '../../models/HistoryEntry.js';
import '../../models/Monitor.js';

/** Team workspaces one person may own. */
const MAX_OWNED_WORKSPACES = 10;
/** People in one workspace besides its owner. */
const MAX_MEMBERS = 20;
/** Invitations waiting on one workspace at once. */
const MAX_PENDING_INVITES = 20;

const MAX_NAME_LENGTH = 60;

/** Thrown for "you may not do that here" — answered with 403, not 400. */
export class ForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

const same = (a, b) => String(a) === String(b);

function roleIn(workspace, userId) {
  if (!workspace) return null;
  if (same(workspace.userId, userId)) return 'owner';
  return workspace.members.find((m) => same(m.userId, userId))?.role ?? null;
}

function cleanName(name) {
  const value = typeof name === 'string' ? name.trim() : '';
  // Control characters have no business in a name, and this one goes into email subjects.
  if (!value || value.length > MAX_NAME_LENGTH || /\p{Cc}/u.test(value)) {
    throw new ValidationError(`Give the workspace a name of up to ${MAX_NAME_LENGTH} characters.`);
  }
  return value;
}

function checkRole(role) {
  if (!WORKSPACE_ROLES.includes(role)) throw new ValidationError('The role must be editor or viewer.');
  return role;
}

/**
 * The workspace and the caller's role in it — or null when they are not in it.
 * The one membership check every other function here, and the request middleware,
 * goes through. A malformed id is simply "not a member".
 */
export async function membership(userId, workspaceId) {
  if (!mongoose.isValidObjectId(workspaceId)) return null;
  const workspace = await Workspace.findById(workspaceId).lean();
  const role = roleIn(workspace, userId);
  return role ? { workspace, role } : null;
}

async function requireRole(userId, workspaceId, allowed) {
  const found = await membership(userId, workspaceId);
  if (!found) return null;
  if (!allowed.includes(found.role)) {
    throw new ForbiddenError('Only the workspace owner can do that.');
  }
  return found;
}

function summary(workspace, userId) {
  return {
    _id: workspace._id,
    name: workspace.name,
    role: roleIn(workspace, userId),
    memberCount: workspace.members.length + 1,
    createdAt: workspace.createdAt,
  };
}

export async function listWorkspaces(userId) {
  const list = await Workspace.find({ $or: [{ userId }, { 'members.userId': userId }] })
    .sort({ createdAt: 1 })
    .lean();
  return list.map((w) => summary(w, userId));
}

export async function createWorkspace(userId, name) {
  const value = cleanName(name);
  if ((await Workspace.countDocuments({ userId })) >= MAX_OWNED_WORKSPACES) {
    throw new ValidationError(`You can own up to ${MAX_OWNED_WORKSPACES} workspaces.`);
  }
  const workspace = await Workspace.create({ userId, name: value, members: [] });
  return summary(workspace.toObject(), userId);
}

export async function renameWorkspace(userId, workspaceId, name) {
  const value = cleanName(name);
  const found = await requireRole(userId, workspaceId, ['owner']);
  if (!found) return null;
  const updated = await Workspace.findByIdAndUpdate(workspaceId, { $set: { name: value } }, { returnDocument: 'after' }).lean();
  return summary(updated, userId);
}

/**
 * Deletes a workspace and everything in it. Its data is owned by the workspace's id, so
 * it is swept model by model through owned() — the same path that guarantees nobody
 * else's data is touched.
 */
export async function deleteWorkspace(userId, workspaceId) {
  const found = await requireRole(userId, workspaceId, ['owner']);
  if (!found) return null;
  const scope = found.workspace._id;
  await Promise.all(OWNED_MODELS.map((name) => owned(mongoose.model(name), scope).deleteMany()));
  await WorkspaceInvite.deleteMany({ workspaceId: scope });
  await Workspace.deleteOne({ _id: scope });
  return found.workspace;
}

/**
 * Who is in it. Every member sees the people; only the owner sees pending invitations,
 * since those are email addresses of people who have not agreed to anything yet.
 */
export async function listMembers(userId, workspaceId) {
  const found = await membership(userId, workspaceId);
  if (!found) return null;
  const { workspace, role } = found;

  const ids = [workspace.userId, ...workspace.members.map((m) => m.userId)];
  const users = await User.find({ _id: { $in: ids } }).select('name email').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const person = (id, memberRole, joinedAt) => ({
    userId: id,
    name: byId.get(String(id))?.name ?? 'Deleted account',
    email: byId.get(String(id))?.email ?? '',
    role: memberRole,
    joinedAt,
  });

  const result = {
    workspace: summary(workspace, userId),
    members: [
      person(workspace.userId, 'owner', workspace.createdAt),
      ...workspace.members.map((m) => person(m.userId, m.role, m.joinedAt)),
    ],
    invites: [],
  };
  if (role === 'owner') {
    result.invites = await WorkspaceInvite.find({ workspaceId: workspace._id, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: 1 })
      .select('email role expiresAt createdAt')
      .lean();
  }
  return result;
}

export async function inviteMember(userId, workspaceId, { email, role }) {
  const found = await requireRole(userId, workspaceId, ['owner']);
  if (!found) return null;
  const { workspace } = found;
  checkRole(role);

  const address = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) {
    throw new ValidationError('Enter a valid email address.');
  }

  // Already in? Compared by account, so a member is not invited a second time.
  const existing = await User.findOne({ email: address }).select('_id').lean();
  if (existing && roleIn(workspace, existing._id)) {
    throw new ValidationError('That person is already in this workspace.');
  }
  if (workspace.members.length >= MAX_MEMBERS) {
    throw new ValidationError(`A workspace can have up to ${MAX_MEMBERS} members besides its owner.`);
  }
  const pending = await WorkspaceInvite.countDocuments({ workspaceId: workspace._id, expiresAt: { $gt: new Date() } });
  const isRefresh = await WorkspaceInvite.exists({ workspaceId: workspace._id, email: address });
  if (!isRefresh && pending >= MAX_PENDING_INVITES) {
    throw new ValidationError(`Up to ${MAX_PENDING_INVITES} invitations can be open at once.`);
  }

  // Inviting the same address again refreshes the role and the expiry.
  const invite = await WorkspaceInvite.findOneAndUpdate(
    { workspaceId: workspace._id, email: address },
    {
      $set: {
        role,
        invitedBy: userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();

  const inviter = await User.findById(userId).select('name email').lean();
  // A mail outage must not undo the invitation: it is visible in the app regardless.
  sendWorkspaceInviteEmail({
    to: address,
    inviterName: inviter?.name || inviter?.email || 'A teammate',
    workspaceName: workspace.name,
    role,
  }).catch((err) => console.warn(`[workspaces] Invitation email not sent: ${err.message}`));

  return { _id: invite._id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt };
}

export async function revokeInvite(userId, workspaceId, inviteId) {
  const found = await requireRole(userId, workspaceId, ['owner']);
  if (!found || !mongoose.isValidObjectId(inviteId)) return null;
  return WorkspaceInvite.findOneAndDelete({ _id: inviteId, workspaceId: found.workspace._id }).lean();
}

export async function changeRole(userId, workspaceId, memberId, role) {
  checkRole(role);
  const found = await requireRole(userId, workspaceId, ['owner']);
  if (!found) return null;
  const result = await Workspace.updateOne(
    { _id: found.workspace._id, 'members.userId': memberId },
    { $set: { 'members.$.role': role } },
  );
  return result.matchedCount > 0 ? listMembers(userId, workspaceId) : null;
}

/**
 * Removes someone. The owner may remove anyone but themselves; anyone else may only
 * remove themselves — leaving. Their access ends with the next request they make.
 */
export async function removeMember(userId, workspaceId, memberId) {
  const found = await membership(userId, workspaceId);
  if (!found) return null;
  const leaving = same(memberId, userId);
  if (found.role === 'owner' && leaving) {
    throw new ValidationError('The owner cannot leave. Delete the workspace instead.');
  }
  if (found.role !== 'owner' && !leaving) {
    throw new ForbiddenError('Only the workspace owner can remove people.');
  }
  const result = await Workspace.updateOne(
    { _id: found.workspace._id },
    { $pull: { members: { userId: memberId } } },
  );
  return result.modifiedCount > 0;
}

/** Invitations waiting for the signed-in person, matched by their confirmed address. */
export async function listMyInvites(user) {
  const invites = await WorkspaceInvite.find({ email: user.email, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: 1 })
    .lean();
  if (invites.length === 0) return [];

  const [workspaces, inviters] = await Promise.all([
    Workspace.find({ _id: { $in: invites.map((i) => i.workspaceId) } }).select('name').lean(),
    User.find({ _id: { $in: invites.map((i) => i.invitedBy) } }).select('name email').lean(),
  ]);
  const wsName = new Map(workspaces.map((w) => [String(w._id), w.name]));
  const who = new Map(inviters.map((u) => [String(u._id), u.name || u.email]));

  return invites
    .filter((i) => wsName.has(String(i.workspaceId)))
    .map((i) => ({
      _id: i._id,
      workspaceId: i.workspaceId,
      workspaceName: wsName.get(String(i.workspaceId)),
      invitedBy: who.get(String(i.invitedBy)) ?? 'A teammate',
      role: i.role,
      expiresAt: i.expiresAt,
    }));
}

async function myInvite(user, inviteId) {
  if (!mongoose.isValidObjectId(inviteId)) return null;
  // Matched on the address as well as the id: an invitation can only ever be answered
  // by the account it was sent to.
  return WorkspaceInvite.findOne({ _id: inviteId, email: user.email, expiresAt: { $gt: new Date() } }).lean();
}

export async function acceptInvite(user, inviteId) {
  const invite = await myInvite(user, inviteId);
  if (!invite) return null;
  const workspace = await Workspace.findById(invite.workspaceId).lean();
  if (!workspace) {
    await WorkspaceInvite.deleteOne({ _id: invite._id });
    return null;
  }

  if (!roleIn(workspace, user._id)) {
    if (workspace.members.length >= MAX_MEMBERS) {
      throw new ValidationError('This workspace is full. Ask its owner to make room.');
    }
    // Guarded on "not already a member", so a double click cannot add someone twice.
    await Workspace.updateOne(
      { _id: workspace._id, 'members.userId': { $ne: user._id } },
      { $push: { members: { userId: user._id, role: invite.role, joinedAt: new Date() } } },
    );
  }
  await WorkspaceInvite.deleteOne({ _id: invite._id });
  return summary(await Workspace.findById(workspace._id).lean(), user._id);
}

export async function declineInvite(user, inviteId) {
  const invite = await myInvite(user, inviteId);
  if (!invite) return null;
  await WorkspaceInvite.deleteOne({ _id: invite._id });
  return invite;
}
