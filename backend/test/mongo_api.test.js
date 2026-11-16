import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connectDatabase } from '../src/mongo/database.js';
import { createApp } from '../src/mongo_app.js';
import { mediaStore, normalizePhoto, cloudinaryTransport } from '../src/media.js';
import { cleanupWorker } from '../src/cleanup.js';
import { chatStore } from '../src/mongo/chat.js';

let replica, database, app, worker, media, photo;
const uploaded = new Set(), deleted = new Set(), revoked = new Set(), authDeleted = new Set();
let aiCalls = 0;
const identity = {
  async verifyToken(token) {
    if (token === 'expired') throw new Error('secret-token-error');
    return { uid: token, name: 'Test user', email_verified: token !== 'unverified',
      auth_time: token === 'old-login' ? 1 : Math.floor(Date.now() / 1000) };
  },
  async verifyApp(token) { if (token !== 'valid-app') throw new Error('invalid'); },
  auth: { async revokeRefreshTokens(uid) { revoked.add(uid); }, async deleteUser(uid) { authDeleted.add(uid); } },
};
const transport = {
  async upload(bytes, id) { uploaded.add(id); return { public_id: id }; },
  async destroy(id) { deleted.add(id); },
  download: id => `https://media.example.com/${id}?expires=60`,
};
const ai = {
  async analyzeFoodImage() {
    aiCalls++;
    return { mealType: 'lunch', needsUserConfirmation: true, analysisNotes: 'Estimate', foods: [{
      name: 'Rice', estimatedQuantity: 100, unit: 'g', confidence: 0.5, alternatives: [],
      per100g: { calories: 130, protein: 3, carbs: 28, fat: 1, fiber: null },
    }] };
  },
  async chat(message, context) { aiCalls++; assert.ok(JSON.stringify(context).length <= 20000); return { text: 'A nutrition idea.', tool: null }; },
};
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  database = await connectDatabase({ uri: replica.getUri(), database: 'api_test' });
  media = mediaStore(database, transport); worker = cleanupWorker(database, transport, identity.auth);
  app = createApp({ database, identity, media, worker, ai, publicAppOrigin: 'https://app.example.com', production: true,
    nutrition: { search: async () => [] } });
  photo = (await sharp({ create: { width: 16, height: 16, channels: 3, background: '#88aa66' } }).png().toBuffer()).toString('base64');
}, { timeout: 60000 });
after(async () => { await database?.close(); await replica?.stop(); });
const call = (user, method, path) => request(app)[method](`/api${path}`).set('Authorization', `Bearer ${user}`).set('X-Firebase-AppCheck', 'valid-app');
const meal = (id = randomUUID()) => ({ id, mealType: 'lunch', eatenAt: '2026-01-15T12:00:00Z', timeZone: 'Asia/Kolkata', imagePath: null,
  foods: [{ food: { id: 'label:rice', name: 'Rice', attribution: 'User-entered label: rice',
    per100g: { calories: 130, protein: 3, carbs: 28, fat: 1, fiber: null } }, grams: 100, source: 'user_entered', confidence: null }] });

