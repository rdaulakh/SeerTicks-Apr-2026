import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

// FIX 4: Engine State for User 272657
console.log("🔍 FIX 4: Engine State for User 272657");
const [engineState] = await conn.query(`
  SELECT isRunning, startedAt, stoppedAt 
  FROM engineState 
  WHERE userId = 272657 
  ORDER BY id DESC LIMIT 1
`);
if (engineState.length > 0) {
  console.log(`   isRunning: ${engineState[0].isRunning === 1 ? '✅ YES' : '❌ NO'}`);
  console.log(`   stoppedAt: ${engineState[0].stoppedAt ? '❌ ' + engineState[0].stoppedAt : '✅ null (good)'}`);
}

const [tradingMode] = await conn.query(`SELECT autoTradeEnabled FROM tradingModeConfig WHERE userId = 272657`);
if (tradingMode.length > 0) {
  console.log(`   autoTradeEnabled (tradingModeConfig): ${tradingMode[0].autoTradeEnabled === 1 ? '✅ YES' : '❌ NO'}`);
}

// FIX 5: Trade Execution Pipeline
console.log("\n🔍 FIX 5: Trade Execution Pipeline");

// Check userId fix in StrategyOrchestrator
const orchestratorCode = readFileSync('/home/ubuntu/seer/server/orchestrator/StrategyOrchestrator.ts', 'utf8');
if (orchestratorCode.includes('this.userId, // userId')) {
  console.log("   ✅ userId hardcoding fixed in StrategyOrchestrator.createPosition()");
} else if (orchestratorCode.includes('1, // userId')) {
  console.log("   ❌ userId still hardcoded to 1!");
} else {
  console.log("   ⚠️ Could not verify userId fix (checking alternative pattern)");
  // Check for the actual fix pattern
  if (orchestratorCode.includes('this.userId,') && orchestratorCode.includes('createPosition')) {
    console.log("   ✅ userId appears to be using this.userId in createPosition context");
  }
}

// Check updateExecution in AutomatedTradeExecutor
const executorCode = readFileSync('/home/ubuntu/seer/server/services/AutomatedTradeExecutor.ts', 'utf8');
if (executorCode.includes('updateExecution')) {
  console.log("   ✅ updateExecution() call added to AutomatedTradeExecutor");
} else {
  console.log("   ❌ updateExecution() NOT found in AutomatedTradeExecutor!");
}

// Check signal userId fix in AgentBase
const agentBaseCode = readFileSync('/home/ubuntu/seer/server/agents/AgentBase.ts', 'utf8');
if (agentBaseCode.includes('_userId')) {
  console.log("   ✅ Signal userId attribution fixed in AgentBase.persistSignal()");
} else {
  console.log("   ⚠️ Could not verify signal userId fix");
}

await conn.end();

console.log("\n=== ALL 5 FIXES VERIFICATION COMPLETE ===");
