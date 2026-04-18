import { getDb } from './server/db';
import { winningPatterns } from './drizzle/schema';

const db = await getDb();
if (!db) {
  console.log('Database not available');
  process.exit(1);
}

const patterns = await db.select().from(winningPatterns);
console.log('Total patterns in database:', patterns.length);
console.log('Patterns with winRate >= 0.50:', patterns.filter(p => p.winRate >= 0.50).length);
console.log('Patterns with winRate >= 0.55:', patterns.filter(p => p.winRate >= 0.55).length);
console.log('\nPattern breakdown:');
patterns.forEach(p => {
  console.log(`- ${p.patternName} (${p.timeframe}): WR=${(p.winRate * 100).toFixed(1)}%, Conf=${p.confidenceScore ? (p.confidenceScore * 100).toFixed(1) : 'N/A'}%`);
});
