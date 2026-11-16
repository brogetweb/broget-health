import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { mealSchema, foodSchema, dateRangeSchema } from '../contracts.js';
import { contribution, emptyDay, applyDelta, summarizeDays, reportRangeSchema, timeZoneSchema } from '../calendar.js';
import { activeOwner } from './users.js';
import { ownerId, StoreError } from './errors.js';

async function canonicalFood(db, session, userId, food) {
  if (food.id.startsWith('label:')) {
    if (!food.attribution.startsWith('User-entered label: ')) throw new StoreError(400, 'invalid-input');
    return { food, nutritionSource: 'user_entered' };
  }
  let value;
  if (/^ai:[a-f0-9]{64}:\d{1,2}$/.test(food.id)) {
    value = await db.collection('scanFoods').findOne({ userId, id: food.id }, { session });
  } else if (/^usda:\d+$/.test(food.id)) {
    value = await db.collection('nutritionFoods').findOne({ id: food.id }, { session });
  } else if (/^catalog:[A-Za-z0-9_-]{1,100}$/.test(food.id)) {
    value = await db.collection('foods').findOne({ id: food.id.slice(8) }, { session });
  } else throw new StoreError(400, 'invalid-input');
  if (!value) throw new StoreError(400, 'choose-food-again');
  return { food: foodSchema.parse({ ...value.food, id: food.id }),
    nutritionSource: food.id.startsWith('ai:') ? 'ai_estimate' : 'nutrition_database' };
}

