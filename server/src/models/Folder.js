import mongoose from 'mongoose';

const { Schema } = mongoose;

// A folder groups requests inside one collection, and may nest inside another folder
// (parentId null means it sits at the collection's root). Folders are organizational
// only — they deliberately do not affect collection-run order, which stays by
// creation time so adding folders can never silently reorder an existing chain.
//
// Re-parenting is intentionally not supported: without it a folder's ancestry is
// fixed at creation, so a cycle (a folder becoming its own ancestor) is impossible
// by construction rather than by a runtime check.
const folderSchema = new Schema(
  {
    /**
     * The account this belongs to.
     *
     * Required and indexed: every query filters on it, and a document without an owner
     * is unreachable by design rather than visible to everyone.
     */
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    collectionId: { type: Schema.Types.ObjectId, ref: 'Collection', required: true, index: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Folder', default: null },
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

// Compound indexes matching the list queries: owner first (every query filters on it),
// then the sort key, so a user's list is read in order from the index rather than
// sorted in memory after scanning.
folderSchema.index({ userId: 1, collectionId: 1, createdAt: 1 });

export const Folder = mongoose.model('Folder', folderSchema);
