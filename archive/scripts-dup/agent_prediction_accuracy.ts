import mysql from 'mysql2/promise';

interface AgentStats {
  name: string;
  totalSignals: number;
  bullish: number;
  bearish: number;
  neutral: number;
  avgBullishConf: number;
  avgBearishConf: number;
  bullishRatio: number;
  bearishRatio: number;
}

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  
  console.log("=== AGENT PREDICTION ACCURACY ANALYSIS ===\n");
  
  // Get signal distribution for all agents
  const [allSignals] = await connection.execute(`
    SELECT 
      agentName,
      signalType,
      COUNT(*) as count,
      AVG(CAST(confidence AS DECIMAL(10,4))) as avgConfidence,
      AVG(executionScore) as avgExecutionScore
    FROM agentSignals 
    GROUP BY agentName, signalType
    ORDER BY agentName, signalType
  `);
  
  // Process into agent stats
  const agentMap = new Map<string, AgentStats>();
  
  for (const row of allSignals as any[]) {
    const name = row.agentName;
    if (!agentMap.has(name)) {
      agentMap.set(name, {
        name,
        totalSignals: 0,
        bullish: 0,
        bearish: 0,
        neutral: 0,
        avgBullishConf: 0,
        avgBearishConf: 0,
        bullishRatio: 0,
        bearishRatio: 0
      });
    }
    
    const stats = agentMap.get(name)!;
    const count = parseInt(row.count);
    stats.totalSignals += count;
    
    if (row.signalType === 'bullish') {
      stats.bullish = count;
      stats.avgBullishConf = parseFloat(row.avgConfidence);
    } else if (row.signalType === 'bearish') {
      stats.bearish = count;
      stats.avgBearishConf = parseFloat(row.avgConfidence);
    } else {
      stats.neutral = count;
    }
  }
  
  // Calculate ratios
  for (const stats of agentMap.values()) {
    const directional = stats.bullish + stats.bearish;
    if (directional > 0) {
      stats.bullishRatio = stats.bullish / directional;
      stats.bearishRatio = stats.bearish / directional;
    }
  }
  
  // Print agent summary table
  console.log("=== AGENT SIGNAL SUMMARY ===\n");
  console.log("| Agent | Total | Bullish | Bearish | Neutral | Bull% | Bear% | AvgBullConf | AvgBearConf |");
  console.log("|-------|-------|---------|---------|---------|-------|-------|-------------|-------------|");
  
  const sortedAgents = Array.from(agentMap.values()).sort((a, b) => b.totalSignals - a.totalSignals);
  
  for (const stats of sortedAgents) {
    console.log(`| ${stats.name.padEnd(20)} | ${stats.totalSignals.toString().padStart(7)} | ${stats.bullish.toString().padStart(7)} | ${stats.bearish.toString().padStart(7)} | ${stats.neutral.toString().padStart(7)} | ${(stats.bullishRatio * 100).toFixed(1).padStart(5)}% | ${(stats.bearishRatio * 100).toFixed(1).padStart(5)}% | ${stats.avgBullishConf.toFixed(3).padStart(11)} | ${stats.avgBearishConf.toFixed(3).padStart(11)} |`);
  }
  
  // KEY INSIGHT: Check if agents are giving CONFLICTING signals at the same time
  console.log("\n\n=== AGENT CONFLICT ANALYSIS ===\n");
  console.log("Checking if agents disagree at the same timestamp...\n");
  
  const [conflicts] = await connection.execute(`
    SELECT 
      a1.timestamp,
      a1.agentName as agent1,
      a1.signalType as signal1,
      a2.agentName as agent2,
      a2.signalType as signal2
    FROM agentSignals a1
    JOIN agentSignals a2 ON a1.timestamp = a2.timestamp 
      AND a1.agentName < a2.agentName
      AND JSON_EXTRACT(a1.signalData, '$.symbol') = JSON_EXTRACT(a2.signalData, '$.symbol')
    WHERE a1.signalType != a2.signalType 
      AND a1.signalType != 'neutral' 
      AND a2.signalType != 'neutral'
    ORDER BY a1.timestamp DESC
    LIMIT 20
  `);
  
  console.log("Recent agent conflicts (bullish vs bearish at same time):");
  console.log(JSON.stringify(conflicts, null, 2));
  
  // Count total conflicts
  const [conflictCount] = await connection.execute(`
    SELECT COUNT(*) as count
    FROM agentSignals a1
    JOIN agentSignals a2 ON a1.timestamp = a2.timestamp 
      AND a1.agentName < a2.agentName
      AND JSON_EXTRACT(a1.signalData, '$.symbol') = JSON_EXTRACT(a2.signalData, '$.symbol')
    WHERE a1.signalType != a2.signalType 
      AND a1.signalType != 'neutral' 
      AND a2.signalType != 'neutral'
  `);
  
  console.log("\nTotal agent conflicts:", (conflictCount as any[])[0].count);
  
  // Check agentAccuracy table for historical accuracy
  console.log("\n\n=== HISTORICAL AGENT ACCURACY ===\n");
  
  try {
    const [accuracy] = await connection.execute(`
      SELECT * FROM agentAccuracy ORDER BY accuracy DESC
    `);
    console.log("agentAccuracy table:");
    console.log(JSON.stringify(accuracy, null, 2));
  } catch (e) {
    console.log("agentAccuracy table not available or empty");
  }
  
  // Check agentPerformance table
  try {
    const [perf] = await connection.execute(`
      SELECT agentName, 
             COUNT(*) as entries,
             AVG(CAST(accuracy AS DECIMAL(10,4))) as avgAccuracy,
             AVG(profitContribution) as avgProfitContribution
      FROM agentPerformance 
      GROUP BY agentName
      ORDER BY avgAccuracy DESC
    `);
    console.log("\nagentPerformance summary:");
    console.log(JSON.stringify(perf, null, 2));
  } catch (e) {
    console.log("agentPerformance table not available or empty:", (e as Error).message);
  }
  
  await connection.end();
}

main().catch(console.error);