test('API rejects absent/expired tokens, invalid attestation and forged profile identity', async () => {
  assert.equal((await request(app).get('/api/profile')).status, 401);
  const expired = await call('expired', 'get', '/profile'); assert.equal(expired.status, 401); assert.equal(expired.body.code, 'sign-in-required');
  assert.equal((await request(app).get('/api/profile').set('Authorization', 'Bearer api-user')).status, 403);
  assert.equal((await call('api-user', 'put', '/profile').send({ name: 'A', health: null, userId: 'victim' })).status, 400);
  const profile = await call('api-user', 'get', '/profile'); assert.equal(profile.body.profile.userId, 'api-user');
  assert.equal(profile.body.profile._id, undefined);
});
test('API settings, meals and daily/monthly/yearly reports read from MongoDB', async () => {
  assert.equal((await call('api-user', 'put', '/settings').send({ analytics: false, notifications: true })).status, 200);
  assert.equal((await call('api-user', 'get', '/settings')).body.notifications, true);
  const value = meal(); assert.equal((await call('api-user', 'put', `/meals/${value.id}`).send(value)).status, 200);
  assert.equal((await call('api-user', 'get', '/meals')).body.meals.length, 1);
  assert.equal((await call('other-user', 'get', '/meals')).body.meals.length, 0);
  for (const [startDate, endDate] of [['2026-01-15','2026-01-16'],['2026-01-01','2026-02-01'],['2026-01-01','2027-01-01']]) {
    const report = await call('api-user', 'get', `/reports?startDate=${startDate}&endDate=${endDate}`);
    assert.equal(report.status, 200); assert.equal(report.body.totals.calories, 130);
  }
});
test('verification is required for AI and media, and scan estimates are canonical owner snapshots', async () => {
  assert.equal((await call('unverified', 'post', '/analyze').send({ image: photo, reference: false, referenceDescription: '' })).status, 403);
  assert.equal((await call('unverified', 'post', '/media').send({ image: photo })).status, 403);
  const scan = await call('scanner', 'post', '/analyze').send({ image: photo, reference: false, referenceDescription: '' });
  assert.equal(scan.status, 200);
  const value = meal(); value.foods[0].food = scan.body.foods[0].nutrition; value.foods[0].food.per100g.calories = 999;
  assert.equal((await call('scanner', 'put', `/meals/${value.id}`).send(value)).status, 200);
  assert.equal((await call('scanner', 'get', '/meals')).body.meals[0].foods[0].food.per100g.calories, 130);
  assert.equal((await call('other-user', 'put', `/meals/${value.id}`).send(value)).status, 400);
});
test('photos upload privately, attach, authorize delivery and enqueue removal', async () => {
  const upload = await call('photos', 'post', '/media').send({ image: photo }); assert.equal(upload.status, 200);
  const id = upload.body.id; assert.ok(id); assert.equal(upload.body.url, undefined);
  assert.equal((await call('other-user', 'get', `/media/${id}`)).status, 404);
  const url = await call('photos', 'get', `/media/${id}`); assert.equal(url.body.expiresIn, 60);
  const value = { ...meal(), imagePath: id };
  assert.equal((await call('photos', 'put', `/meals/${value.id}`).send(value)).status, 200);
  assert.equal((await call('photos', 'delete', `/media/${id}`)).status, 409);
  assert.equal((await call('photos', 'put', `/meals/${value.id}`).send({ ...value, imagePath: null })).status, 200);
  await worker.run(); assert.equal((await call('photos', 'get', `/media/${id}`)).status, 404);
  assert.ok(deleted.size > 0);
});
test('chat retries do not call AI twice and clearing history fences a pending reply', async () => {
  const body = { message: 'Suggest lunch', requestId: randomUUID(), start: '2026-01-15T00:00:00Z', end: '2026-01-16T00:00:00Z', timeZone: 'UTC' };
  const beforeCalls = aiCalls;
  const first = await call('chatter', 'post', '/chat').send(body); assert.equal(first.status, 200);
  const second = await call('chatter', 'post', '/chat').send(body); assert.deepEqual(second.body, first.body);
  assert.equal(aiCalls, beforeCalls + 1);
  assert.equal((await call('chatter', 'get', '/chat')).body.messages.length, 2);
  assert.equal((await call('chatter', 'post', '/chat').send({ ...body, message: 'changed' })).status, 409);
  const store = chatStore(database), id = randomUUID(), turn = await store.begin('chatter', id, 'signature', 'pending');
  await store.clear('chatter');
  await assert.rejects(store.finish('chatter', id, turn.attempt, { text: 'late', proposal: null }), e => e.code === 'request-conflict');
  assert.equal((await store.history('chatter')).length, 0);
});
test('reminder preferences and memory are owner scoped', async () => {
  assert.equal((await call('api-user', 'put', '/assistant-memory').send({ notes: 'Vegetarian meals' })).status, 200);
  assert.equal((await call('other-user', 'get', '/assistant-memory')).body.notes, '');
  const preferences = { mealReminders: true, movementReminders: false, mealHour: 0, movementHour: 17, quietStart: 0, quietEnd: 0 };
  assert.equal((await call('api-user', 'put', '/reminders/preferences').send(preferences)).status, 200);
  await call('api-user', 'post', '/notifications/check').send({});
  const first = await call('api-user', 'get', '/notifications'); assert.equal(first.body.notifications.length, 1);
  await call('api-user', 'post', '/notifications/check').send({});
  assert.equal((await call('api-user', 'get', '/notifications')).body.notifications.length, 1);
  assert.equal((await call('other-user', 'get', '/notifications')).body.notifications.length, 0);
});
test('account deletion requires recent login and removes data and images through the worker', async () => {
  assert.equal((await call('old-login', 'delete', '/account').send({ confirmation: 'DELETE' })).status, 401);
  const upload = await call('delete-user', 'post', '/media').send({ image: photo }); assert.equal(upload.status, 200);
  const result = await call('delete-user', 'delete', '/account').send({ confirmation: 'DELETE' }); assert.equal(result.status, 200);
  assert.equal(revoked.has('delete-user'), true); assert.equal(authDeleted.has('delete-user'), true);
  assert.equal(await database.db.collection('mediaAssets').countDocuments({ userId: 'delete-user' }), 0);
  assert.equal((await call('delete-user', 'get', '/meals')).status, 403);
});
test('invalid uploads are rejected and signed download links actually expire', async () => {
  await assert.rejects(normalizePhoto(Buffer.from('not-an-image').toString('base64')), e => e.code === 'invalid-image');
  const real = cloudinaryTransport({ cloudName: 'test-cloud', apiKey: 'test-key', apiSecret: 'test-secret' });
  const url = new URL(real.download('private/photo'));
  const expiry = Number(url.searchParams.get('expires_at'));
  assert.ok(expiry >= Date.now() / 1000 + 50 && expiry <= Date.now() / 1000 + 61);
  assert.ok(url.searchParams.get('signature')); assert.equal(url.toString().includes('test-secret'), false);
});

