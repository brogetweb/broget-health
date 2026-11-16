import { migrationConfig } from './migration_config.js';
export function validateHostedEnvironment(env) {
  if (!['production', 'staging'].includes(env.APP_ENV)) throw new Error('Hosted server requires APP_ENV=production or staging');
  if (['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'].some(key => env[key])) throw new Error('Hosted server cannot use Firebase emulators');
  const config = migrationConfig(env);
  if (!env.AI_API_KEY || !env.AI_MODEL) throw new Error('Set AI_API_KEY and AI_MODEL on the backend host');
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
  return { ...config, port };
}
