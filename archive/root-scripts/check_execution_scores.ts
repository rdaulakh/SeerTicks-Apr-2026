import { drizzle } from "drizzle-orm/mysql2";
import { desc } from "drizzle-orm";
import { agentSignals } from "./drizzle/schema.js";

const db = drizzle(process.env.DATABASE_URL!);

console.log("=== Checking Recent Agent Signals for Execution Scores ===\n");

const signals = await db
  .select()
  .from(agentSignals)
  .orderBy(desc(agentSignals.timestamp))
  .limit(20);

if (signals.length === 0) {
  console.log("❌ No signals found in database");
} else {
  console.log(`Found ${signals.length} recent signals:\n`);
  
  for (const signal of signals) {
    const data = typeof signal.signalData === 'string' 
      ? JSON.parse(signal.signalData) 
      : signal.signalData;
    
    const executionScore = data?.executionScore ?? 'undefined';
    const confidence = data?.confidence ?? 'undefined';
    
    console.log(`${signal.agentName} (${signal.symbol})`);
    console.log(`  Time: ${signal.timestamp.toISOString()}`);
    console.log(`  Signal: ${data?.signal ?? 'unknown'}`);
    console.log(`  Confidence: ${confidence}${typeof confidence === 'number' ? '%' : ''}`);
    console.log(`  Execution Score: ${executionScore}${typeof executionScore === 'number' ? '/100' : ''}`);
    console.log('');
  }
}

process.exit(0);