test('uncertain uploads remain recoverable and a failed cleanup retries', async () => {
  await call('failed-upload', 'get', '/profile');
  const failed = mediaStore(database, { ...transport, async upload() { throw new Error('private-provider-detail'); } });
  await assert.rejects(failed.upload('failed-upload', photo), error => error.code === 'photo-upload-unavailable' && !error.message.includes('private-provider'));
  const asset = await database.db.collection('mediaAssets').findOne({ userId: 'failed-upload' });
  assert.ok(asset.publicId);
  await database.db.collection('mediaAssets').updateOne({ userId: 'failed-upload', id: asset.id },
    { $set: { updatedAt: new Date(Date.now() - 600000) } });
  let attempts = 0;
  const retry = cleanupWorker(database, { ...transport, async destroy() { if (++attempts === 1) throw new Error('temporary'); } }, identity.auth);
  await retry.run(1);
  const job = await database.db.collection('cleanupJobs').findOne({ userId: 'failed-upload' });
  assert.equal(job.status, 'pending'); assert.equal(job.attempts, 1);
  await database.db.collection('cleanupJobs').updateOne({ id: job.id }, { $set: { nextAttemptAt: new Date() } });
  await retry.run(1);
  assert.equal(attempts, 2);
  assert.equal(await database.db.collection('mediaAssets').countDocuments({ userId: 'failed-upload' }), 0);
});

test('deletion during an upload cannot leave an untracked Cloudinary asset', async () => {
  await call('upload-race', 'get', '/profile');
  let release, announce;
  const started = new Promise(resolve => { announce = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const racing = mediaStore(database, { ...transport, async upload() { announce(); await pending; } });
  const upload = racing.upload('upload-race', photo);
  const rejected = assert.rejects(upload, error => error.code === 'photo-upload-unavailable');
  await started;
  const { userStore } = await import('../src/mongo/users.js');
  await userStore(database).beginDeletion('upload-race');
  release(); await rejected;
  const asset = await database.db.collection('mediaAssets').findOne({ userId: 'upload-race' });
  assert.ok(asset);
  await database.db.collection('mediaAssets').updateOne({ userId: 'upload-race', id: asset.id },
    { $set: { updatedAt: new Date(Date.now() - 600000) } });
  await worker.run();
  assert.equal(await database.db.collection('mediaAssets').countDocuments({ userId: 'upload-race' }), 0);
  assert.equal(deleted.has(asset.publicId), true);
});
