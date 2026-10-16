import mongoose from 'mongoose';

const { Schema } = mongoose;

export const WORKSPACE_ROLES = ['editor', 'viewer'];

/**
 * A team workspace: a shared space whose collections, requests, folders, environments,
 * globals, runs and monitors every member sees.
 *
 * Its own _id is the owner id of everything inside it. The data models already scope
 * every query to an owner id through owned(); a workspace simply supplies a different
 * one, so personal and team data can never mix and no query had to change. Which id a
 * request may use is decided once, by middleware/workspaceScope.js, from membership here.
 *
 * Not in OWNED_MODELS: a workspace is reached through membership, not a single owner,
 * so workspaceService checks membership explicitly on every operation instead.
 */
const memberSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: WORKSPACE_ROLES, required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const workspaceSchema = new Schema(
  {
    // The creator. Only the owner can rename or delete it, and invite or remove people.
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    members: [memberSchema],
  },
  { timestamps: true },
);

workspaceSchema.index({ userId: 1, createdAt: 1 });
// "Which workspaces am I in?" is asked on every page load.
workspaceSchema.index({ 'members.userId': 1 });

export const Workspace = mongoose.model('Workspace', workspaceSchema);
