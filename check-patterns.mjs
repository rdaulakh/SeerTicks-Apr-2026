import { drizzle } from 'drizzle-orm/mysql2';
import { winningPatterns } from './drizzle/schema.ts';
import 'dotenv/config';

async function checkPatterns() {
  const db = drizzle(process.env.DATABASE_URL);
  const patterns = await db.select().from(winningPatterns);
  
  console.log('=== Pattern Database Status ===');
  console.log('Total patterns:', patterns.length);
  
  const byTimeframe = patterns.reduce((acc, p) => {
    acc[p.timeframe] = (acc[p.timeframe] || 0) + 1;
    return acc;
  }, {});
  
  console.log('\nPatterns by timeframe:');
  Object.entries(byTimeframe).forEach(([tf, count]) => {
    console.log(`  ${tf}: ${count} patterns`);
  });
  
  console.log('\nAll patterns:');
  patterns.forEach(p => {
    console.log(`  - ${p.patternName} (${p.timeframe}, WR=${(p.winRate * 100).toFixed(1)}%, Conf=${(p.confidenceScore * 100).toFixed(1)}%)`);
  });
  
  console.log('\n=== Pattern Detection Issue Analysis ===');
  
  // Check for patterns with winRate >= 50%
  const validPatterns = patterns.filter(p => p.winRate >= 0.50);
  console.log(`\nPatterns with winRate >= 50%: ${validPatterns.length}`);
  
  if (validPatterns.length === 0) {
    console.log('⚠️  WARNING: No patterns meet the 50% win rate threshold!');
    console.log('   This will cause PatternMatcher to always use fallback mode.');
  }
  
  // Check pattern variety
  const uniqueNames = new Set(patterns.map(p => p.patternName));
  console.log(`\nUnique pattern types: ${uniqueNames.size}`);
  console.log('Pattern types:', Array.from(uniqueNames).join(', '));
  
  if (uniqueNames.size < 5) {
    console.log('⚠️  WARNING: Limited pattern variety. Consider adding more pattern types.');
  }
  
  process.exit(0);
}

checkPatterns().catch(console.error);
