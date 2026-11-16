// Import reviewed, licensed regional nutrition entries; never synthesize nutrients.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { connectDatabase } from '../backend/src/mongo/database.js';
import { foodSchema } from '../backend/src/contracts.js';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { z } = require('zod');
const filename = process.argv[2];
if (!filename) throw new Error('Usage: node --env-file=backend/.env.migration.local scripts/import-foods.mjs <reviewed-catalog.json>');
const entries = z.array(z.object({ id: z.string().regex(/^[a-z0-9_-]{1,100}$/), food: foodSchema.omit({ id: true }), searchTerms: z.array(z.string().min(2).max(100)).min(1).max(50) }).strict()).max(10000).parse(JSON.parse(await readFile(filename, 'utf8')));
const database = await connectDatabase({uri:process.env.MONGODB_URI,database:process.env.MONGODB_DB_NAME});
try { for (const {id,...value} of entries) await database.db.collection('foods').updateOne({id},{$set:value},{upsert:true}); console.log('Reviewed catalog imported into MongoDB.'); }
finally { await database.close(); }
