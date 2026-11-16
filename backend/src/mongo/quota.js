import { z } from 'zod';
import { StoreError } from './errors.js';

export async function consumeQuota(database, subject, action, limit, seconds = 3600, now = new Date()) {
  z.string().min(1).max(256).parse(subject);
  z.string().regex(/^[a-z0-9-]{1,64}$/).parse(action);
  z.number().int().min(1).parse(limit);
  z.number().int().min(1).parse(seconds);
  const window = Math.floor(now.getTime() / (seconds * 1000));
  // Two operations in one transaction prevent concurrent first requests from
  // bypassing the cap. A duplicate initial upsert is retried in a new transaction.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await database.transaction(async (db, session) => {
        const key = { subject, action, window };
        const current = await db.collection('quotas').findOne(key, { session });
        if ((current?.count ?? 0) >= limit) throw new StoreError(429, 'rate-limited');
        await db.collection('quotas').updateOne(key,
          { $inc: { count: 1 }, $setOnInsert: { ...key, expiresAt: new Date((window + 2) * seconds * 1000) } },
          { upsert: true, session });
      });
      return;
    } catch (error) {
      if (error.code !== 11000 || attempt === 2) throw error;
    }
  }
}
