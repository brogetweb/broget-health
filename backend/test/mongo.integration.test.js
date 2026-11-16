import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase } from '../src/mongo/database.js';
import { userStore, activeOwner } from '../src/mongo/users.js';
import { mealStore } from '../src/mongo/meals.js';
import { consumeQuota } from '../src/mongo/quota.js';
import { initializeCollections } from '../src/mongo/indexes.js';

let replica, database, users, meals;
const binary = { version: '8.2.6' };
before(async () => {
  // Always isolated and local: never read MONGODB_URI or a cloud credential.
  replica = await MongoMemoryReplSet.create({ binary, replSet: { count: 1, storageEngine: 'wiredTiger' } });
  database = await connectDatabase({ uri: replica.getUri(), database: `test_${randomUUID().replaceAll('-', '')}` });
  users = userStore(database); meals = mealStore(database);
}, { timeout: 180000 });
after(async () => { await database?.close(); await replica?.stop(); });

function input(overrides = {}) {
  return { id: randomUUID(), mealType: 'lunch', eatenAt: '2026-01-15T12:00:00Z',
    timeZone: 'Asia/Kolkata', imagePath: null,
    foods: [{ food: { id: 'label:rice', name: 'Rice', attribution: 'User-entered label: rice',
      per100g: { calories: 130, protein: 3, carbs: 28, fat: 1, fiber: null } },
    grams: 100, source: 'user_entered', confidence: null }], ...overrides };
}

test('MongoDB startup is ready, initialization is repeatable and private records require owners', async () => {
  assert.equal(await database.ready(), true);
  await initializeCollections(database.db);
  await assert.rejects(database.db.collection('meals').insertOne({ id: randomUUID() }), e => e.code === 121);
  const definitions = await database.db.collection('analyses').indexes();
  assert.equal(definitions.find(i => i.name === 'expires_at').expireAfterSeconds, 0);
});

test('concurrent account creation preserves the first name and user identity is unique', async () => {
  await Promise.all(Array.from({ length: 8 }, () => users.ensure('account', 'Ada')));
  assert.equal(await database.db.collection('users').countDocuments({ userId: 'account' }), 1);
  await users.ensure('account', 'Overwritten');
  assert.equal((await users.get('account')).name, 'Ada');
  await assert.rejects(database.db.collection('users').insertOne({ userId: 'account' }), e => e.code === 11000);
  await assert.rejects(users.save('account', { name: 'Ada', health: null, userId: 'other' }));
});

test('transactions roll back all changes on error and release sessions', async () => {
  await assert.rejects(database.transaction(async (db, session) => {
    await db.collection('foods').insertOne({ id: 'rollback' }, { session });
    throw new Error('rollback-test');
  }), /rollback-test/);
  assert.equal(await database.db.collection('foods').countDocuments({ id: 'rollback' }), 0);
  assert.equal(await database.ready(), true);
});

test('meal date moves, retries and deletion update report totals exactly once', async () => {
  await users.ensure('report-owner', 'Reporter');
  const meal = input();
  await meals.save('report-owner', meal);
  await meals.save('report-owner', meal);
  let report = await meals.report('report-owner', '2026-01-01', '2026-02-01');
  assert.equal(report.totals.calories, 130);
  assert.equal(report.totals.mealCount, 1);
  assert.equal(await database.db.collection('engagementEvents').countDocuments({ userId: 'report-owner' }), 1);
  await meals.save('report-owner', { ...meal, eatenAt: '2026-01-16T20:00:00Z' });
  report = await meals.report('report-owner', '2026-01-15', '2026-01-18');
  assert.equal(report.days[0].mealCount, 0);
  assert.equal(report.days[2].mealCount, 1); // 01:30 local time, next day.
  assert.equal(report.totals.calories, 130);
  await meals.delete('report-owner', meal.id);
  await meals.delete('report-owner', meal.id);
  assert.equal((await meals.report('report-owner', '2026-01-01', '2026-02-01')).totals.mealCount, 0);
});

test('simultaneous meal writes do not lose aggregate contributions', async () => {
  await users.ensure('parallel', 'Parallel');
  await Promise.all(Array.from({ length: 6 }, () => meals.save('parallel', input())));
  const report = await meals.report('parallel', '2026-01-01', '2026-02-01');
  assert.equal(report.totals.mealCount, 6);
  assert.equal(report.totals.calories, 780);
});

test('reads, meal IDs, AI snapshots and image attachments are isolated by verified owner', async () => {
  await users.ensure('owner-a', 'A'); await users.ensure('owner-b', 'B');
  const meal = input();
  await meals.save('owner-a', meal);
  assert.equal((await meals.range('owner-b', '2026-01-15T00:00:00Z', '2026-01-16T00:00:00Z')).length, 0);
  await meals.delete('owner-b', meal.id);
  assert.equal((await meals.page('owner-a')).meals.length, 1);
  const foodId = `ai:${'a'.repeat(64)}:0`;
  const food = { ...meal.foods[0].food, id: foodId };
  await database.db.collection('scanFoods').insertOne({ userId: 'owner-a', id: foodId, food });
  const scan = input({ foods: [{ ...meal.foods[0], food }] });
  await assert.rejects(meals.save('owner-b', scan), e => e.code === 'choose-food-again');
  await meals.save('owner-a', { ...scan, foods: [{ ...scan.foods[0], food: { ...food, per100g: { ...food.per100g, calories: 999 } } }] });
  const rows = (await meals.page('owner-a')).meals;
  assert.equal(rows.find(m => m.id === scan.id).foods[0].food.per100g.calories, 130);
  await database.db.collection('mediaAssets').insertOne({ userId: 'owner-a', id: 'private-photo', publicId: 'private-photo', status: 'uploaded' });
  await assert.rejects(meals.save('owner-b', input({ imagePath: 'private-photo' })), e => e.code === 'invalid-image');
});

