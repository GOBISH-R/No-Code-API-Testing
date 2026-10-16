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

// Singleton document: unlike Environment, there is exactly one Global record —
// no name, cannot be created or deleted, only read and updated.
const globalSchema = new Schema(
  {
    /**
     * The account this belongs to.
     *
     * Required and indexed: every query filters on it, and a document without an owner
     * is unreachable by design rather than visible to everyone.
     *
     * Unique because globals are one record per account: two tabs loading for the
     * first time at once must not each create one.
     */
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true, unique: true },
    variables: [variableSchema],
  },
  { timestamps: true },
);

export const Global = mongoose.model('Global', globalSchema);
