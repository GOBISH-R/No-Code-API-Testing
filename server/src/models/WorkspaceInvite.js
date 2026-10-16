import mongoose from 'mongoose';
import { WORKSPACE_ROLES } from './Workspace.js';

const { Schema } = mongoose;

/** Days an invitation stays open. */
export const INVITE_TTL_DAYS = 7;

/**
 * An invitation to join a workspace, addressed to an email.
 *
 * Accepting needs no link or token: the person signs in to ApIForge with that address,
 * and since only confirmed addresses get in, being signed in as it *is* the proof of
 * owning it. That also covers someone who has no account yet — they sign up with the
 * invited address and the invitation is waiting.
 */
const workspaceInviteSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: WORKSPACE_ROLES, required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// One open invitation per address per workspace; inviting again refreshes it.
workspaceInviteSchema.index({ workspaceId: 1, email: 1 }, { unique: true });
// "Do I have invitations?" is looked up by address.
workspaceInviteSchema.index({ email: 1 });
// MongoDB removes them once they expire.
workspaceInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WorkspaceInvite = mongoose.model('WorkspaceInvite', workspaceInviteSchema);
