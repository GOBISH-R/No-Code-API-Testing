import { User } from '../../models/User.js';
import { PendingSignup } from '../../models/PendingSignup.js';
import { Workspace } from '../../models/Workspace.js';
import { WorkspaceInvite } from '../../models/WorkspaceInvite.js';
import { owned, OWNED_MODELS } from '../owned.js';
import { deleteWorkspace } from '../workspaces/workspaceService.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { ValidationError } from '../../utils/errors.js';
import mongoose from 'mongoose';

/**
 * The signed-in person's own account: their name, their password, and deleting the
 * account altogether.
 */

const MAX_NAME_LENGTH = 80;
const WRONG_PASSWORD = 'Incorrect password. Try again.';

function coded(message, code) {
  const error = new ValidationError(message);
  error.code = code;
  return error;
}

/** The name shown in the account menu and to workspace members. */
export async function updateName(user, name) {
  const cleaned = String(name ?? '').trim();
  if (!cleaned) throw new ValidationError('Enter your name.');
  if (cleaned.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`Keep the name under ${MAX_NAME_LENGTH} characters.`);
  }
  // A name goes into email subjects ("Ada invited you to …"): no line breaks or other
  // control characters.
  if (/\p{Cc}/u.test(cleaned)) throw new ValidationError('Use letters, numbers and spaces in your name.');
  user.name = cleaned;
  await user.save();
  return user;
}

/**
 * Changes the password: only with the current one, and only when it is right — a
 * session left open on someone else's screen is not enough to take the account over.
 * Like a reset, the new passwordSetAt ends every other session; the controller keeps
 * this one.
 */
export async function changePassword(user, { currentPassword, newPassword }) {
  const account = await User.findById(user._id).select('+passwordHash');
  if (!account) throw new ValidationError('This account no longer exists.');

  // No current password to confirm (an account that signs in only with Google): nothing
  // here can change it. "Forgot password?" on the sign-in page sets one, checked by email.
  if (!account.passwordHash) {
    throw coded(
      'This account has no password. Use “Forgot password?” on the sign-in page to set one.',
      'NO_PASSWORD',
    );
  }
  if (!currentPassword) throw coded('Enter your current password.', 'CURRENT_PASSWORD_REQUIRED');
  if (!(await verifyPassword(currentPassword, account.passwordHash))) {
    throw coded(WRONG_PASSWORD, 'WRONG_PASSWORD');
  }
  if (await verifyPassword(newPassword, account.passwordHash)) {
    throw new ValidationError('Choose a password different from your current one.');
  }

  account.passwordHash = await hashPassword(newPassword);
  account.passwordSetAt = new Date();
  await account.save();
  return account;
}

/**
 * What deleting the account takes with it, for the confirmation in the settings window:
 * the workspaces it owns (deleted for every member) and those it is only a member of.
 */
export async function deletionSummary(user) {
  const [ownedSpaces, memberOf] = await Promise.all([
    Workspace.find({ userId: user._id }).select('name members').lean(),
    Workspace.countDocuments({ 'members.userId': user._id }),
  ]);
  return {
    ownedWorkspaces: ownedSpaces.map((w) => ({ name: w.name, members: w.members.length })),
    memberOfWorkspaces: memberOf,
  };
}

/**
 * Deletes the account and everything that belongs to it — no copy kept, nothing to
 * restore. Confirmed with the password, or, for an account that has none (Google only),
 * by typing the email address.
 *
 *  - Personal data: collections, requests, folders, environments, globals, mocks, runs,
 *    history, monitors, GraphQL schemas.
 *  - Workspaces it owns, with all their data — for every member.
 *  - Its place in other people's workspaces, and invitations sent to its address.
 *
 * Other sessions end on their next request: the account they point at is gone.
 */
export async function deleteAccount(user, { password, email }) {
  const account = await User.findById(user._id).select('+passwordHash');
  if (!account) throw new ValidationError('This account no longer exists.');

  if (account.passwordHash) {
    if (!password) throw coded('Enter your password to confirm.', 'CURRENT_PASSWORD_REQUIRED');
    if (!(await verifyPassword(password, account.passwordHash))) throw coded(WRONG_PASSWORD, 'WRONG_PASSWORD');
  } else if (String(email ?? '').trim().toLowerCase() !== account.email) {
    throw coded('Type your email address exactly as shown to confirm.', 'EMAIL_MISMATCH');
  }

  const ownedSpaces = await Workspace.find({ userId: account._id }).select('_id').lean();
  for (const space of ownedSpaces) {
    await deleteWorkspace(account._id, space._id);
  }
  await Workspace.updateMany({ 'members.userId': account._id }, { $pull: { members: { userId: account._id } } });
  await WorkspaceInvite.deleteMany({ email: account.email });

  await Promise.all(OWNED_MODELS.map((name) => owned(mongoose.model(name), account._id).deleteMany()));
  await PendingSignup.deleteMany({ email: account.email });
  await User.deleteOne({ _id: account._id });
}
