import { foodSchema } from './contracts.js';
import { StoreError } from './mongo/errors.js';
import { createHash } from 'node:crypto';

export function mapUsdaFood(row) {
  const find = id => { const n = row.foodNutrients?.find(n => n.nutrientId === id); return typeof n?.value === 'number' ? n.value : null; };
  const calories = find(1008), protein = find(1003), carbs = find(1005), fat = find(1004);
  if ([calories, protein, carbs, fat].some(n => n === null)) return null;
  return foodSchema.parse({ id: `usda:${row.fdcId}`, name: row.description.slice(0, 160),
    per100g: { calories, protein, carbs, fat, fiber: find(1079) },
    attribution: `USDA FoodData Central / ${row.dataType} / FDC ${row.fdcId}` });
}

export function nutritionStore(database, { key = process.env.USDA_API_KEY, fetchImpl = fetch } = {}) {
  const { db } = database;
  return {
    async search(query) {
      const normalized = query.trim().toLowerCase();
      const rows = await db.collection('foods').find({ searchTerms: normalized }).limit(12).toArray();
      const catalog = rows.map(row => foodSchema.parse({ ...row.food, id: `catalog:${row.id}` }));
      if (!key) { if (catalog.length) return catalog; throw new StoreError(503, 'nutrition-not-configured'); }
      const id = createHash('sha256').update(normalized).digest('hex');
      const cached = await db.collection('nutritionCache').findOne({ id, expiresAt: { $gt: new Date() } });
      if (cached) return [...catalog, ...cached.foods].slice(0, 20);
      let foods;
      try {
        const response = await fetchImpl('https://api.nal.usda.gov/fdc/v1/foods/search', {
          method: 'POST', headers: { 'content-type': 'application/json', 'X-Api-Key': key },
          body: JSON.stringify({ query: normalized, pageSize: 15, dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)'] }),
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) throw new Error();
        const body = await response.json();
        foods = (body.foods ?? []).flatMap(row => { try { const food = mapUsdaFood(row); return food ? [food] : []; } catch { return []; } });
      } catch { throw new StoreError(503, 'nutrition-unavailable'); }
      await database.transaction(async (db, session) => {
        for (const food of foods) await db.collection('nutritionFoods').updateOne({ id: food.id }, { $set: { food } }, { upsert: true, session });
        await db.collection('nutritionCache').updateOne({ id }, { $set: { foods, expiresAt: new Date(Date.now() + 86400000) } }, { upsert: true, session });
      });
      return [...catalog, ...foods].slice(0, 20);
    },
  };
}
