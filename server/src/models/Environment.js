import mongoose from 'mongoose';

const { Schema } = mongoose;

const variableSchema = new Schema(
  {
    key: { type: String, default: '' },
    value: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
);

const environmentSchema = new Schema(
  {
    /**
     * The account this belongs to.
     *
     * Required and indexed: every query filters on it, and a document without an owner
     * is unreachable by design rather than visible to everyone.
     */
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    variables: [variableSchema],
  },
  { timestamps: true },
);

// Compound indexes matching the list queries: owner first (every query filters on it),
// then the sort key, so a user's list is read in order from the index rather than
// sorted in memory after scanning.
environmentSchema.index({ userId: 1, createdAt: 1 });

export const Environment = mongoose.model('Environment', environmentSchema);
