import { getDb } from './server/db';
import { agentSignals } from './drizzle/schema';
import { eq, desc } from 'drizzle-orm';

async function testPatternSignals() {
  console.log('=== PATTERN MATCHER SIGNAL VERIFICATION ===\n');
  
  const db = await getDb();
  if (!db) {
    console.error('❌ Database not available');
    process.exit(1);
  }

  // Get recent PatternMatcher signals
  const signals = await db
    .select()
    .from(agentSignals)
    .where(eq(agentSignals.agentName, 'PatternMatcher'))
    .orderBy(desc(agentSignals.timestamp))
    .limit(10);

  console.log(`Found ${signals.length} PatternMatcher signals\n`);

  if (signals.length === 0) {
    console.warn('⚠️  No signals found yet. The agent may need more time to generate signals.');
    console.log('This is normal if the engine just started.');
  } else {
    console.log('✅ PatternMatcher is generating signals!\n');
    console.log('Recent signals:');
    signals.forEach((s, i) => {
      const data = s.signalData as any;
      console.log(`\n${i + 1}. Signal at ${new Date(s.timestamp).toISOString()}`);
      console.log(`   Direction: ${data.signal || 'N/A'}`);
      console.log(`   Confidence: ${((data.confidence || 0) * 100).toFixed(1)}%`);
      console.log(`   Execution Score: ${data.executionScore || 'N/A'}/100`);
      console.log(`   Quality Score: ${((data.qualityScore || 0) * 100).toFixed(1)}%`);
      if (data.evidence) {
        console.log(`   Pattern: ${data.evidence.matchedPattern || 'N/A'}`);
        console.log(`   Timeframe: ${data.evidence.timeframe || 'N/A'}`);
        console.log(`   Validated: ${data.evidence.validated ? 'Yes' : 'No'}`);
      }
    });
  }

  console.log('\n=== VERIFICATION COMPLETE ===');
  process.exit(0);
}

testPatternSignals();
