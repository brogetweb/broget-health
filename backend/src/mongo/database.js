import { MongoClient } from 'mongodb';
import { initializeCollections } from './indexes.js';
import { StoreError } from './errors.js';

export async function connectDatabase({ uri, database }, { initialize = true } = {}) {
  let client;
  try {
    if (typeof database !== 'string' || !/^[A-Za-z0-9_-]{1,63}$/.test(database)) {
      throw new StoreError(503, 'database-configuration-error');
    }
    client = new MongoClient(uri, {
      appName: 'health-broget', maxPoolSize: 10, minPoolSize: 0,
      maxIdleTimeMS: 60000, serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000, waitQueueTimeoutMS: 10000, socketTimeoutMS: 30000,
    });
    await client.connect();
    const db = client.db(database);
    const hello = await db.command({ hello: 1 });
    if ((!hello.setName && hello.msg !== 'isdbgrid') || hello.logicalSessionTimeoutMinutes == null) {
      throw new StoreError(503, 'database-transactions-required');
    }
    if (initialize) await initializeCollections(db);
    let closed = false;
    return Object.freeze({
      db,
      async ready() {
        if (closed) return false;
        try { await db.command({ ping: 1 }, { maxTimeMS: 3000 }); return true; }
        catch { return false; }
      },
      async transaction(work) {
        if (closed) throw new StoreError(503, 'database-unavailable');
        const session = client.startSession();
        try {
          // The driver may repeat this callback. Do not send emails, call AI,
          // upload to Cloudinary or perform other external effects inside it.
          const deadline = Date.now() + 30000;
          return await session.withTransaction(() => {
            if (Date.now() >= deadline) throw new StoreError(503, 'database-busy');
            return work(db, session);
          }, {
            readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' },
            readPreference: 'primary', maxCommitTimeMS: 10000,
          });
        } finally { await session.endSession(); }
      },
      async close() { if (!closed) { closed = true; await client.close(); } },
    });
  } catch (error) {
    await client?.close().catch(() => {});
    // Avoid leaking hostnames, connection strings, usernames or passwords.
    throw error instanceof StoreError ? error : new StoreError(503, 'database-unavailable');
  }
}
