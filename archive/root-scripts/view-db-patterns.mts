import { drizzle } from 'drizzle-orm/mysql2';
import { winningPatterns } from './drizzle/schema.ts';

(async () => {
  const db = drizzle(process.env.DATABASE_URL!);
  const patterns = await db.select().from(winningPatterns);

  console.log('=== Database Patterns ===\n');
  console.log(`Total patterns: ${patterns.length}\n`);

  patterns.forEach((p, i) => {
    console.log(`${i + 1}. ${p.patternName} (${p.timeframe})`);
    console.log(`   Win Rate: ${(p.winRate * 100).toFixed(1)}%`);
    console.log(`   Confidence: ${(p.confidenceScore * 100).toFixed(1)}%`);
    console.log('');
  });

  process.exit(0);
})();
