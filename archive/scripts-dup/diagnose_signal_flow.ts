/**
 * Diagnostic: Simulate the signal processing pipeline to find where signals are blocked
 */
import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // 1. Get latest agent signals for each symbol
  const signalData = await db.execute(sql.raw(`
    SELECT agentName, symbol, signal, confidence, timestamp
    FROM agentSignalLog 
    WHERE timestamp > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
    ORDER BY timestamp DESC
  `));
  const signals = (signalData as any)[0] || [];
  
  // Group by symbol, take latest per agent
  const latestByAgent: Record<string, Record<string, any>> = {};
  for (const s of signals) {
    if (!latestByAgent[s.symbol]) latestByAgent[s.symbol] = {};
    if (!latestByAgent[s.symbol][s.agentName]) {
      latestByAgent[s.symbol][s.agentName] = s;
    }
  }
  
  console.log('=== LATEST SIGNALS PER AGENT ===');
  for (const [symbol, agents] of Object.entries(latestByAgent)) {
    console.log(`\n  ${symbol}:`);
    const agentList = Object.values(agents);
    const actionable = agentList.filter((a: any) => a.signal !== 'neutral');
    const bullish = agentList.filter((a: any) => a.signal === 'bullish');
    const bearish = agentList.filter((a: any) => a.signal === 'bearish');
    const neutral = agentList.filter((a: any) => a.signal === 'neutral');
    
    console.log(`    Total: ${agentList.length} | Actionable: ${actionable.length} | B:${bullish.length} Be:${bearish.length} N:${neutral.length}`);
    
    for (const a of agentList) {
      const conf = parseFloat(a.confidence || '0');
      const exec = parseFloat(a.executionScore || '50');
      const combined = conf * 0.6 + (exec / 100) * 0.4;
      console.log(`    ${a.agentName.padEnd(25)} ${a.signal.padEnd(10)} conf=${(conf * 100).toFixed(1)}% exec=${exec.toFixed(0)} combined=${(combined * 100).toFixed(1)}%`);
    }
    
    // Simulate consensus check
    console.log(`\n    --- PIPELINE SIMULATION ---`);
    
    // Step 1: Filter neutral
    if (actionable.length === 0) {
      console.log(`    ❌ BLOCKED: All signals neutral`);
      continue;
    }
    
    // Step 2: Check min confidence (35%)
    const highConf = actionable.filter((a: any) => parseFloat(a.confidence) >= 0.35);
    console.log(`    Step 2 (minConfidence 35%): ${highConf.length}/${actionable.length} pass`);
    if (highConf.length === 0) {
      console.log(`    ❌ BLOCKED: No signals above 35% confidence`);
      continue;
    }
    
    // Step 3: Check combined score (35%)
    const highQuality = highConf.filter((a: any) => {
      const conf = parseFloat(a.confidence);
      const exec = parseFloat(a.executionScore || '50');
      return (conf * 0.6 + (exec / 100) * 0.4) >= 0.35;
    });
    console.log(`    Step 3 (minCombinedScore 35%): ${highQuality.length}/${highConf.length} pass`);
    if (highQuality.length === 0) {
      console.log(`    ❌ BLOCKED: No signals above 35% combined score`);
      continue;
    }
    
    // Step 4: Simulate family-based consensus
    const AGENT_FAMILIES: Record<string, string> = {
      'TechnicalAnalyst': 'technical',
      'PatternMatcher': 'technical',
      'OrderFlowAnalyst': 'flow',
      'WhaleWatcher': 'flow',
      'SentimentAnalyst': 'sentiment',
      'NewsSentinel': 'sentiment',
      'MacroAnalyst': 'macro',
      'ForexCorrelationAgent': 'macro',
      'MLPredictionAgent': 'ml',
      'LSTMPricePredictor': 'ml',
      'MonteCarloSimulator': 'statistical',
      'OnChainAnalyst': 'onchain',
      'SmartMoneyTracker': 'onchain',
      'MarketRegimeAI': 'regime',
    };
    
    const familyVotes: Record<string, { bullish: number; bearish: number; neutral: number }> = {};
    for (const a of actionable) {
      const family = AGENT_FAMILIES[a.agentName] || 'other';
      if (!familyVotes[family]) familyVotes[family] = { bullish: 0, bearish: 0, neutral: 0 };
      const conf = parseFloat(a.confidence);
      if (a.signal === 'bullish') familyVotes[family].bullish += conf;
      else if (a.signal === 'bearish') familyVotes[family].bearish += conf;
      else familyVotes[family].neutral += conf;
    }
    
    let bullishFamilies = 0;
    let bearishFamilies = 0;
    for (const [family, votes] of Object.entries(familyVotes)) {
      const dir = votes.bullish > votes.bearish ? 'bullish' : votes.bearish > votes.bullish ? 'bearish' : 'neutral';
      if (dir === 'bullish') bullishFamilies++;
      else if (dir === 'bearish') bearishFamilies++;
      console.log(`    Family ${family.padEnd(12)}: B=${votes.bullish.toFixed(2)} Be=${votes.bearish.toFixed(2)} → ${dir}`);
    }
    
    const MIN_FAMILY_AGREEMENT = 2;
    const dominantFamilies = Math.max(bullishFamilies, bearishFamilies);
    console.log(`    Family agreement: bullish=${bullishFamilies} bearish=${bearishFamilies} (need ${MIN_FAMILY_AGREEMENT})`);
    
    if (dominantFamilies < MIN_FAMILY_AGREEMENT) {
      console.log(`    ❌ BLOCKED: Only ${dominantFamilies} families agree (need ${MIN_FAMILY_AGREEMENT}) → strength = 0%`);
    } else {
      console.log(`    ✅ Family agreement met → consensus would be computed`);
    }
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
