import crypto from 'node:crypto';
import mongoose from 'mongoose';


const { Schema } = mongoose;

/** 16 URL-safe characters: short enough to paste, long enough not to be guessed. */
function generateMockKey() {
  return crypto.randomBytes(12).toString('base64url');
}

/**
 * A person with an account.
 *
 * Note the naming: this is *account* authentication — who is using this tool. It has
 * nothing to do with services/auth/, which is about the credentials a saved request
 * sends to somebody else's API. Conflating the two would be a serious security
 * mistake, so they do not share a directory, a route prefix, or a vocabulary.
 *
 * An account may hold a password, a Google identity, or both. Both is the point of
 * linking: one person, one set of collections, however they choose to sign in.
 */
const userSchema = new Schema(
  {
    // The identity that links sign-in methods together, so it is the one field that
    // must be unique and canonical.
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    /**
     * Whether this address has been *proven* to belong to this person.
     *
     * Linking decisions hinge entirely on this. An unverified address is a claim, not
     * a fact: anyone can type someone else's email into a signup form.
     */
    emailVerified: { type: Boolean, default: false },

    name: { type: String, default: '', trim: true },
    avatarUrl: { type: String, default: '' },

    // Absent on Google-only accounts. `select: false` so it is never returned unless a
    // query explicitly asks — an accidental `res.json(user)` cannot leak the hash.
    passwordHash: { type: String, default: null, select: false },

    /**
     * When a password was last set. Null means this account has none.
     *
     * Exists because `passwordHash` is select:false, so any code path that did not
     * explicitly ask for it sees `undefined` and cannot tell "no password" from "not
     * loaded" — which had toPublicJSON reporting hasPassword:false for accounts that
     * did have one. A timestamp carries no secret, so it is always selectable, and it
     * answers "password last changed" for free.
     */
    passwordSetAt: { type: Date, default: null },

    // Sparse: only accounts that have linked Google carry one, and null must not
    // collide with null.
    googleId: { type: String, default: null, index: true, sparse: true },

    // Single-use tokens are stored hashed, never raw. Someone who reads this collection
    // still cannot verify an address or reset a password with what they find.
    verifyTokenHash: { type: String, default: null, select: false },
    verifyTokenExpiresAt: { type: Date, default: null, select: false },
    // Hash of the link that verified the address. The browser waiting on the sign-up
    // page holds the hash of the link *it* asked for, and is let in only if the two
    // match — so a link issued to some other browser cannot sign this one in.
    verifiedWithTokenHash: { type: String, default: null, select: false },
    resetTokenHash: { type: String, default: null, select: false },
    resetTokenExpiresAt: { type: Date, default: null, select: false },
    // The "Is this you?" reset: the answer from the email ('yes' | 'no', null until
    // answered), and the browser and time the request came from, shown in the email
    // and on the page its buttons open.
    resetAnswer: { type: String, enum: ['yes', 'no', null], default: null, select: false },
    resetRequestedFrom: { type: String, default: '', select: false },
    resetRequestedAt: { type: Date, default: null, select: false },

    /**
     * The slug that namespaces this account's mock endpoints.
     *
     * Mocks are served publicly — the whole point is that the client under test can
     * call them, and it has no session. Without a namespace two accounts both defining
     * `/users` would collide, and whichever was created first would answer for both.
     * So the URL is `/mock/<mockKey>/users`.
     *
     * Random rather than derived from the id or email: it appears in URLs that get
     * pasted into tickets and CI configs, and should not identify the person.
     */
    mockKey: { type: String, required: true, unique: true, index: true },

    lastLoginAt: { type: Date, default: null },

    // Set on every newly created account and cleared when the welcome step is finished
    // or skipped. Defaults to false so accounts that predate the step never see it.
    needsWelcome: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Defaulted in a hook rather than with `default:` so every creation path gets one —
// including findOneAndUpdate({ upsert: true }), which skips field defaults.
userSchema.pre('validate', async function assignMockKey() {
  if (!this.mockKey) this.mockKey = generateMockKey();
});

/** The only shape of a user that may cross the network. */
userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    email: this.email,
    emailVerified: this.emailVerified,
    name: this.name,
    avatarUrl: this.avatarUrl,
    // Useful to the UI ("set a password" vs "change password") and reveals nothing.
    // Read from passwordSetAt, not passwordHash, which is often simply not selected.
    hasPassword: Boolean(this.passwordSetAt),
    hasGoogle: Boolean(this.googleId),
    // The UI needs it to show the full URL of a mock endpoint.
    mockKey: this.mockKey,
    needsWelcome: this.needsWelcome,
  };
};

export const User = mongoose.model('User', userSchema);
