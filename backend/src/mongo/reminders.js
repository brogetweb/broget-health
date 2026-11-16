import { reminderCandidates, reminderPreferencesSchema, defaultReminders } from '../reminder_policy.js';
import { localDateKey, localHour } from '../calendar.js';
import { activeOwner } from './users.js';
import { StoreError } from './errors.js';

export function reminderStore(database) {
  const { db } = database;
  return {
    async preferences(userId) {
      const row = await db.collection('preferences').findOne({ userId, id: 'reminders' });
      return row ? reminderPreferencesSchema.parse(row.value) : defaultReminders;
    },
    async savePreferences(userId, raw) {
      const value = reminderPreferencesSchema.parse(raw);
      await database.transaction(async (db, session) => {
        await activeOwner(db, session, userId);
        await db.collection('preferences').updateOne({ userId, id: 'reminders' }, { $set: { value } }, { session, upsert: true });
      });
    },
    async generate(userId, now = new Date()) {
      return database.transaction(async (db, session) => {
        const user = await activeOwner(db, session, userId);
        const state = await db.collection('reportState').findOne({ userId }, { session });
        const zone = state?.timeZone ?? 'UTC', today = localDateKey(now, zone);
        const settings = await db.collection('preferences').findOne({ userId, id: 'preferences' }, { session });
        const preferences = await db.collection('preferences').findOne({ userId, id: 'reminders' }, { session });
        const summary = await db.collection('dailySummaries').findOne({ userId, date: today }, { session });
        const candidates = reminderCandidates({ enabled: settings?.notifications === true,
          preferences: preferences?.value ?? defaultReminders, today, hour: localHour(now, zone), summary, health: user.health });
        let created = 0;
        for (const candidate of candidates) {
          const filter = { userId, id: candidate.id };
          if (await db.collection('notifications').findOne(filter, { session })) continue;
          await db.collection('notifications').insertOne({ ...candidate, userId, date: today, timeZone: zone,
            status: 'unread', pushStatus: 'not-connected', createdAt: now }, { session });
          await db.collection('engagementEvents').insertOne({ userId, id: `reminder_${candidate.id}`,
            type: 'reminder_created', subjectId: candidate.id, date: today, createdAt: now }, { session });
          created++;
        }
        return { created, pushDelivery: 'not-connected' };
      });
    },
    async page(userId, cursor) {
      const filter = { userId };
      if (cursor) {
        const previous = await db.collection('notifications').findOne({ userId, id: cursor });
        if (!previous) throw new StoreError(400, 'invalid-input');
        filter.$or = [{ createdAt: { $lt: previous.createdAt } }, { createdAt: previous.createdAt, id: { $lt: cursor } }];
      }
      const rows = await db.collection('notifications').find(filter, { projection: { _id: 0 } })
        .sort({ createdAt: -1, id: -1 }).limit(21).toArray();
      return { notifications: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19].id : null };
    },
    async action(userId, id, action) {
      await database.transaction(async (db, session) => {
        await activeOwner(db, session, userId);
        const changed = await db.collection('notifications').updateOne({ userId, id },
          { $set: { status: action, updatedAt: new Date() } }, { session });
        if (!changed.matchedCount) throw new StoreError(404, 'not-found');
        await db.collection('engagementEvents').updateOne({ userId, id: `${id}_${action}` }, { $setOnInsert: {
          userId, id: `${id}_${action}`, type: `reminder_${action}`, subjectId: id, createdAt: new Date(),
        } }, { upsert: true, session });
      });
    },
  };
}
