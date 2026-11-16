import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { userStore, activeOwner } from './mongo/users.js';
import { mealStore } from './mongo/meals.js';
import { chatStore } from './mongo/chat.js';
import { reminderStore } from './mongo/reminders.js';
import { consumeQuota } from './mongo/quota.js';
import { StoreError, ownerId } from './mongo/errors.js';
import { nutritionStore } from './nutrition.js';
import { assistantTools } from './tools.js';
import { compactReport } from './compact_report.js';
import { normalizePhoto } from './media.js';
import { provider } from './provider.js';
import { AiTransportError } from './ai_transport.js';
import { scanSchema, chatSchema, mealSchema, directAnswer, foodSchema, dateRangeSchema } from './contracts.js';
import { reportRangeSchema, timeZoneSchema } from './calendar.js';

export function createApp({ database, identity, media, worker, publicAppOrigin, production = true, ai = provider, nutrition = nutritionStore(database) }) {
  const app = express(), api = express.Router(), { db } = database;
  const users = userStore(database), meals = mealStore(database), chat = chatStore(database), reminders = reminderStore(database);
  const tools = assistantTools(database, meals, users, nutrition);
  app.disable('x-powered-by');
  if (production) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()' });
    next();
  });
  app.get('/health', async (req, res) => {
    const ready = await database.ready();
    res.set('Cache-Control', 'no-store').status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable', name: 'Health Broget', database: 'mongodb' });
  });
  api.use((req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Request-ID': randomUUID() }); next(); });
  api.use(cors({ origin: (origin, done) => done(null, !origin || origin === publicAppOrigin),
    methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Firebase-AppCheck'] }));
  api.use(express.json({ limit: '3mb' }));
  api.use(async (req, res, next) => {
    try {
      const ipHash = createHash('sha256').update(req.ip ?? 'unknown').digest('hex');
      await consumeQuota(database, `ip:${ipHash}`, 'requests', 3600);
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
      if (!token) throw new StoreError(401, 'sign-in-required');
      let claims;
      try { claims = await identity.verifyToken(token); }
      catch { throw new StoreError(401, 'sign-in-required'); }
      req.uid = ownerId(claims.uid); req.authTime = claims.auth_time; req.admin = claims.admin === true;
      if (production) {
        const token = req.headers['x-firebase-appcheck'];
        if (typeof token !== 'string' || !token) throw new StoreError(403, 'attestation-required');
        try { await identity.verifyApp(token); } catch { throw new StoreError(403, 'attestation-required'); }
      }
      await consumeQuota(database, req.uid, 'requests', 600);
      req.profile = await db.collection('users').findOne({ userId: req.uid }, { projection: { _id: 0, revision: 0 } })
        ?? await users.ensure(req.uid, claims.name ?? '');
      if (req.profile.deleting && !((req.method === 'GET' && req.path === '/profile') || (req.method === 'DELETE' && req.path === '/account'))) {
        throw new StoreError(403, 'account-deleting');
      }
      if (!claims.email_verified && ['/analyze', '/chat', '/summary', '/foods', '/media'].includes(req.path) && req.method !== 'GET') {
        throw new StoreError(403, 'verify-email');
      }
      if (!claims.email_verified && req.path === '/foods') throw new StoreError(403, 'verify-email');
      next();
    } catch (error) { next(error); }
  });
  async function writePrivate(userId, collection, filter, value) {
    await database.transaction(async (db, session) => {
      await activeOwner(db, session, userId);
      await db.collection(collection).updateOne({ ...filter, userId }, { $set: { ...value, userId } }, { session, upsert: true });
    });
  }
  api.get('/profile', (req, res) => res.json({ profile: req.profile }));
  api.put('/profile', async (req, res) => res.json({ profile: await users.save(req.uid, req.body) }));
  api.post('/account/bootstrap', async (req, res) => {
    const { name } = z.object({ name: z.string().trim().max(80) }).strict().parse(req.body);
    res.json({ profile: await users.ensure(req.uid, name) });
  });
  api.get('/settings', async (req, res) => res.json(await users.preferences(req.uid)));
  api.put('/settings', async (req, res) => res.json(await users.savePreferences(req.uid, req.body)));
  api.get('/meals', async (req, res) => {
    if ('start' in req.query || 'end' in req.query) {
      const range = dateRangeSchema.parse(req.query); res.json({ meals: await meals.range(req.uid, range.start, range.end) });
    } else {
      const { cursor } = z.object({ cursor: z.string().max(1000).optional() }).strict().parse(req.query);
      res.json(await meals.page(req.uid, cursor));
    }
  });
  api.put('/meals/:id', async (req, res) => {
    const meal = mealSchema.parse(req.body);
    if (meal.id !== req.params.id) throw new StoreError(400, 'invalid-input');
    await meals.save(req.uid, meal); res.json({ ok: true });
  });
  api.delete('/meals/:id', async (req, res) => { await meals.delete(req.uid, req.params.id); res.json({ ok: true }); });
  api.post('/reports/prepare', async (req, res) => {
    const { timeZone } = z.object({ timeZone: timeZoneSchema }).strict().parse(req.body);
    await database.transaction(async (db, session) => {
      await activeOwner(db, session, req.uid);
      await db.collection('reportState').updateOne({ userId: req.uid }, { $setOnInsert: {
        userId: req.uid, timeZone, complete: true, version: 1,
      } }, { session, upsert: true });
    });
    const state = await db.collection('reportState').findOne({ userId: req.uid });
    res.json({ complete: true, timeZone: state.timeZone });
  });
  api.get('/reports', async (req, res) => { const range = reportRangeSchema.parse(req.query); res.json(await meals.report(req.uid, range.startDate, range.endDate)); });
  api.get('/foods', async (req, res) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(100) }).strict().parse(req.query);
    await consumeQuota(database, req.uid, 'food-search', 120); res.json({ foods: await nutrition.search(q) });
  });
  api.post('/analyze', async (req, res) => {
    const input = scanSchema.parse(req.body), image = await normalizePhoto(input.image);
    const id = createHash('sha256').update(image).update(JSON.stringify([input.reference, input.referenceDescription])).digest('hex');
    const cached = await db.collection('analyses').findOne({ userId: req.uid, id, expiresAt: { $gt: new Date() } });
    if (cached) return res.json(cached.result);
    await consumeQuota(database, req.uid, 'scans', 20); await consumeQuota(database, req.uid, 'scan-throttle', 1, 8);
    const result = await ai.analyzeFoodImage(image, input.reference, input.referenceDescription);
    const snapshot = createHash('sha256').update(randomUUID()).digest('hex');
    result.foods = result.foods.map((food, i) => ({ ...food, nutrition: foodSchema.parse({
      id: `ai:${snapshot}:${i}`, name: food.name, per100g: food.per100g, attribution: 'AI photo estimate · user reviewed',
    }) }));
    await database.transaction(async (db, session) => {
      await activeOwner(db, session, req.uid);
      for (const food of result.foods) await db.collection('scanFoods').insertOne({ userId: req.uid, id: food.nutrition.id, food: food.nutrition }, { session });
      await db.collection('analyses').updateOne({ userId: req.uid, id }, { $set: { result, expiresAt: new Date(Date.now() + 3600000) } }, { session, upsert: true });
    });
    res.json(result);
  });
  api.post('/media', async (req, res) => {
    const { image } = z.object({ image: z.string().max(2800000) }).strict().parse(req.body);
    await consumeQuota(database, req.uid, 'photo-upload', 30); res.json(await media.upload(req.uid, image));
  });
  api.get('/media/:id', async (req, res) => res.json(await media.url(req.uid, z.string().uuid().parse(req.params.id))));
  api.delete('/media/:id', async (req, res) => { await media.discard(req.uid, z.string().uuid().parse(req.params.id)); res.json({ ok: true }); });
  api.get('/chat', async (req, res) => res.json({ messages: await chat.history(req.uid) }));
  api.delete('/chat', async (req, res) => { await chat.clear(req.uid); res.json({ ok: true }); });
  api.post('/chat', async (req, res) => {
    const input = chatSchema.parse(req.body), id = input.requestId ?? randomUUID();
    const signature = createHash('sha256').update(JSON.stringify([input.message, input.start, input.end, input.timeZone ?? 'UTC'])).digest('hex');
    const turn = await chat.begin(req.uid, id, signature, input.message);
    if (turn.cached) return res.json(turn.cached);
    try {
      await consumeQuota(database, req.uid, 'chat', 60); await consumeQuota(database, req.uid, 'chat-throttle', 1, 3);
      const instant = directAnswer(input.message); let reply;
      if (instant) reply = { text: instant, proposal: null };
      else {
        const range = { start: input.start, end: input.end }, context = await tools.context(req.uid, range);
        let answer = await ai.chat(input.message, context), proposal = null;
        if (answer.tool) {
          const result = await tools.execute(req.uid, answer.tool, range);
          if (result?.requiresUserConfirmation) proposal = result;
          else answer = await ai.chat(input.message, context, result);
        }
        reply = { text: answer.text, proposal };
      }
      await chat.finish(req.uid, id, turn.attempt, reply); res.json(reply);
    } catch (error) { await chat.fail(req.uid, id, turn.attempt); throw error; }
  });
  api.post('/summary', async (req, res) => {
    const range = reportRangeSchema.parse(req.body); await consumeQuota(database, req.uid, 'summaries', 12);
    const report = compactReport(await meals.report(req.uid, range.startDate, range.endDate));
    const answer = await ai.chat('Explain this deterministic report; mention estimates and incomplete logging. Do not calculate new statistics.', report);
    const id = randomUUID();
    await database.transaction(async (db, session) => {
      await activeOwner(db, session, req.uid);
      await db.collection('reportNarratives').insertOne({ userId: req.uid, id, ...range,
        text: answer.text, totals: report.totals, source: 'ai_explanation', createdAt: new Date() }, { session });
      await db.collection('engagementEvents').insertOne({ userId: req.uid, id,
        type: 'report_explained', subjectId: id, createdAt: new Date() }, { session });
    });
    res.json({ text: answer.text });
  });
  api.get('/assistant-memory', async (req, res) => res.json({ notes: (await db.collection('assistantMemory').findOne({ userId: req.uid }))?.notes ?? '' }));
  api.put('/assistant-memory', async (req, res) => {
    const { notes } = z.object({ notes: z.string().trim().max(1000) }).strict().parse(req.body);
    await writePrivate(req.uid, 'assistantMemory', {}, { notes, source: 'user_confirmed', updatedAt: new Date() }); res.json({ ok: true });
  });
  api.get('/reminders/preferences', async (req, res) => res.json(await reminders.preferences(req.uid)));
  api.put('/reminders/preferences', async (req, res) => { await reminders.savePreferences(req.uid, req.body); res.json({ ok: true }); });
  api.post('/notifications/check', async (req, res) => { z.object({}).strict().parse(req.body); await consumeQuota(database, req.uid, 'reminder-check', 30); res.json(await reminders.generate(req.uid)); });
  api.get('/notifications', async (req, res) => {
    const { cursor } = z.object({ cursor: z.string().regex(/^\d{4}-\d{2}-\d{2}_(meal|movement)$/).optional() }).strict().parse(req.query);
    res.json(await reminders.page(req.uid, cursor));
  });
  api.post('/notifications/:id/action', async (req, res) => {
    const id = z.string().regex(/^\d{4}-\d{2}-\d{2}_(meal|movement)$/).parse(req.params.id);
    const { action } = z.object({ action: z.enum(['opened', 'dismissed', 'completed']) }).strict().parse(req.body);
    await reminders.action(req.uid, id, action); res.json({ ok: true });
  });
  api.delete('/account', async (req, res) => {
    if (!Number.isFinite(req.authTime) || Date.now() / 1000 - req.authTime > 300) throw new StoreError(401, 'recent-login-required');
    z.object({ confirmation: z.literal('DELETE') }).strict().parse(req.body);
    await users.beginDeletion(req.uid); await worker.run();
    res.json({ ok: true, deletionQueued: true });
  });
  api.put('/admin/foods/:id', async (req, res) => {
    if (!req.admin) throw new StoreError(403, 'unauthorized');
    const id = z.string().regex(/^[a-z0-9_-]{1,100}$/).parse(req.params.id);
    const value = z.object({ food: foodSchema.omit({ id: true }), searchTerms: z.array(z.string().min(2).max(100)).min(1).max(50) }).strict().parse(req.body);
    await db.collection('foods').updateOne({ id }, { $set: value }, { upsert: true }); res.json({ ok: true });
  });
  api.get('/admin/metrics', async (req, res) => {
    if (!req.admin) throw new StoreError(403, 'unauthorized');
    res.json({ users: await db.collection('users').countDocuments({ deleting: false }) });
  });
  api.use((req, res) => res.status(404).json({ code: 'not-found' }));
  api.use((error, req, res, next) => {
    const invalid = error instanceof z.ZodError || (error instanceof SyntaxError && error.status === 400);
    const status = invalid ? 400 : error instanceof StoreError || error instanceof AiTransportError ? error.status : error.status === 413 ? 413 : 500;
    const code = invalid ? 'invalid-input' : error instanceof StoreError || error instanceof AiTransportError ? error.code : status === 413 ? 'image-too-large' : 'service-unavailable';
    if (status >= 500) console.error(JSON.stringify({ event: 'request_failed', code, requestId: res.get('X-Request-ID'), upstreamStatus: error instanceof AiTransportError ? error.upstreamStatus : undefined }));
    res.status(status).json({ code });
  });
  app.use('/api', api);
  return app;
}
