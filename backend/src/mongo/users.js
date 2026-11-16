import { z } from 'zod';
import { StoreError, ownerId } from './errors.js';

export const healthSchema = z.object({
  age: z.number().int().min(13).max(100), gender: z.enum(['male', 'female', 'unspecified']),
  heightCm: z.number().finite().min(100).max(250), weightKg: z.number().finite().min(30).max(350),
  activity: z.enum(['sedentary', 'light', 'moderate', 'active']), goal: z.enum(['track', 'maintain', 'lose', 'gain']),
  diet: z.string().max(160), allergies: z.string().max(300), restrictions: z.string().max(300), specialCare: z.boolean(),
}).strict();
const profileSchema = z.object({ name: z.string().trim().min(1).max(80), health: healthSchema.nullable() }).strict();

// Updating the owner document is a serialization fence, not just a snapshot read.
// Every private write and deletion must acquire it in its MongoDB transaction.
// This prevents a concurrent operation from recreating data after deletion begins.
export async function activeOwner(db, session, userId) {
  const user = await db.collection('users').findOneAndUpdate(
    { userId: ownerId(userId), deleting: false }, { $inc: { revision: 1 } },
    { session, returnDocument: 'after' },
  );
  if (!user) throw new StoreError(403, 'account-unavailable');
  return user;
}

export function userStore(database) {
  const { db } = database;
  return Object.freeze({
    async ensure(userId, accountName = '') {
      ownerId(userId);
      const name = typeof accountName === 'string' ? accountName.trim().slice(0, 80) : '';
      const now = new Date();
      // A tombstone remains in users after deletion. Never upsert over it.
      try {
        await db.collection('users').updateOne({ userId }, { $setOnInsert: {
          userId, name, health: null, deleting: false, revision: 0, createdAt: now, updatedAt: now,
        } }, { upsert: true });
      } catch (error) { if (error.code !== 11000) throw error; }
      if (name) await db.collection('users').updateOne({ userId, name: '', deleting: false },
        { $set: { name, updatedAt: now }, $inc: { revision: 1 } });
      return this.get(userId);
    },
    async get(userId) {
      const user = await db.collection('users').findOne({ userId: ownerId(userId), deleting: false }, { projection: { _id: 0, revision: 0 } });
      if (!user) throw new StoreError(403, 'account-unavailable');
      return user;
    },
    async save(userId, input) {
      const value = profileSchema.parse(input);
      await database.transaction(async (db, session) => {
        await activeOwner(db, session, userId);
        await db.collection('users').updateOne({ userId }, { $set: { ...value, updatedAt: new Date() } }, { session });
      });
      return this.get(userId);
    },
    async preferences(userId) {
      await this.get(userId);
      return await db.collection('preferences').findOne({ userId, id: 'preferences' }, { projection: { _id: 0, userId: 0, id: 0 } })
        ?? { analytics: false, notifications: false };
    },
    async savePreferences(userId, input) {
      const value = z.object({ analytics: z.boolean(), notifications: z.boolean() }).strict().parse(input);
      await database.transaction(async (db, session) => {
        await activeOwner(db, session, userId);
        await db.collection('preferences').updateOne({ userId, id: 'preferences' }, { $set: value }, { upsert: true, session });
      });
      return value;
    },
    async beginDeletion(userId) {
      ownerId(userId);
      await database.transaction(async (db, session) => {
        const now = new Date();
        const user = await db.collection('users').findOne({ userId }, { session });
        if (!user) throw new StoreError(403, 'account-unavailable');
        if (!user.deleting) await db.collection('users').updateOne({ userId },
          { $set: { deleting: true, updatedAt: now }, $inc: { revision: 1 } }, { session });
        await db.collection('cleanupJobs').updateOne({ id: `account:${userId}` }, { $setOnInsert: {
          id: `account:${userId}`, userId, kind: 'account-delete', status: 'pending',
          nextAttemptAt: now, attempts: 0,
        } }, { upsert: true, session });
      });
    },
  });
}
