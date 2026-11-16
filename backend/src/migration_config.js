// Stage-one configuration boundary for the replacement backend. The deployed
// Firebase server does not import this module until the migration is complete.
function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Set ${name}`);
  return value.trim();
}

export function migrationConfig(env) {
  const production = ['production', 'staging'].includes(env.APP_ENV);
  if (!production && env.APP_ENV !== 'development' && env.APP_ENV !== 'test' && env.APP_ENV !== 'staging') {
    throw new Error('Set APP_ENV to development, staging, test or production');
  }
  const uri = required(env, 'MONGODB_URI');
  // Never include the URI in an exception: it can contain a database password.
  let databaseUrl;
  try { databaseUrl = new URL(uri); } catch { throw new Error('Invalid MONGODB_URI'); }
  if (!['mongodb:', 'mongodb+srv:'].includes(databaseUrl.protocol) || !databaseUrl.hostname) {
    throw new Error('Invalid MONGODB_URI');
  }
  if ((production || env.APP_ENV === 'staging') && ['tls', 'ssl', 'tlsInsecure', 'tlsAllowInvalidCertificates', 'tlsAllowInvalidHostnames'].some(key => {
    const value = databaseUrl.searchParams.get(key)?.toLowerCase();
    return ['tls', 'ssl'].includes(key) ? value === 'false' : value === 'true';
  })) {
    throw new Error('MONGODB_URI must not disable TLS in production');
  }
  const database = required(env, 'MONGODB_DB_NAME');
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(database)) throw new Error('Invalid MONGODB_DB_NAME');
  let origin;
  try { origin = new URL(required(env, 'PUBLIC_APP_ORIGIN')); }
  catch { throw new Error('Invalid PUBLIC_APP_ORIGIN'); }
  if (origin.origin !== env.PUBLIC_APP_ORIGIN || origin.username || origin.password ||
      (origin.protocol !== 'https:' && !( !production && origin.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) {
    throw new Error('PUBLIC_APP_ORIGIN must be an HTTPS origin (local HTTP is development only)');
  }
  const cloudName = required(env, 'CLOUDINARY_CLOUD_NAME');
  if (!/^[A-Za-z0-9_-]+$/.test(cloudName)) throw new Error('Invalid CLOUDINARY_CLOUD_NAME');
  const projectId = required(env, 'FIREBASE_PROJECT_ID');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) || ((production || env.APP_ENV === 'staging') && projectId.startsWith('demo-'))) {
    throw new Error('FIREBASE_PROJECT_ID must identify the new live Firebase project');
  }
  const credentialPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || null;
  const serviceAccountJson = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || null;
  if (!credentialPath && !serviceAccountJson) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON');
  return Object.freeze({
    production, publicAppOrigin: origin.origin,
    mongo: Object.freeze({ uri, database }),
    cloudinary: Object.freeze({ cloudName, apiKey: required(env, 'CLOUDINARY_API_KEY'),
      apiSecret: required(env, 'CLOUDINARY_API_SECRET') }),
    firebase: Object.freeze({ projectId, credentialPath, serviceAccountJson }),
  });
}
