import { getDb } from './server/db';
import { agentSignals } from './drizzle/schema';
import { desc, eq } from 'drizzle-orm';

async function checkOrderFlowSignals() {
  const db = await getDb();
  if (!db) {
    console.log('Database not available');
    return;
  }
  
  // Get last 20 OrderFlowAnalyst signals
  const signals = await db.select()
    .from(agentSignals)
    .where(eq(agentSignals.agentName, 'OrderFlowAnalyst'))
    .orderBy(desc(agentSignals.timestamp))
    .limit(20);
  
  console.log(`\nRecent OrderFlowAnalyst signals: ${signals.length}\n`);
  
  if (signals.length === 0) {
    console.log('❌ NO SIGNALS FOUND - OrderFlowAnalyst is not generating signals!\n');
  } else {
    signals.forEach(s => {
      console.log(`- ${new Date(s.timestamp).toISOString()}: ${s.signal} (confidence: ${s.confidence?.toFixed(2)})`);
    });
  }
  
  // Get all agent signals from last hour for comparison
  const oneHourAgo = Date.now() - 3600000;
  const allRecentSignals = await db.select()
    .from(agentSignals)
    .where(eq(agentSignals.symbol, 'BTC-USD'))
    .orderBy(desc(agentSignals.timestamp))
    .limit(100);
  
  const signalsByAgent = new Map<string, number>();
  allRecentSignals.forEach(s => {
    signalsByAgent.set(s.agentName, (signalsByAgent.get(s.agentName) || 0) + 1);
  });
  
  console.log('\n\nSignal counts by agent (last 100 signals):');
  Array.from(signalsByAgent.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([agent, count]) => {
      console.log(`  ${agent}: ${count}`);
    });
}

checkOrderFlowSignals().catch(console.error);
