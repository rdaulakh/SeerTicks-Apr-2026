/**
 * Simplified Agent Prediction Accuracy Audit
 */

import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";

const db = drizzle(process.env.DATABASE_URL!);

async function main() {
  console.log("=" .repeat(100));
  console.log("AGENT PREDICTION ACCURACY AUDIT");
  console.log("=".repeat(100));

  // Get closed positions with consensus data
  const positions = await db.execute(sql`
    SELECT 
      id, symbol, side, entryPrice, exitPrice, entryTime, exitTime,
      realizedPnl, status, originalConsensus, peakConfidence, exitReason
    FROM paperPositions 
    WHERE status = 'closed' AND exitPrice IS NOT NULL
    ORDER BY entryTime DESC
    LIMIT 200
  `);
  
  const posData = positions[0] as any[];
  console.log(`\nAnalyzing ${posData.length} closed positions...\n`);

  // Analyze prediction accuracy
  let correct = 0;
  let incorrect = 0;
  let highConfCorrect = 0;
  let highConfIncorrect = 0;
  let totalPnl = 0;
  let winningPnl = 0;
  let losingPnl = 0;

  const byConsensus: { [key: string]: { correct: number; incorrect: number; pnl: number } } = {
    "65-70%": { correct: 0, incorrect: 0, pnl: 0 },
    "70-75%": { correct: 0, incorrect: 0, pnl: 0 },
    "75-80%": { correct: 0, incorrect: 0, pnl: 0 },
    "80-85%": { correct: 0, incorrect: 0, pnl: 0 },
    "85%+": { correct: 0, incorrect: 0, pnl: 0 },
  };

  for (const pos of posData) {
    const entry = parseFloat(pos.entryPrice);
    const exit = parseFloat(pos.exitPrice);
    const pnl = parseFloat(pos.realizedPnl || 0);
    const consensus = parseFloat(pos.originalConsensus || 0.65);
    const side = pos.side;

    // Did price move in predicted direction?
    const priceUp = exit > entry;
    const predictedUp = side === "long";
    const wasCorrect = (predictedUp && priceUp) || (!predictedUp && !priceUp);

    totalPnl += pnl;
    if (pnl > 0) winningPnl += pnl;
    else losingPnl += pnl;

    if (wasCorrect) {
      correct++;
      if (consensus >= 0.75) highConfCorrect++;
    } else {
      incorrect++;
      if (consensus >= 0.75) highConfIncorrect++;
    }

    // Group by consensus
    let bucket = "65-70%";
    if (consensus >= 0.85) bucket = "85%+";
    else if (consensus >= 0.80) bucket = "80-85%";
    else if (consensus >= 0.75) bucket = "75-80%";
    else if (consensus >= 0.70) bucket = "70-75%";
    
    byConsensus[bucket].pnl += pnl;
    if (wasCorrect) byConsensus[bucket].correct++;
    else byConsensus[bucket].incorrect++;
  }

  const total = correct + incorrect;
  const accuracy = total > 0 ? (correct / total) * 100 : 0;
  const highConfAcc = (highConfCorrect + highConfIncorrect) > 0 
    ? (highConfCorrect / (highConfCorrect + highConfIncorrect)) * 100 : 0;

  console.log("OVERALL PREDICTION ACCURACY");
  console.log("-".repeat(50));
  console.log(`Total Trades: ${total}`);
  console.log(`Correct Direction: ${correct} (${accuracy.toFixed(1)}%)`);
  console.log(`Wrong Direction: ${incorrect} (${(100 - accuracy).toFixed(1)}%)`);
  console.log(`High Confidence (>=75%) Accuracy: ${highConfAcc.toFixed(1)}%`);
  console.log(`Total P&L: $${totalPnl.toFixed(2)}`);
  console.log(`Winning P&L: $${winningPnl.toFixed(2)}`);
  console.log(`Losing P&L: $${losingPnl.toFixed(2)}`);

  console.log("\n\nACCURACY BY CONSENSUS LEVEL");
  console.log("-".repeat(70));
  console.log("| Consensus | Total | Correct | Accuracy | Total P&L |");
  console.log("|-----------|-------|---------|----------|-----------|");
  
  for (const [bucket, data] of Object.entries(byConsensus)) {
    const bucketTotal = data.correct + data.incorrect;
    const bucketAcc = bucketTotal > 0 ? (data.correct / bucketTotal) * 100 : 0;
    console.log(`| ${bucket.padEnd(9)} | ${String(bucketTotal).padStart(5)} | ${String(data.correct).padStart(7)} | ${bucketAcc.toFixed(1).padStart(7)}% | $${data.pnl.toFixed(2).padStart(8)} |`);
  }

  // Analyze exit reasons
  console.log("\n\nEXIT REASON ANALYSIS");
  console.log("-".repeat(70));
  
  const exitReasons: { [key: string]: { count: number; wins: number; pnl: number } } = {};
  
  for (const pos of posData) {
    const reason = pos.exitReason || "unknown";
    const pnl = parseFloat(pos.realizedPnl || 0);
    
    if (!exitReasons[reason]) exitReasons[reason] = { count: 0, wins: 0, pnl: 0 };
    exitReasons[reason].count++;
    exitReasons[reason].pnl += pnl;
    if (pnl > 0) exitReasons[reason].wins++;
  }

  console.log("| Exit Reason | Count | Win Rate | Total P&L |");
  console.log("|-------------|-------|----------|-----------|");
  
  for (const [reason, data] of Object.entries(exitReasons).sort((a, b) => b[1].count - a[1].count)) {
    const winRate = data.count > 0 ? (data.wins / data.count) * 100 : 0;
    const shortReason = reason.substring(0, 40);
    console.log(`| ${shortReason.padEnd(40)} | ${String(data.count).padStart(5)} | ${winRate.toFixed(1).padStart(7)}% | $${data.pnl.toFixed(2).padStart(8)} |`);
  }

  // Key findings
  console.log("\n\n" + "=".repeat(100));
  console.log("KEY FINDINGS");
  console.log("=".repeat(100));

  if (accuracy < 50) {
    console.log("\n⚠️  CRITICAL: Prediction accuracy is ${accuracy.toFixed(1)}% - WORSE than random chance!");
    console.log("    The agents are systematically predicting the WRONG direction.");
    console.log("    RECOMMENDATION: Consider INVERTING the signal (if agents say LONG, go SHORT)");
  } else if (accuracy < 55) {
    console.log(`\n⚠️  WARNING: Prediction accuracy is ${accuracy.toFixed(1)}% - barely better than random.`);
  } else {
    console.log(`\n✓  Prediction accuracy is ${accuracy.toFixed(1)}%`);
  }

  // Check if high confidence is worse than low confidence
  const lowConfCorrect = correct - highConfCorrect;
  const lowConfIncorrect = incorrect - highConfIncorrect;
  const lowConfAcc = (lowConfCorrect + lowConfIncorrect) > 0 
    ? (lowConfCorrect / (lowConfCorrect + lowConfIncorrect)) * 100 : 0;

  if (highConfAcc < lowConfAcc) {
    console.log("\n⚠️  PROBLEM: High confidence signals are LESS accurate than low confidence!");
    console.log(`    High conf: ${highConfAcc.toFixed(1)}% vs Low conf: ${lowConfAcc.toFixed(1)}%`);
    console.log("    The confidence scoring is MISCALIBRATED.");
  }

  process.exit(0);
}

main().catch(e => {
  console.error("Error:", e);
  process.exit(1);
});
