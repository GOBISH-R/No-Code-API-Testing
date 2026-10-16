/**
 * Development-only entry point: boots a real local mongod (via mongodb-memory-server)
 * and starts the API against it.
 *
 * This exists so the app can be developed and tested without installing MongoDB or
 * reaching an external one. It changes nothing about the application itself — the
 * server still reads MONGODB_URI exactly as it does in production; this script just
 * supplies one.
 *
 *   node scripts/dev-memory-db.js            data lives in memory, gone on exit
 *   node scripts/dev-memory-db.js --persist  data is kept in server/.data/mongo, so
 *                                            accounts, collections and history (and
 *                                            sessions — you stay signed in) survive
 *                                            restarts
 *
 * The persistent instance listens on a fixed port (DEV_DB_PORT, default 27018) so a
 * tool like MongoDB Compass can connect to it while the app runs. Delete the
 * .data/mongo folder to start again from empty.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const DB_NAME = 'visual-api-testing-suite';
const persist = process.argv.includes('--persist');
const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.data/mongo');

function instanceOptions() {
  if (!persist) return { dbName: DB_NAME };
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    dbName: DB_NAME,
    dbPath: dataDir,
    // The on-disk engine; the default for a temporary instance may be in-memory only.
    storageEngine: 'wiredTiger',
    port: Number(process.env.DEV_DB_PORT) || 27018,
  };
}

/**
 * Starts mongod, retrying briefly. After a restart the previous mongod can still be
 * shutting down — holding the port and the data folder's lock for a moment — so the
 * first attempt may fail for no lasting reason.
 */
async function start(attempts = 6) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await MongoMemoryServer.create({ instance: instanceOptions() });
    } catch (err) {
      if (attempt >= attempts) throw err;
      console.warn(`[dev-db] MongoDB did not start (${err.message}); retrying…`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

const mongod = await start();

process.env.MONGODB_URI = mongod.getUri(DB_NAME);
console.log(
  persist
    ? `[dev-db] Local MongoDB at ${mongod.getUri()} — data kept in ${path.relative(process.cwd(), dataDir)}`
    : `[dev-db] Local MongoDB started at ${mongod.getUri()} — data is discarded on exit`,
);

async function shutdown() {
  // doCleanup only ever removes a temporary folder this script did not choose; the
  // persistent data folder is never deleted.
  await mongod.stop({ doCleanup: !persist });
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Imported after MONGODB_URI is set so the server connects to this instance.
await import('../src/server.js');