export function mealStore(database) {
  const { db } = database;
  async function mutate(userId, id, input) {
    ownerId(userId); z.string().uuid().parse(id);
    const eventId = randomUUID();
    return database.transaction(async (db, session) => {
      await activeOwner(db, session, userId);
      const filter = { userId, id };
      const previous = await db.collection('meals').findOne(filter, { session });
      const indexed = await db.collection('summaryContributions').findOne(filter, { session });
      const state = await db.collection('reportState').findOne({ userId }, { session });
      if (input === null && !previous && !indexed) return;
      const zone = state?.timeZone ?? input?.timeZone ?? 'UTC';
      const now = new Date();
      let meal = null;
      if (input) {
        const foods = [];
        for (const item of input.foods) {
          const canonical = await canonicalFood(db, session, userId, item.food);
          foods.push({ ...item, ...canonical });
        }
        let media = null;
        if (input.imagePath) {
          // imagePath becomes an application-owned asset ID, never an arbitrary URL.
          media = await db.collection('mediaAssets').findOne({ userId, id: input.imagePath,
            status: { $in: ['uploaded', 'attached'] } }, { session });
          if (!media || (media.mealId && media.mealId !== id)) throw new StoreError(400, 'invalid-image');
        }
        meal = { userId, id, mealType: input.mealType, eatenAt: new Date(input.eatenAt), foods,
          imagePath: media?.id ?? null, reportingTimeZone: zone,
          createdAt: previous?.createdAt ?? now, updatedAt: now };
        if (previous && previous.mealType === meal.mealType &&
            previous.eatenAt.getTime() === meal.eatenAt.getTime() &&
            previous.imagePath === meal.imagePath && isDeepStrictEqual(previous.foods, meal.foods)) {
          const { _id, ...existing } = previous;
          return existing;
        }
      }
      const oldValue = indexed?.value ?? null;
      const newValue = meal ? contribution(meal, zone) : null;
      for (const date of new Set([oldValue?.date, newValue?.date].filter(Boolean))) {
        const dayFilter = { userId, date };
        const oldDay = await db.collection('dailySummaries').findOne(dayFilter, { session });
        const next = applyDelta(oldDay ?? emptyDay(date), oldValue?.date === date ? oldValue : null,
          newValue?.date === date ? newValue : null);
        delete next._id;
        if (!next.mealCount) await db.collection('dailySummaries').deleteOne(dayFilter, { session });
        else await db.collection('dailySummaries').replaceOne(dayFilter,
          { ...next, userId, timeZone: zone, updatedAt: now }, { upsert: true, session });
      }
      if (meal) {
        meal.localDate = newValue.date;
        await db.collection('meals').replaceOne(filter, meal, { upsert: true, session });
        await db.collection('summaryContributions').replaceOne(filter,
          { ...filter, value: newValue, updatedAt: now }, { upsert: true, session });
        if (meal.imagePath) await db.collection('mediaAssets').updateOne({ userId, id: meal.imagePath },
          { $set: { status: 'attached', mealId: id, updatedAt: now } }, { session });
      } else {
        await db.collection('meals').deleteOne(filter, { session });
        await db.collection('summaryContributions').deleteOne(filter, { session });
      }
      if (previous?.imagePath && previous.imagePath !== meal?.imagePath) {
        await db.collection('mediaAssets').updateOne({ userId, id: previous.imagePath },
          { $set: { status: 'delete-pending', updatedAt: now } }, { session });
        await db.collection('cleanupJobs').updateOne({ id: `media:${userId}:${previous.imagePath}` },
          { $set: { userId, mediaId: previous.imagePath,
            kind: 'media-delete', status: 'pending', nextAttemptAt: now, attempts: 0 },
          $unset: { lease: '', leaseUntil: '' } }, { upsert: true, session });
      }
      await db.collection('reportState').updateOne({ userId },
        { $setOnInsert: { userId, timeZone: zone, complete: true, version: 1 } }, { upsert: true, session });
      await db.collection('engagementEvents').insertOne({ userId, id: eventId,
        type: !meal ? 'meal_deleted' : previous ? 'meal_updated' : 'meal_logged',
        subjectId: id, date: newValue?.date ?? oldValue?.date, createdAt: now }, { session });
      return meal;
    });
  }
  return Object.freeze({
    async save(userId, raw) {
      const input = mealSchema.parse(raw);
      const when = Date.parse(input.eatenAt);
      if (when < Date.parse('2020-01-01') || when > Date.now() + 300000) throw new StoreError(400, 'invalid-input');
      if (input.timeZone) timeZoneSchema.parse(input.timeZone);
      return mutate(userId, input.id, input);
    },
    delete: (userId, id) => mutate(userId, id, null),
    async range(userId, start, end) {
      ownerId(userId); dateRangeSchema.parse({ start, end });
      if (!await db.collection('users').findOne({ userId, deleting: false }, { projection: { _id: 1 } })) {
        throw new StoreError(403, 'account-unavailable');
      }
      const rows = await db.collection('meals').find({ userId,
        eatenAt: { $gte: new Date(start), $lt: new Date(end) } }, { projection: { _id: 0 } })
        .sort({ eatenAt: 1, id: 1 }).limit(601).toArray();
      if (rows.length > 600) throw new StoreError(400, 'range-too-large');
      return rows;
    },
    async page(userId, cursor = null) {
      ownerId(userId);
      if (!await db.collection('users').findOne({ userId, deleting: false }, { projection: { _id: 1 } })) {
        throw new StoreError(403, 'account-unavailable');
      }
      const filter = { userId };
      if (cursor != null) {
        let value;
        try {
          if (typeof cursor !== 'string' || cursor.length > 1000) throw new Error();
          value = z.object({ userId: z.literal(userId), time: z.iso.datetime(), id: z.string().uuid() }).strict()
            .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
        } catch { throw new StoreError(400, 'invalid-input'); }
        const time = new Date(value.time);
        filter.$or = [{ eatenAt: { $lt: time } }, { eatenAt: time, id: { $lt: value.id } }];
      }
      const rows = await db.collection('meals').find(filter, { projection: { _id: 0 } })
        .sort({ eatenAt: -1, id: -1 }).limit(21).toArray();
      const hasMore = rows.length > 20;
      const meals = rows.slice(0, 20), last = meals.at(-1);
      return { meals, hasMore, cursor: hasMore ? Buffer.from(JSON.stringify({
        userId, time: last.eatenAt.toISOString(), id: last.id,
      })).toString('base64url') : null };
    },
    async report(userId, startDate, endDate) {
      ownerId(userId); reportRangeSchema.parse({ startDate, endDate });
      // Read a consistent snapshot when a concurrent meal write moves between dates.
      return database.transaction(async (db, session) => {
        const user = await db.collection('users').findOne({ userId, deleting: false }, { session });
        if (!user) throw new StoreError(403, 'account-unavailable');
        const state = await db.collection('reportState').findOne({ userId }, { session });
        const rows = await db.collection('dailySummaries').find({ userId,
          date: { $gte: startDate, $lt: endDate } }, { projection: { _id: 0, userId: 0 }, session })
          .sort({ date: 1 }).limit(367).toArray();
        return { ...summarizeDays(startDate, endDate, rows), timeZone: state?.timeZone ?? 'UTC' };
      });
    },
  });
}
