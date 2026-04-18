import { getDb } from './server/db';
import { winningPatterns } from './drizzle/schema';
import { gte } from 'drizzle-orm';

async function checkPatterns() {
  const db = await getDb();
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }

  const patterns = await db.select().from(winningPatterns).where(gte(winningPatterns.winRate, 0.50));
  console.log('=== VALIDATED PATTERNS (winRate >= 50%) ===');
  console.log('Total:', patterns.length);
  
  if (patterns.length > 0) {
    console.log('\nTop 10 patterns:');
    patterns.slice(0, 10).forEach(p => {
      console.log(`  - ${p.patternName} (${p.timeframe}): WR=${(p.winRate * 100).toFixed(1)}%, Trades=${p.totalTrades}, PF=${p.profitFactor.toFixed(2)}`);
    });
  } else {
    console.warn('\n⚠️  NO VALIDATED PATTERNS FOUND!');
    console.warn('PatternMatcher will use fallback mode with reduced confidence.');
  }

  const allPatterns = await db.select().from(winningPatterns);
  console.log('\nTotal patterns in database:', allPatterns.length);
  
  if (allPatterns.length > 0) {
    console.log('\nAll patterns (any win rate):');
    allPatterns.forEach(p => {
      console.log(`  - ${p.patternName} (${p.timeframe}): WR=${(p.winRate * 100).toFixed(1)}%, Trades=${p.totalTrades}`);
    });
  }
  
  process.exit(0);
}

checkPatterns();
