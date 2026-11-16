// Only explicitly public values reach Flutter. Backend credentials are excluded.
import { writeFile } from 'node:fs/promises';
const origin = process.env.PUBLIC_APP_ORIGIN;
let url;
try { url = new URL(origin); } catch { throw new Error('Set PUBLIC_APP_ORIGIN'); }
if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('PUBLIC_APP_ORIGIN must be an HTTPS origin');
const config = { APP_ENV: 'production', USE_EMULATORS: 'false', API_BASE_URL: `${origin}/api` };
for (const key of ['FIREBASE_API_KEY', 'FIREBASE_APP_ID', 'FIREBASE_PROJECT_ID', 'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_AUTH_DOMAIN', 'RECAPTCHA_SITE_KEY']) {
  if (!process.env[key]) throw new Error(`Set public build variable ${key}`);
  config[key] = process.env[key];
}
config.APP_DOWNLOAD_URL = process.env.APP_DOWNLOAD_URL ?? '';
await writeFile('config/railway-build.local.json', JSON.stringify(config));