test('pagination handles equal timestamps without duplicates and rejects cross-owner cursors', async () => {
  await users.ensure('paging', 'Paging');
  for (let i = 0; i < 22; i++) await meals.save('paging', input());
  const first = await meals.page('paging');
  assert.equal(first.meals.length, 20); assert.equal(first.hasMore, true);
  const second = await meals.page('paging', first.cursor);
  assert.equal(second.meals.length, 2); assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.meals, ...second.meals].map(m => m.id)).size, 22);
  await assert.rejects(meals.page('owner-a', first.cursor), e => e.code === 'invalid-input');
  await assert.rejects(meals.page('paging', 'bad-cursor'), e => e.code === 'invalid-input');
});

test('quota increments cannot exceed the limit under concurrent requests', async () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => consumeQuota(database, 'quota-user', 'requests', 3, 60, now)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 3);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'rate-limited'));
  // Explicit window keys allow the next window even before TTL cleanup runs.
  await consumeQuota(database, 'quota-user', 'requests', 3, 60, new Date(now.getTime() + 60000));
});

test('deletion fence blocks further writes and account reinitialization', async () => {
  await users.ensure('deleting', 'Delete');
  await users.beginDeletion('deleting');
  await users.beginDeletion('deleting');
  await assert.rejects(meals.save('deleting', input()), e => e.code === 'account-unavailable');
  await assert.rejects(users.savePreferences('deleting', { analytics: false, notifications: true }), e => e.code === 'account-unavailable');
  await assert.rejects(users.ensure('deleting', 'Restored'), e => e.code === 'account-unavailable');
  assert.equal(await database.db.collection('cleanupJobs').countDocuments({ id: 'account:deleting' }), 1);
});

test('a write with a stale snapshot cannot recreate data after deletion starts', async () => {
  await users.ensure('deletion-race', 'Race');
  let announce, release;
  const read = new Promise(resolve => { announce = resolve; });
  const proceed = new Promise(resolve => { release = resolve; });
  const writing = database.transaction(async (db, session) => {
    await db.collection('users').findOne({ userId: 'deletion-race' }, { session });
    announce(); await proceed;
    await activeOwner(db, session, 'deletion-race');
    await db.collection('scanFoods').insertOne({ userId: 'deletion-race', id: 'late-write' }, { session });
  });
  // Attach the rejection handler before allowing the transaction to continue.
  const rejected = assert.rejects(writing, e => e.code === 'account-unavailable');
  await read;
  await users.beginDeletion('deletion-race');
  release(); await rejected;
  assert.equal(await database.db.collection('scanFoods').countDocuments({ userId: 'deletion-race' }), 0);
});

test('replacement and deletion of photos enqueue cleanup without deleting another owner asset', async () => {
  await users.ensure('photos', 'Photo owner');
  const now = new Date();
  await database.db.collection('mediaAssets').insertMany([
    { userId: 'photos', id: 'photo-first', publicId: 'first', status: 'uploaded', createdAt: now },
    { userId: 'photos', id: 'photo-second', publicId: 'second', status: 'uploaded', createdAt: now },
  ]);
  const meal = input({ imagePath: 'photo-first' });
  await meals.save('photos', meal);
  await meals.save('photos', { ...meal, imagePath: 'photo-second' });
  assert.equal((await database.db.collection('mediaAssets').findOne({ userId: 'photos', id: 'photo-first' })).status, 'delete-pending');
  assert.equal(await database.db.collection('cleanupJobs').countDocuments({ id: 'media:photos:photo-first' }), 1);
  await meals.delete('photos', meal.id);
  assert.equal(await database.db.collection('cleanupJobs').countDocuments({ id: 'media:photos:photo-second' }), 1);
});

test('closed connection fails readiness and malformed configuration does not leak secrets', async () => {
  const second = await connectDatabase({ uri: replica.getUri(), database: 'test_close' }, { initialize: false });
  await second.close(); await second.close();
  assert.equal(await second.ready(), false);
  await assert.rejects(second.transaction(async () => {}), e => e.code === 'database-unavailable');
  await assert.rejects(connectDatabase({ uri: 'invalid-private-password', database: 'test_invalid' }),
    e => e.code === 'database-unavailable' && !e.message.includes('private-password'));
});

test('standalone MongoDB is rejected because application writes need transactions', { timeout: 60000 }, async () => {
  const standalone = await MongoMemoryServer.create({ binary });
  try { await assert.rejects(connectDatabase({ uri: standalone.getUri(), database: 'test_standalone' }), e => e.code === 'database-transactions-required'); }
  finally { await standalone.stop(); }
});
