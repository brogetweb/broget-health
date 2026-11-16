import { z } from 'zod';
import { dateRangeSchema, mealSchema, totalMeals } from './contracts.js';
import { localDateKey, addDays, reportRangeSchema } from './calendar.js';
import { calculateTarget } from './nutrition_target.js';
import { compactReport } from './compact_report.js';
import { StoreError } from './mongo/errors.js';
export { calculateTarget } from './nutrition_target.js';

export function assistantTools(database, meals, users, nutrition) {
  const { db } = database;
  async function context(userId, range) {
    const user = await users.get(userId);
    const state = await db.collection('reportState').findOne({ userId });
    const zone = state?.timeZone ?? 'UTC', today = localDateKey(new Date(), zone);
    const report = await meals.report(userId, today, addDays(today, 1));
    const history = await db.collection('chatMessages').find({ userId, verified: true, requestPending: { $ne: true } })
      .sort({ createdAt: -1, id: -1 }).limit(12).toArray();
    const notes = await db.collection('assistantMemory').findOne({ userId });
    const reminders = await db.collection('notifications').find({ userId }).sort({ createdAt: -1 }).limit(5).toArray();
    const events = await db.collection('engagementEvents').find({ userId }).sort({ createdAt: -1 }).limit(8).toArray();
    const recent = await db.collection('meals').find({ userId, localDate: today }).sort({ eatenAt: -1 }).limit(12).toArray();
    const value = { localDay: range, target: calculateTarget(user.health), dailyNutrition: report.totals,
      reportingDate: today, reportingTimeZone: zone,
      recentWeek: compactReport(await meals.report(userId, addDays(today, -6), addDays(today, 1))),
      memory: { userConfirmedNotes: notes?.notes ?? '',
        recentMessages: history.reverse().map(m => ({ role: m.role, text: m.text.slice(0, 800) })),
        recentReminders: reminders.map(r => ({ date: r.date, kind: r.kind, status: r.status, pushStatus: r.pushStatus,
          interpretation: 'Completed means user acknowledgment, not measured activity.' })),
        recentActivityEvents: events.map(e => ({ type: e.type, recordedAt: e.createdAt.toISOString() })) },
      meals: recent.map(m => ({ id: m.id, mealType: m.mealType, eatenAt: m.eatenAt,
        foods: m.foods.map(f => ({ name: f.food.name, grams: f.grams, source: f.source })) })),
      preferences: user.health ? { goal: user.health.goal, activity: user.health.activity, diet: user.health.diet,
        allergies: user.health.allergies, restrictions: user.health.restrictions, specialCare: user.health.specialCare } : null,
      contextPolicy: 'Bounded recent context. Missing logs do not mean zero intake. Use authorized date tools for other records.' };
    while (JSON.stringify(value).length > 19500 && value.memory.recentMessages.length) value.memory.recentMessages.shift();
    while (JSON.stringify(value).length > 19500 && value.meals.length) value.meals.pop();
    if (JSON.stringify(value).length > 20000) throw new StoreError(422, 'context-too-large');
    return value;
  }
  async function execute(userId, tool, range) {
    const args = tool.arguments;
    switch (tool.name) {
      case 'getUserProfile': {
        z.object({}).strict().parse(args); const h = (await users.get(userId)).health;
        return { profile: h ? { diet: h.diet, allergies: h.allergies, restrictions: h.restrictions, goal: h.goal, specialCare: h.specialCare } : null };
      }
      case 'getDailyTarget': case 'getDailyNutrition': {
        z.object({}).strict().parse(args); const c = await context(userId, range);
        return tool.name === 'getDailyTarget' ? c.target : c.dailyNutrition;
      }
      case 'getNutritionForDate': case 'getMealHistory': {
        if ('startDate' in args) {
          const dates = reportRangeSchema.parse(args);
          if ((Date.parse(dates.endDate) - Date.parse(dates.startDate)) / 86400000 > 32) throw new StoreError(400, 'invalid-input');
          const report = await meals.report(userId, dates.startDate, dates.endDate);
          if (tool.name === 'getNutritionForDate') return compactReport(report);
          const rows = await db.collection('meals').find({ userId, localDate: { $gte: dates.startDate, $lt: dates.endDate } })
            .sort({ localDate: 1, id: 1 }).limit(21).toArray();
          return { range: dates, totals: report.totals, truncated: rows.length > 20,
            meals: rows.slice(0, 20).map(m => ({ id: m.id, mealType: m.mealType, localDate: m.localDate,
              foods: m.foods.slice(0, 6).map(f => ({ name: f.food.name.slice(0, 80), grams: f.grams })) })) };
        }
        const dates = dateRangeSchema.parse(args), rows = await meals.range(userId, dates.start, dates.end);
        return { range: dates, totals: totalMeals(rows), truncated: rows.length > 20,
          meals: rows.slice(-20).map(m => ({ id: m.id, mealType: m.mealType, eatenAt: m.eatenAt,
            foods: m.foods.slice(0, 6).map(f => ({ name: f.food.name.slice(0, 80), grams: f.grams })) })) };
      }
      case 'getConversationHistory': {
        const dates = dateRangeSchema.parse(args);
        const rows = await db.collection('chatMessages').find({ userId, verified: true, requestPending: { $ne: true },
          createdAt: { $gte: new Date(dates.start), $lt: new Date(dates.end) } })
          .sort({ createdAt: -1, id: -1 }).limit(21).toArray();
        return { truncated: rows.length > 20, messages: rows.slice(0, 20).reverse().map(m => ({ role: m.role, text: m.text.slice(0, 800), date: m.createdAt })) };
      }
      case 'getWeeklySummary': case 'getMonthlySummary': case 'getYearlySummary': {
        let dates;
        if ('startDate' in args) dates = reportRangeSchema.parse(args);
        else {
          const iso = dateRangeSchema.parse(args), state = await db.collection('reportState').findOne({ userId });
          dates = { startDate: localDateKey(iso.start, state?.timeZone ?? 'UTC'), endDate: localDateKey(iso.end, state?.timeZone ?? 'UTC') };
        }
        return compactReport(await meals.report(userId, dates.startDate, dates.endDate));
      }
      case 'searchFood': return { foods: await nutrition.search(z.object({ query: z.string().trim().min(2).max(100) }).strict().parse(args).query) };
      case 'addMeal': case 'updateMeal': {
        const { meal } = z.object({ meal: mealSchema }).strict().parse(args);
        if (tool.name === 'updateMeal' && !await db.collection('meals').findOne({ userId, id: meal.id })) throw new StoreError(404, 'meal-not-found');
        return { requiresUserConfirmation: true, action: tool.name, meal };
      }
      case 'deleteMeal': {
        const { id } = z.object({ id: z.string().uuid() }).strict().parse(args);
        if (!await db.collection('meals').findOne({ userId, id })) throw new StoreError(404, 'meal-not-found');
        return { requiresUserConfirmation: true, action: 'deleteMeal', id };
      }
      default: throw new StoreError(400, 'invalid-tool');
    }
  }
  return { context, execute };
}
