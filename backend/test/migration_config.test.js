import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationConfig } from '../src/migration_config.js';

const base = {
  APP_ENV: 'production', MONGODB_URI: 'mongodb+srv://user:private-password@cluster.example.com/',
  MONGODB_DB_NAME: 'health_broget_staging', PUBLIC_APP_ORIGIN: 'https://app.example.com',
  CLOUDINARY_CLOUD_NAME: 'example-cloud', CLOUDINARY_API_KEY: 'test-key',
  CLOUDINARY_API_SECRET: 'private-cloudinary-secret', FIREBASE_PROJECT_ID: 'health-broget-test',
  GOOGLE_APPLICATION_CREDENTIALS: '/run/secrets/firebase-admin.json',
};

test('migration configuration selects Firebase identity without requiring Firestore or mail', () => {
  const config = migrationConfig(base);
  assert.equal(config.mongo.database, 'health_broget_staging');
  assert.equal(config.firebase.projectId, 'health-broget-test');
  assert.equal(config.mail, undefined);
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.cloudinary));
});

test('configuration errors never echo supplied secrets', () => {
  for (const patch of [
    { MONGODB_URI: 'private-password' },
    { MONGODB_URI: 'https://user:private-password@cluster.example.com/' },
    { CLOUDINARY_API_SECRET: '' }, { GOOGLE_APPLICATION_CREDENTIALS: '' },
  ]) {
    assert.throws(() => migrationConfig({ ...base, ...patch }), error =>
      !error.message.includes('private-password') && !error.message.includes('private-cloudinary-secret'));
  }
});

test('production rejects insecure origins, disabled TLS and invalid database names', () => {
  for (const patch of [
    { PUBLIC_APP_ORIGIN: 'http://localhost:5173' },
    { PUBLIC_APP_ORIGIN: 'https://app.example.com/path' },
    { PUBLIC_APP_ORIGIN: 'https://user:password@app.example.com' },
    { MONGODB_URI: `${base.MONGODB_URI}?tls=false` },
    { MONGODB_DB_NAME: 'health.broget' },
  ]) assert.throws(() => migrationConfig({ ...base, ...patch }));
  assert.equal(migrationConfig({ ...base, APP_ENV: 'development', PUBLIC_APP_ORIGIN: 'http://localhost:5173' }).production, false);
});

test('Firebase identity requires an explicit live project and server credential path', () => {
  for (const projectId of ['', 'demo-health-broget', 'https://firebase.example.com', 'invalid project']) {
    assert.throws(() => migrationConfig({ ...base, FIREBASE_PROJECT_ID: projectId }));
  }
  assert.throws(() => migrationConfig({ ...base, GOOGLE_APPLICATION_CREDENTIALS: '' }));
  assert.equal(migrationConfig({ ...base, GOOGLE_APPLICATION_CREDENTIALS: '', FIREBASE_SERVICE_ACCOUNT_JSON: '{"type":"service_account"}' }).firebase.credentialPath, null);
});

test('separate Firebase Hosting origins are explicit and reject insecure or path-based entries', () => {
  assert.deepEqual(migrationConfig({ ...base, ADDITIONAL_APP_ORIGINS: 'https://app.example.com, https://project.firebaseapp.com' }).allowedOrigins,
    ['https://app.example.com', 'https://project.firebaseapp.com']);
  for (const value of ['http://evil.example.com', 'https://example.com/path', 'https://user:pass@example.com']) {
    assert.throws(() => migrationConfig({ ...base, ADDITIONAL_APP_ORIGINS: value }));
  }
});
