import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

test('Render entry starts with MongoDB and protects API routes without using emulators', { timeout: 60000 }, async () => {
  const replica = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const env = { ...process.env, APP_ENV: 'production', GCLOUD_PROJECT: 'broget-health-ai', AI_API_KEY: 'test-only', AI_MODEL: 'test-model', ALLOWED_ORIGINS: 'https://broget-health-ai.web.app', PORT: String(port) };
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'GOOGLE_APPLICATION_CREDENTIALS']) delete env[key];
  // A generated test-only key prevents ADC from contacting a metadata server.
  // It cannot authenticate with Google and is never used for an API request.
  const directory = await mkdtemp(join(tmpdir(), 'broget-host-test-'));
  const credentialPath = join(directory, 'credential.json');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await writeFile(credentialPath, JSON.stringify({ type: 'service_account', project_id: 'broget-health-ai', client_email: 'test-only@broget-health-ai.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
  env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
  Object.assign(env, { MONGODB_URI: replica.getUri(), MONGODB_DB_NAME: 'hosted_test',
    FIREBASE_PROJECT_ID: 'broget-health-ai', PUBLIC_APP_ORIGIN: 'https://app.example.com',
    CLOUDINARY_CLOUD_NAME: 'test-only', CLOUDINARY_API_KEY: 'test-only', CLOUDINARY_API_SECRET: 'test-only' });
  const child = spawn(process.execPath, ['src/server.js'], { cwd: new URL('../', import.meta.url), env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Hosted API did not start')), 12000);
      child.stdout.on('data', chunk => {
        if (chunk.toString().includes('Health Broget MongoDB API ready')) { clearTimeout(timer); resolve(); }
      });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Hosted API exited before readiness')); });
      child.once('error', reject);
    });
    const url = `http://127.0.0.1:${port}`;
    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200); assert.deepEqual(await health.json(), { status: 'ok', name: 'Health Broget', database: 'mongodb' });
    const protectedRequest = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(protectedRequest.status, 401);
    assert.deepEqual(await protectedRequest.json(), { code: 'sign-in-required' });
  } finally {
    child.kill('SIGTERM');
    await exited;
    await unlink(credentialPath);
    await rmdir(directory);
    await replica.stop();
  }
});
