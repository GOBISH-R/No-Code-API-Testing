import dns from 'node:dns';
import mongoose from 'mongoose';

mongoose.set('strictQuery', true);
// Fail fast instead of buffering queries indefinitely when disconnected — routes guard
// against this themselves (see middleware/requireDb.js), this is a defense-in-depth backstop.
mongoose.set('bufferCommands', false);

// On some networks Node's c-ares resolver ends up configured with only 127.0.0.1 as a
// nameserver (no local DNS proxy actually listening there), which breaks mongodb+srv://
// SRV/TXT lookups with ECONNREFUSED — even though the OS resolver (and dns.lookup()) work
// fine. Only override in that specific broken case; leave real custom resolvers alone.
if (dns.getServers().length === 1 && dns.getServers()[0] === '127.0.0.1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

export async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.warn('[db] MONGODB_URI is not set — skipping database connection.');
    return;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log(`[db] MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
    await migrateSchemaCache();
    await removeUnverifiedAccounts();
  } catch (err) {
    console.error(`[db] MongoDB connection failed: ${err.message}`);
  }

  mongoose.connection.on('disconnected', () => {
    console.warn('[db] MongoDB disconnected.');
  });

  mongoose.connection.on('error', (err) => {
    console.error(`[db] MongoDB connection error: ${err.message}`);
  });
}

// Human-readable mongoose connection states, keyed by mongoose.connection.readyState.
const DB_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export function getDBStatus() {
  const state = mongoose.connection.readyState;
  return {
    state: DB_STATES[state] ?? 'unknown',
    readyState: state,
  };
}

/**
 * The GraphQL schema cache used to be shared, keyed by URL alone, with a unique index
 * on `endpoint`. It is now per account, and that old index would stop a second account
 * from caching the same URL. Mongoose creates new indexes but never drops old ones, so
 * this does it — for this one small cache collection only, never for user data.
 * Entries from before the change have no owner and are unreachable; they go too.
 */
/**
 * Accounts are now created only once their address is verified; a sign-up waiting on its
 * link lives in PendingSignup instead. Unverified accounts left from before that change
 * can own nothing (the API refused them) and would block their address, so they go.
 */
async function removeUnverifiedAccounts() {
  try {
    const { User } = await import('../models/User.js');
    const { deletedCount } = await User.deleteMany({ emailVerified: false });
    if (deletedCount > 0) console.log(`[db] Removed ${deletedCount} unverified account(s) left from an older version.`);
  } catch (err) {
    console.warn(`[db] Could not remove old unverified accounts: ${err.message}`);
  }
}

async function migrateSchemaCache() {
  try {
    const { GraphQLSchemaCache } = await import('../models/GraphQLSchema.js');
    await GraphQLSchemaCache.deleteMany({ userId: { $exists: false } });
    await GraphQLSchemaCache.syncIndexes();
  } catch (err) {
    console.warn(`[db] Could not update the GraphQL schema cache indexes: ${err.message}`);
  }
}
