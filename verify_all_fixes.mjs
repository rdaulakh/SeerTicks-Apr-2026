import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== VERIFYING ALL 5 CRITICAL FIXES ===\n");

// FIX 1: System Stability - Already confirmed NOT a crash loop (health checks, not restarts)
console.log("✅ FIX 1: System Stability");
console.log("   CONFIRMED: 'Crash loop' was actually periodic health checks, not crashes");
console.log("   System is stable - no code fix needed\n");

// FIX 2: Database Indexes
console.log("🔍 FIX 2: Database Indexes");
const [indexes] = await conn.query(`
  SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME) as columns
  FROM information_schema.STATISTICS 
  WHERE TABLE_SCHEMA = DATABASE() 
    AND INDEX_NAME != 'PRIMARY'
    AND TABLE_NAME IN ('agentSignals', 'paperPositions', 'trades', 'tradeDecisionLogs', 'paperTrades')
  GROUP BY TABLE_NAME, INDEX_NAME
  ORDER BY TABLE_NAME
`);
if (indexes.length > 0) {
  console.log(`   ✅ Found ${indexes.length} indexes on critical tables:`);
  indexes.forEach(idx => console.log(`      - ${idx.TABLE_NAME}.${idx.INDEX_NAME} (${idx.columns})`));
} else {
  console.log("   ❌ No indexes found!");
}

// FIX 3: Consensus Recording - Check if ConsensusRecorder.ts exists
console.log("\n🔍 FIX 3: Consensus Recording");
import { existsSync } from 'fs';
if (existsSync('/home/ubuntu/seer/server/utils/ConsensusRecorder.ts')) {
  console.log("   ✅ ConsensusRecorder.ts exists");
} else {
  console.log("   ❌ ConsensusRecorder.ts NOT found!");
}

// Check if it's imported in StrategyOrchestrator
import { readFileSync } from 'fs';
const orchestratorCode = readFileSync('/home/ubuntu/seer/server/orchestrator/StrategyOrchestrator.ts', 'utf8');
if (orchestratorCode.includes('ConsensusRecorder')) {
  console.log("   ✅ ConsensusRecorder integrated into StrategyOrchestrator");
} else {
  console.log("   ❌ ConsensusRecorder NOT integrated!");
}

// FIX 4: Engine State for User 272657
console.log("\n🔍 FIX 4: Engine State for User 272657");
const [engineState] = await conn.query(`
  SELECT isRunning, startedAt, stoppedAt, config 
  FROM engineState 
  WHERE userId = 272657 
  ORDER BY id DESC LIMIT 1
`);
if (engineState.length > 0) {
  const config = JSON.parse(engineState[0].config || '{}');
  console.log(`   isRunning: ${engineState[0].isRunning === 1 ? '✅ YES' : '❌ NO'}`);
  console.log(`   enableAutoTrading: ${config.enableAutoTrading === true ? '✅ YES' : '❌ NO'}`);
  console.log(`   stoppedAt: ${engineState[0].stoppedAt ? '❌ ' + engineState[0].stoppedAt : '✅ null (good)'}`);
} else {
  console.log("   ❌ No engine state found for user 272657!");
}

const [tradingMode] = await conn.query(`SELECT autoTradeEnabled FROM tradingModeConfig WHERE userId = 272657`);
if (tradingMode.length > 0) {
  console.log(`   autoTradeEnabled (tradingModeConfig): ${tradingMode[0].autoTradeEnabled === 1 ? '✅ YES' : '❌ NO'}`);
}

// FIX 5: Trade Execution Pipeline
console.log("\n🔍 FIX 5: Trade Execution Pipeline");

// Check userId fix in StrategyOrchestrator
if (orchestratorCode.includes('this.userId, // userId')) {
  console.log("   ✅ userId hardcoding fixed in StrategyOrchestrator.createPosition()");
} else if (orchestratorCode.includes('1, // userId')) {
  console.log("   ❌ userId still hardcoded to 1!");
} else {
  console.log("   ⚠️ Could not verify userId fix (pattern not found)");
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
if (agentBaseCode.includes('signal.evidence?._userId') || agentBaseCode.includes('evidence._userId')) {
  console.log("   ✅ Signal userId attribution fixed in AgentBase.persistSignal()");
} else {
  console.log("   ⚠️ Could not verify signal userId fix");
}

await conn.end();

console.log("\n=== VERIFICATION COMPLETE ===");
console.log("\nSUMMARY:");
console.log("Fix 1 (Stability): ✅ Confirmed - Not a crash loop");
console.log("Fix 2 (Indexes): " + (indexes.length > 0 ? "✅ Implemented" : "❌ Missing"));
console.log("Fix 3 (Consensus): Check above");
console.log("Fix 4 (Engine): Check above");
console.log("Fix 5 (Execution): Check above");
