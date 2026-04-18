import { getDb } from './server/db';
import { winningPatterns } from './drizzle/schema';
import { eq } from 'drizzle-orm';

const db = await getDb();
if (!db) {
  console.log('Database not available');
  process.exit(1);
}

console.log('Fixing confidence scores in database...\n');

// Get all patterns
const patterns = await db.select().from(winningPatterns);
console.log(`Found ${patterns.length} patterns`);

// Fix each pattern's confidence score
for (const pattern of patterns) {
  if (pattern.confidenceScore !== null) {
    let newConfidence: number;
    
    // If value is very small (already converted incorrectly), multiply back and re-convert
    if (pattern.confidenceScore < 0.01) {
      // Was divided by 10000, so multiply back to get original
      const original = pattern.confidenceScore * 10000;
      newConfidence = original / 100; // Now divide by 100 to get 0-1 range
    } else if (pattern.confidenceScore > 1) {
      // Still in percentage form (0-100), convert to decimal
      newConfidence = pattern.confidenceScore / 100;
    } else {
      // Already in correct range
      newConfidence = pattern.confidenceScore;
    }
    
    // Ensure it's in valid range
    newConfidence = Math.max(0.05, Math.min(0.95, newConfidence));
    
    await db
      .update(winningPatterns)
      .set({ confidenceScore: newConfidence })
      .where(eq(winningPatterns.id, pattern.id));
    
    console.log(`✅ Fixed ${pattern.patternName} (${pattern.timeframe}): ${pattern.confidenceScore} → ${newConfidence.toFixed(4)}`);
  }
}

console.log('\n✅ All confidence scores fixed!');

// Verify the fix
const updatedPatterns = await db.select().from(winningPatterns);
console.log('\nVerification:');
updatedPatterns.forEach(p => {
  console.log(`- ${p.patternName} (${p.timeframe}): WR=${(p.winRate * 100).toFixed(1)}%, Conf=${p.confidenceScore ? (p.confidenceScore * 100).toFixed(1) : 'N/A'}%`);
});

process.exit(0);
