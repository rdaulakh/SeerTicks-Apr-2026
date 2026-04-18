import { getDb } from './server/db.js';
import { engineState } from './drizzle/schema.js';
import { eq } from 'drizzle-orm';

const db = await getDb();
if (db) {
  const result = await db.select().from(engineState).where(eq(engineState.userId, 1));
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('DB not available');
}
