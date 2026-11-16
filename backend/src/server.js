import express from 'express';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHostedEnvironment } from './runtime_config.js';
import { connectDatabase } from './mongo/database.js';
import { firebaseIdentity } from './identity.js';
import { cloudinaryTransport, mediaStore } from './media.js';
import { cleanupWorker } from './cleanup.js';
import { createApp } from './mongo_app.js';
import { migrationConfig } from './migration_config.js';

const config = process.env.APP_ENV === 'development'
  ? { ...migrationConfig(process.env), port: Number(process.env.PORT ?? 8787) }
  : validateHostedEnvironment(process.env);
let database;
try {
  database = await connectDatabase(config.mongo);
  const identity = firebaseIdentity(config.firebase);
  const transport = cloudinaryTransport(config.cloudinary);
  const media = mediaStore(database, transport), worker = cleanupWorker(database, transport, identity.auth);
  const app = createApp({ database, identity, media, worker, production: config.production, publicAppOrigin: config.publicAppOrigin });
  const web = process.env.WEB_DIST_PATH ? resolve(process.env.WEB_DIST_PATH) : fileURLToPath(new URL('../../build/web/', import.meta.url));
  if (existsSync(resolve(web, 'index.html'))) {
    app.use(express.static(web, { dotfiles: 'deny', setHeaders: res => res.set('Cache-Control', 'no-cache') }));
    app.get('/{*path}', (req, res) => {
      if (extname(req.path) || !req.accepts('html')) return res.sendStatus(404);
      res.set('Cache-Control', 'no-store').sendFile(resolve(web, 'index.html'));
    });
  }
  let working = null;
  const tick = () => { if (!working) working = worker.run().catch(() => {
    console.error(JSON.stringify({ event: 'cleanup_worker_failed' }));
  }).finally(() => { working = null; }); };
  const timer = setInterval(tick, 30000); timer.unref(); tick();
  const server = app.listen(config.port, '0.0.0.0', () => console.log('Health Broget MongoDB API ready'));
  async function shutdown() {
    clearInterval(timer);
    const deadline = setTimeout(() => process.exit(1), 30000); deadline.unref();
    server.close(async () => { await working; await database.close(); clearTimeout(deadline); });
  }
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
} catch (error) {
  await database?.close();
  console.error(JSON.stringify({ event: 'startup_failed', code: error.code ?? 'configuration-error' }));
  process.exitCode = 1;
}
