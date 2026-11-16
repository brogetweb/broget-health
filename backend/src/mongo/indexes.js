// Explicit server-owned collection names. No request may select a collection.
export const userCollections = Object.freeze([
  'meals', 'chatMessages', 'chatTurns', 'dailySummaries', 'summaryContributions',
  'reportState', 'preferences', 'assistantMemory', 'notifications',
  'engagementEvents', 'reportNarratives', 'analyses', 'scanFoods', 'mediaAssets',
]);

const unique = (key, name) => ({ key, name, unique: true });
const expiry = { key: { expiresAt: 1 }, name: 'expires_at', expireAfterSeconds: 0 };
export const indexes = Object.freeze({
  users: [unique({ userId: 1 }, 'user_identity')],
  meals: [unique({ userId: 1, id: 1 }, 'user_meal'),
    { key: { userId: 1, eatenAt: -1, id: -1 }, name: 'user_meal_time' },
    { key: { userId: 1, localDate: 1, id: 1 }, name: 'user_meal_date' }],
  chatMessages: [unique({ userId: 1, id: 1 }, 'user_message'),
    { key: { userId: 1, createdAt: -1, id: -1 }, name: 'user_message_time' }],
  chatTurns: [unique({ userId: 1, id: 1 }, 'user_request')],
  dailySummaries: [unique({ userId: 1, date: 1 }, 'user_day')],
  summaryContributions: [unique({ userId: 1, id: 1 }, 'user_contribution')],
  reportState: [unique({ userId: 1 }, 'user_report_state')],
  preferences: [unique({ userId: 1, id: 1 }, 'user_preferences')],
  assistantMemory: [unique({ userId: 1 }, 'user_memory')],
  notifications: [unique({ userId: 1, id: 1 }, 'user_reminder'),
    { key: { userId: 1, createdAt: -1, id: -1 }, name: 'user_reminder_time' }],
  engagementEvents: [unique({ userId: 1, id: 1 }, 'user_event'),
    { key: { userId: 1, createdAt: -1, id: -1 }, name: 'user_event_time' }],
  reportNarratives: [unique({ userId: 1, id: 1 }, 'user_narrative')],
  analyses: [unique({ userId: 1, id: 1 }, 'user_analysis'), expiry],
  scanFoods: [unique({ userId: 1, id: 1 }, 'user_scan_food')],
  mediaAssets: [unique({ userId: 1, id: 1 }, 'user_media'),
    unique({ publicId: 1 }, 'cloudinary_asset'),
    { key: { userId: 1, status: 1 }, name: 'user_media_status' }],
  foods: [unique({ id: 1 }, 'catalog_food'), { key: { searchTerms: 1 }, name: 'food_search' }],
  nutritionFoods: [unique({ id: 1 }, 'nutrition_food')],
  nutritionCache: [unique({ id: 1 }, 'nutrition_query'), expiry],
  quotas: [unique({ subject: 1, action: 1, window: 1 }, 'quota_window'), expiry],
  cleanupJobs: [unique({ id: 1 }, 'cleanup_job'),
    { key: { status: 1, nextAttemptAt: 1 }, name: 'cleanup_due' }],
});

export async function initializeCollections(db) {
  for (const [name, definitions] of Object.entries(indexes)) {
    // Every private record must have an owner even if a later repository has a bug.
    const validator = name === 'users' || userCollections.includes(name)
      ? { $jsonSchema: { bsonType: 'object', required: ['userId'],
        properties: { userId: { bsonType: 'string', minLength: 1, maxLength: 128 } } } }
      : undefined;
    try {
      await db.createCollection(name, validator ? { validator, validationLevel: 'strict', validationAction: 'error' } : {});
    } catch (error) {
      if (error.code !== 48) throw error; // NamespaceExists only.
      // Never silently weaken a validator when restarting against an existing DB.
      if (validator) await db.command({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
    }
    await db.collection(name).createIndexes(definitions);
  }
}
