/**
 * Comprehensive Agent Prediction Accuracy Audit
 * 
 * Analyzes each agent's prediction accuracy against actual price movements
 * to identify which agents are accurate predictors vs noise generators.
 */

import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";
import * as fs from "fs";

const db = drizzle(process.env.DATABASE_URL!);

interface AgentSignal {
  id: number;
  symbol: string;
  agentName: string;
  signal: string;
  confidence: number;
  score: number;
  timestamp: Date;
  reasoning?: string;
}

interface PriceData {
  symbol: string;
  price: number;
  timestamp: Date;
}

interface AgentPerformance {
  agentName: string;
  totalSignals: number;
  bullishSignals: number;
  bearishSignals: number;
  correctPredictions: number;
  incorrectPredictions: number;
  accuracy: number;
  avgConfidence: number;
  avgConfidenceWhenCorrect: number;
  avgConfidenceWhenWrong: number;
  profitContribution: number;
}

async function main() {
  console.log("=".repeat(100));
  console.log("COMPREHENSIVE AGENT PREDICTION ACCURACY AUDIT");
  console.log("=".repeat(100));
  console.log("");

  // Step 1: Get all tables to understand data structure
  console.log("Step 1: Discovering database schema...");
  const tables = await db.execute(sql`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = DATABASE()
  `);
  
  const tableList = (tables[0] as any[]).map(t => t.table_name || t.TABLE_NAME);
  console.log("Available tables:", tableList.filter(t => 
    t.includes('agent') || t.includes('signal') || t.includes('consensus') || t.includes('position')
  ).join(", "));

  // Step 2: Check agentSignals table structure
  console.log("\nStep 2: Checking agentSignals table structure...");
  try {
    const columns = await db.execute(sql`
      SELECT column_name, data_type FROM information_schema.columns 
      WHERE table_schema = DATABASE() AND table_name = 'agentSignals'
    `);
    console.log("agentSignals columns:", JSON.stringify(columns[0], null, 2));
  } catch (e) {
    console.log("agentSignals table not found or error:", e);
  }

  // Step 3: Get sample agent signals
  console.log("\nStep 3: Fetching agent signals...");
  let agentSignals: any[] = [];
  try {
    const signals = await db.execute(sql`
      SELECT * FROM agentSignals ORDER BY timestamp DESC LIMIT 100
    `);
    agentSignals = signals[0] as any[];
    console.log(`Found ${agentSignals.length} agent signals`);
    if (agentSignals.length > 0) {
      console.log("Sample signal:", JSON.stringify(agentSignals[0], null, 2));
    }
  } catch (e) {
    console.log("Error fetching agentSignals:", e);
  }

  // Step 4: Get positions with entry/exit data
  console.log("\nStep 4: Fetching position data for price movement analysis...");
  const positions = await db.execute(sql`
    SELECT id, symbol, side, entryPrice, exitPrice, entryTime, exitTime, 
           realizedPnl, status, consensusAtEntry
    FROM paperPositions 
    WHERE status = 'closed' AND exitPrice IS NOT NULL
    ORDER BY entryTime DESC
    LIMIT 200
  `);
  const positionData = positions[0] as any[];
  console.log(`Found ${positionData.length} closed positions for analysis`);

  // Step 5: Analyze consensus at entry vs actual outcome
  console.log("\nStep 5: Analyzing consensus accuracy...");
  
  let correctPredictions = 0;
  let incorrectPredictions = 0;
  let highConfidenceCorrect = 0;
  let highConfidenceIncorrect = 0;
  let lowConfidenceCorrect = 0;
  let lowConfidenceIncorrect = 0;

  for (const pos of positionData) {
    const entryPrice = parseFloat(pos.entryPrice);
    const exitPrice = parseFloat(pos.exitPrice);
    const consensus = parseFloat(pos.consensusAtEntry || 0);
    const side = pos.side;
    
    // Determine if prediction was correct
    const priceWentUp = exitPrice > entryPrice;
    const predictedUp = side === 'long';
    const wasCorrect = (predictedUp && priceWentUp) || (!predictedUp && !priceWentUp);
    
    if (wasCorrect) {
      correctPredictions++;
      if (consensus >= 0.75) highConfidenceCorrect++;
      else lowConfidenceCorrect++;
    } else {
      incorrectPredictions++;
      if (consensus >= 0.75) highConfidenceIncorrect++;
      else lowConfidenceIncorrect++;
    }
  }

  const totalPredictions = correctPredictions + incorrectPredictions;
  const overallAccuracy = totalPredictions > 0 ? (correctPredictions / totalPredictions) * 100 : 0;
  const highConfidenceAccuracy = (highConfidenceCorrect + highConfidenceIncorrect) > 0 
    ? (highConfidenceCorrect / (highConfidenceCorrect + highConfidenceIncorrect)) * 100 : 0;
  const lowConfidenceAccuracy = (lowConfidenceCorrect + lowConfidenceIncorrect) > 0
    ? (lowConfidenceCorrect / (lowConfidenceCorrect + lowConfidenceIncorrect)) * 100 : 0;

  console.log("\n" + "=".repeat(80));
  console.log("CONSENSUS PREDICTION ACCURACY ANALYSIS");
  console.log("=".repeat(80));
  console.log(`Total Predictions: ${totalPredictions}`);
  console.log(`Correct: ${correctPredictions} (${overallAccuracy.toFixed(1)}%)`);
  console.log(`Incorrect: ${incorrectPredictions} (${(100 - overallAccuracy).toFixed(1)}%)`);
  console.log("");
  console.log(`High Confidence (>=75%) Accuracy: ${highConfidenceAccuracy.toFixed(1)}%`);
  console.log(`  Correct: ${highConfidenceCorrect}, Incorrect: ${highConfidenceIncorrect}`);
  console.log(`Low Confidence (<75%) Accuracy: ${lowConfidenceAccuracy.toFixed(1)}%`);
  console.log(`  Correct: ${lowConfidenceCorrect}, Incorrect: ${lowConfidenceIncorrect}`);

  // Step 6: Analyze by consensus level
  console.log("\n" + "=".repeat(80));
  console.log("ACCURACY BY CONSENSUS LEVEL");
  console.log("=".repeat(80));

  const consensusRanges = [
    { min: 0.65, max: 0.70, label: "65-70%" },
    { min: 0.70, max: 0.75, label: "70-75%" },
    { min: 0.75, max: 0.80, label: "75-80%" },
    { min: 0.80, max: 0.85, label: "80-85%" },
    { min: 0.85, max: 1.00, label: "85%+" },
  ];

  console.log("| Consensus Range | Total | Correct | Accuracy | Avg P&L |");
  console.log("|-----------------|-------|---------|----------|---------|");

  for (const range of consensusRanges) {
    const rangePositions = positionData.filter(p => {
      const c = parseFloat(p.consensusAtEntry || 0);
      return c >= range.min && c < range.max;
    });
    
    let rangeCorrect = 0;
    let rangeTotalPnl = 0;
    
    for (const pos of rangePositions) {
      const entryPrice = parseFloat(pos.entryPrice);
      const exitPrice = parseFloat(pos.exitPrice);
      const pnl = parseFloat(pos.realizedPnl || 0);
      const side = pos.side;
      
      const priceWentUp = exitPrice > entryPrice;
      const predictedUp = side === 'long';
      const wasCorrect = (predictedUp && priceWentUp) || (!predictedUp && !priceWentUp);
      
      if (wasCorrect) rangeCorrect++;
      rangeTotalPnl += pnl;
    }
    
    const rangeAccuracy = rangePositions.length > 0 ? (rangeCorrect / rangePositions.length) * 100 : 0;
    const avgPnl = rangePositions.length > 0 ? rangeTotalPnl / rangePositions.length : 0;
    
    console.log(`| ${range.label.padEnd(15)} | ${String(rangePositions.length).padStart(5)} | ${String(rangeCorrect).padStart(7)} | ${rangeAccuracy.toFixed(1).padStart(7)}% | $${avgPnl.toFixed(2).padStart(6)} |`);
  }

  // Step 7: Analyze price movement patterns
  console.log("\n" + "=".repeat(80));
  console.log("PRICE MOVEMENT ANALYSIS");
  console.log("=".repeat(80));

  let priceUpCount = 0;
  let priceDownCount = 0;
  let avgUpMove = 0;
  let avgDownMove = 0;

  for (const pos of positionData) {
    const entryPrice = parseFloat(pos.entryPrice);
    const exitPrice = parseFloat(pos.exitPrice);
    const movePercent = ((exitPrice - entryPrice) / entryPrice) * 100;
    
    if (exitPrice > entryPrice) {
      priceUpCount++;
      avgUpMove += movePercent;
    } else {
      priceDownCount++;
      avgDownMove += Math.abs(movePercent);
    }
  }

  avgUpMove = priceUpCount > 0 ? avgUpMove / priceUpCount : 0;
  avgDownMove = priceDownCount > 0 ? avgDownMove / priceDownCount : 0;

  console.log(`Price went UP: ${priceUpCount} times (${(priceUpCount / totalPredictions * 100).toFixed(1)}%)`);
  console.log(`  Average UP move: +${avgUpMove.toFixed(3)}%`);
  console.log(`Price went DOWN: ${priceDownCount} times (${(priceDownCount / totalPredictions * 100).toFixed(1)}%)`);
  console.log(`  Average DOWN move: -${avgDownMove.toFixed(3)}%`);

  // Step 8: Check individual agent performance from agentSignals
  if (agentSignals.length > 0) {
    console.log("\n" + "=".repeat(80));
    console.log("INDIVIDUAL AGENT SIGNAL ANALYSIS");
    console.log("=".repeat(80));

    // Group by agent name
    const agentGroups: { [key: string]: any[] } = {};
    for (const sig of agentSignals) {
      const agentName = sig.agentName || sig.agent_name || "unknown";
      if (!agentGroups[agentName]) agentGroups[agentName] = [];
      agentGroups[agentName].push(sig);
    }

    console.log("\n| Agent Name | Signals | Bullish | Bearish | Avg Confidence |");
    console.log("|------------|---------|---------|---------|----------------|");

    for (const [agentName, signals] of Object.entries(agentGroups)) {
      const bullish = signals.filter(s => s.signal === 'bullish' || s.signal === 'BULLISH').length;
      const bearish = signals.filter(s => s.signal === 'bearish' || s.signal === 'BEARISH').length;
      const avgConf = signals.reduce((sum, s) => sum + (parseFloat(s.confidence) || 0), 0) / signals.length;
      
      console.log(`| ${agentName.padEnd(10)} | ${String(signals.length).padStart(7)} | ${String(bullish).padStart(7)} | ${String(bearish).padStart(7)} | ${(avgConf * 100).toFixed(1).padStart(13)}% |`);
    }
  }

  // Step 9: Generate recommendations
  console.log("\n" + "=".repeat(80));
  console.log("KEY FINDINGS & RECOMMENDATIONS");
  console.log("=".repeat(80));

  console.log("\n1. OVERALL PREDICTION ACCURACY:");
  if (overallAccuracy < 50) {
    console.log(`   ⚠️ CRITICAL: Overall accuracy is ${overallAccuracy.toFixed(1)}% (worse than random chance)`);
    console.log("   The consensus signal is currently a NEGATIVE predictor.");
  } else if (overallAccuracy < 55) {
    console.log(`   ⚠️ WARNING: Overall accuracy is ${overallAccuracy.toFixed(1)}% (barely better than random)`);
  } else {
    console.log(`   ✓ Overall accuracy is ${overallAccuracy.toFixed(1)}%`);
  }

  console.log("\n2. CONFIDENCE CALIBRATION:");
  if (highConfidenceAccuracy < lowConfidenceAccuracy) {
    console.log("   ⚠️ PROBLEM: High confidence signals are LESS accurate than low confidence");
    console.log("   This indicates the confidence scoring is miscalibrated.");
  } else {
    console.log(`   ✓ High confidence (${highConfidenceAccuracy.toFixed(1)}%) > Low confidence (${lowConfidenceAccuracy.toFixed(1)}%)`);
  }

  console.log("\n3. MARKET BIAS:");
  const marketBias = priceDownCount > priceUpCount ? "BEARISH" : "BULLISH";
  console.log(`   Market moved DOWN ${(priceDownCount / totalPredictions * 100).toFixed(1)}% of the time`);
  console.log(`   Market bias during test period: ${marketBias}`);
  if (marketBias === "BEARISH" && overallAccuracy < 50) {
    console.log("   ⚠️ System is taking LONG positions in a BEARISH market");
  }

  // Save report
  const report = `# Agent Prediction Accuracy Audit Report

**Date:** ${new Date().toISOString()}
**Total Positions Analyzed:** ${totalPredictions}

## Overall Accuracy

- **Correct Predictions:** ${correctPredictions} (${overallAccuracy.toFixed(1)}%)
- **Incorrect Predictions:** ${incorrectPredictions} (${(100 - overallAccuracy).toFixed(1)}%)

## Accuracy by Confidence Level

- **High Confidence (>=75%):** ${highConfidenceAccuracy.toFixed(1)}%
- **Low Confidence (<75%):** ${lowConfidenceAccuracy.toFixed(1)}%

## Market Movement

- **Price went UP:** ${priceUpCount} times (${(priceUpCount / totalPredictions * 100).toFixed(1)}%)
- **Price went DOWN:** ${priceDownCount} times (${(priceDownCount / totalPredictions * 100).toFixed(1)}%)

## Key Finding

${overallAccuracy < 50 
  ? "**CRITICAL:** The consensus signal is currently a NEGATIVE predictor (worse than random chance). This means the agents are systematically predicting the WRONG direction."
  : `The consensus signal has ${overallAccuracy.toFixed(1)}% accuracy.`}

## Recommendations

1. ${overallAccuracy < 50 ? "INVERT the signal - if consensus says LONG, go SHORT" : "Maintain current signal direction"}
2. ${highConfidenceAccuracy < lowConfidenceAccuracy ? "Recalibrate confidence scoring - currently miscalibrated" : "Confidence scoring is properly calibrated"}
3. ${marketBias === "BEARISH" ? "Add market regime filter - avoid LONG positions in bearish markets" : "Continue current approach"}
`;

  fs.writeFileSync("/home/ubuntu/seer/AGENT_AUDIT_REPORT.md", report);
  console.log("\nReport saved to: /home/ubuntu/seer/AGENT_AUDIT_REPORT.md");

  process.exit(0);
}

main().catch(e => {
  console.error("Error:", e);
  process.exit(1);
});
