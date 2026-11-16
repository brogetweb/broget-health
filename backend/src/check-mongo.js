import { connectDatabase } from './mongo/database.js';
let database;
try {
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB_NAME) throw new Error('missing-configuration');
  database = await connectDatabase({ uri: process.env.MONGODB_URI, database: process.env.MONGODB_DB_NAME },
    { initialize: process.argv.includes('--initialize') });
  console.log(JSON.stringify({ database: process.env.MONGODB_DB_NAME, connected: await database.ready(),
    initialized: process.argv.includes('--initialize'), collections: (await database.db.listCollections({}, { nameOnly: true }).toArray()).length }));
} catch (error) {
  console.error(JSON.stringify({ event: 'database_check_failed', code: typeof error.code === 'string' ? error.code : 'database-unavailable' }));
  process.exitCode = 1;
} finally { await database?.close(); }
