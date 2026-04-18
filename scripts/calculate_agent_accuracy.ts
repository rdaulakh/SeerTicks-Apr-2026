import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

interface AgentAccuracy {
  agentName: string;
  totalSignals: number;
  bullishSignals: number;
  bearishSignals: number;
  neutralSignals: number;
  correctPredictions: number;
  incorrectPredictions: number;
  accuracy: number;
  avgConfidence: number;
}

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  
  console.log("=== AGENT-BY-AGENT ACCURACY CALCULATION ===\n");
  
  // Get tick data structure
  const [tickSample] = await connection.execute(
    "SELECT * FROM ticks ORDER BY timestampMs DESC LIMIT 1"
  );
  console.log("Sample tick:", JSON.stringify(tickSample, null, 2));
  
  // Get tick count
  const [tickCount] = await connection.execute("SELECT COUNT(*) as count FROM ticks");
  console.log("\nTotal ticks:", (tickCount as any[])[0].count);
  
  // Get paperPositions structure
  const [posColumns] = await connection.execute("DESCRIBE paperPositions");
  console.log("\npaperPositions columns:");
  for (const col of posColumns as any[]) {
    console.log(`  - ${col.Field}: ${col.Type}`);
  }
  
  // Get closed positions with correct column names
  const [positions] = await connection.execute(`
    SELECT * FROM paperPositions 
    WHERE status = 'closed' 
    ORDER BY id DESC 
    LIMIT 5
  `);
  console.log("\nSample closed positions:", JSON.stringify(positions, null, 2));
  
  // For each agent, calculate accuracy by matching signals to price movements
  console.log("\n=== AGENT SIGNAL ANALYSIS ===\n");
  
  const agents = [
    'TechnicalAnalyst',
    'OrderFlowAnalyst', 
    'PatternMatcher',
    'OnChainFlowAnalyst',
    'VolumeProfileAnalyzer',
    'FundingRateAnalyst',
    'NewsSentinel',
    'LiquidationHeatmap',
    'SentimentAnalyst',
    'MacroAnalyst',
    'OnChainAnalyst',
    'WhaleTracker'
  ];
  
  for (const agent of agents) {
    // Get signal distribution for this agent
    const [signalDist] = await connection.execute(`
      SELECT 
        signalType,
        COUNT(*) as count,
        AVG(CAST(confidence AS DECIMAL(10,4))) as avgConfidence,
        AVG(executionScore) as avgExecutionScore
      FROM agentSignals 
      WHERE agentName = ?
      GROUP BY signalType
    `, [agent]);
    
    console.log(`\n${agent}:`);
    console.log("  Signal Distribution:", JSON.stringify(signalDist, null, 2));
    
    // Get recent signals with price context
    const [recentSignals] = await connection.execute(`
      SELECT 
        signalType,
        confidence,
        executionScore,
        timestamp,
        JSON_EXTRACT(signalData, '$.symbol') as symbol
      FROM agentSignals 
      WHERE agentName = ?
      ORDER BY timestamp DESC
      LIMIT 10
    `, [agent]);
    
    console.log("  Recent signals:", JSON.stringify(recentSignals, null, 2));
  }
  
  // Analyze which agents were active during winning vs losing trades
  console.log("\n=== AGENT PERFORMANCE DURING TRADES ===\n");
  
  // Get agentAccuracy table if it exists
  try {
    const [agentAccData] = await connection.execute(`
      SELECT * FROM agentAccuracy ORDER BY accuracy DESC LIMIT 20
    `);
    console.log("agentAccuracy table data:", JSON.stringify(agentAccData, null, 2));
  } catch (e) {
    console.log("agentAccuracy table error:", (e as Error).message);
  }
  
  // Get agentPerformance table if it exists
  try {
    const [agentPerfData] = await connection.execute(`
      SELECT * FROM agentPerformance ORDER BY id DESC LIMIT 20
    `);
    console.log("\nagentPerformance table data:", JSON.stringify(agentPerfData, null, 2));
  } catch (e) {
    console.log("agentPerformance table error:", (e as Error).message);
  }
  
  await connection.end();
}

main().catch(console.error);
