import { randomUUID } from 'node:crypto';
import { activeOwner } from './users.js';
import { StoreError } from './errors.js';

export function chatStore(database) {
  return {
    async begin(userId, id, signature, message) {
      const attempt = randomUUID();
      return database.transaction(async (db, session) => {
        await activeOwner(db, session, userId);
        const previous = await db.collection('chatTurns').findOne({ userId, id }, { session });
        if (previous && previous.signature !== signature) throw new StoreError(409, 'request-conflict');
        if (previous?.status === 'complete') return { cached: previous.reply };
        if (previous?.status === 'processing' && Date.now() - previous.updatedAt.getTime() < 180000) {
          throw new StoreError(409, 'assistant-request-in-progress');
        }
        const createdAt = previous?.createdAt ?? new Date();
        await db.collection('chatTurns').replaceOne({ userId, id }, {
          userId, id, signature, attempt, status: 'processing', createdAt, updatedAt: new Date(),
        }, { session, upsert: true });
        await db.collection('chatMessages').replaceOne({ userId, id }, {
          userId, id, role: 'user', text: message, verified: true, requestPending: true, createdAt,
        }, { session, upsert: true });
        return { attempt };
      });
    },
    async finish(userId, id, attempt, reply) {
      await database.transaction(async (db, session) => {
        await activeOwner(db, session, userId);
        const changed = await db.collection('chatTurns').updateOne({ userId, id, attempt, status: 'processing' },
          { $set: { status: 'complete', reply, updatedAt: new Date() } }, { session });
        if (!changed.matchedCount) throw new StoreError(409, 'request-conflict');
        await db.collection('chatMessages').updateOne({ userId, id }, { $set: { requestPending: false } }, { session });
        await db.collection('chatMessages').insertOne({ userId, id: `${id}_reply`, role: 'assistant', text: reply.text,
          verified: true, createdAt: new Date() }, { session });
        await db.collection('engagementEvents').insertOne({ userId, id: `chat_${id}`,
          type: 'assistant_exchange', subjectId: id, createdAt: new Date() }, { session });
      });
    },
    async fail(userId, id, attempt) {
      await database.db.collection('chatTurns').updateOne({ userId, id, attempt, status: 'processing' },
        { $set: { status: 'failed', updatedAt: new Date() } });
    },
    async clear(userId) {
      await database.transaction(async (db, session) => {
        await activeOwner(db, session, userId);
        await db.collection('chatTurns').deleteMany({ userId }, { session });
        await db.collection('chatMessages').deleteMany({ userId }, { session });
      });
    },
    async history(userId) {
      return (await database.db.collection('chatMessages').find({ userId }, { projection: { _id: 0 } })
        .sort({ createdAt: -1, id: -1 }).limit(40).toArray()).reverse();
    },
  };
}
