import { drizzle } from 'drizzle-orm/mysql2';
import { sql, desc, and, gte, eq } from 'drizzle-orm';

async function analyzeExecutionScores() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Get last 10 hours
  const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000);
  
  console.log('\n=== EXECUTION SCORE ANALYSIS ===\n');
  
  // Query trade decision logs with agent scores
  const decisions = await db.execute(sql`
    SELECT 
      id,
      symbol,
      decision,
      reason,
      totalConfidence,
      agentScores,
      createdAt
    FROM tradeDecisionLogs
    WHERE createdAt >= ${tenHoursAgo.toISOString()}
    ORDER BY createdAt DESC
    LIMIT 50
  `);
  
  console.log(`Found ${(decisions as any)[0]?.length || 0} trade decisions in last 10 hours\n`);
  
  // Analyze each decision
  let missedWithHighConfidence = 0;
  let executionScoreIssues: any[] = [];
  
  for (const decision of (decisions as any)[0] || []) {
    const agentScores = typeof decision.agentScores === 'string' 
      ? JSON.parse(decision.agentScores) 
      : decision.agentScores;
    
    if (decision.decision === 'SKIPPED' && agentScores) {
      // Check if any agent had high confidence but low execution score
      for (const agent of agentScores) {
        if (agent.confidence >= 60 && (agent.executionScore || 0) < 45) {
          executionScoreIssues.push({
            symbol: decision.symbol,
            agent: agent.name,
            confidence: agent.confidence,
            executionScore: agent.executionScore || 0,
            signal: agent.signal,
            reason: decision.reason,
            time: decision.createdAt
          });
        }
      }
      
      // Check if total confidence was high but trade was skipped
      if (decision.totalConfidence >= 60) {
        missedWithHighConfidence++;
      }
    }
    
    // Log each decision
    console.log(`[${decision.createdAt}] ${decision.symbol}`);
    console.log(`  Decision: ${decision.decision}`);
    console.log(`  Reason: ${decision.reason}`);
    console.log(`  Total Confidence: ${decision.totalConfidence?.toFixed(2)}%`);
    
    if (agentScores) {
      console.log('  Agent Scores:');
      for (const agent of agentScores) {
        const execScore = agent.executionScore !== undefined ? agent.executionScore : 'N/A';
        console.log(`    - ${agent.name}: ${agent.signal} (Conf: ${agent.confidence?.toFixed(1)}%, Exec: ${execScore})`);
      }
    }
    console.log('');
  }
  
  console.log('\n=== SUMMARY ===\n');
  console.log(`Trades missed with high confidence (>=60%): ${missedWithHighConfidence}`);
  console.log(`Execution score issues found: ${executionScoreIssues.length}`);
  
  if (executionScoreIssues.length > 0) {
    console.log('\n=== EXECUTION SCORE ISSUES ===\n');
    for (const issue of executionScoreIssues.slice(0, 10)) {
      console.log(`${issue.symbol} - ${issue.agent}`);
      console.log(`  Confidence: ${issue.confidence}% (HIGH)`);
      console.log(`  Execution Score: ${issue.executionScore} (LOW - below 45 threshold)`);
      console.log(`  Signal: ${issue.signal}`);
      console.log(`  Skip Reason: ${issue.reason}`);
      console.log('');
    }
  }
  
  process.exit(0);
}

analyzeExecutionScores().catch(console.error);
