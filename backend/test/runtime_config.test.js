import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHostedEnvironment } from '../src/runtime_config.js';
const valid = { APP_ENV: 'production', FIREBASE_PROJECT_ID: 'health-broget-test', GOOGLE_APPLICATION_CREDENTIALS: '/run/secrets/firebase.json',
  MONGODB_URI: 'mongodb+srv://example:password@cluster.example.com/', MONGODB_DB_NAME: 'health_broget', PUBLIC_APP_ORIGIN: 'https://app.example.com',
  CLOUDINARY_CLOUD_NAME: 'example', CLOUDINARY_API_KEY: 'key', CLOUDINARY_API_SECRET: 'secret', AI_API_KEY: 'test-only', AI_MODEL: 'test-model', PORT: '10000' };
test('Railway startup validates all services and refuses emulator or incomplete configuration', () => {
  assert.equal(validateHostedEnvironment(valid).port, 10000);
  assert.equal(validateHostedEnvironment(valid).production, true);
  for (const change of [{APP_ENV:'development'}, {FIREBASE_PROJECT_ID:'demo-broget'}, {FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'},
    {AI_API_KEY:''},{AI_MODEL:''},{PORT:'-1'},{PORT:'NaN'}, {MONGODB_URI:''}, {CLOUDINARY_API_SECRET:''}, {PUBLIC_APP_ORIGIN:'http://localhost:5173'}]) {
    assert.throws(() => validateHostedEnvironment({...valid,...change}));
  }
});
