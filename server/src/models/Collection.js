import mongoose from 'mongoose';

const collectionSchema = new mongoose.Schema(
  {
    /**
     * The account this belongs to.
     *
     * Required and indexed: every query filters on it, and a document without an owner
     * is unreachable by design rather than visible to everyone.
     */
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

// Compound indexes matching the list queries: owner first (every query filters on it),
// then the sort key, so a user's list is read in order from the index rather than
// sorted in memory after scanning.
collectionSchema.index({ userId: 1, createdAt: -1 });

export const Collection = mongoose.model('Collection', collectionSchema);
