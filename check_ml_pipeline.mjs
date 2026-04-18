import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== ML PIPELINE INVESTIGATION ===\n");

// Check nnPredictions table
const [nnPredictions] = await connection.query(`SELECT COUNT(*) as count FROM nnPredictions`);
console.log(`nnPredictions: ${nnPredictions[0].count} records`);

// Check rlModels table
const [rlModels] = await connection.query(`SELECT * FROM rlModels LIMIT 5`);
console.log(`\nRL Models: ${rlModels.length} records`);
if (rlModels.length > 0) {
  console.log("Sample:", JSON.stringify(rlModels[0], null, 2));
}

// Check mlTrainingData
const [mlTraining] = await connection.query(`SELECT COUNT(*) as count FROM mlTrainingData`);
console.log(`\nmlTrainingData: ${mlTraining[0].count} records`);

// Check rlTrainingHistory
const [rlHistory] = await connection.query(`SELECT * FROM rlTrainingHistory ORDER BY id DESC LIMIT 3`);
console.log(`\nRL Training History (last 3):`);
rlHistory.forEach(h => {
  console.log(`  - ${h.createdAt}: ${h.modelType} - ${h.status}`);
});

// Check MLPredictionAgent signals
const [mlSignals] = await connection.query(`
  SELECT agentName, COUNT(*) as count, AVG(confidence) as avgConf
  FROM agentSignals 
  WHERE agentName = 'MLPredictionAgent'
  AND timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
  GROUP BY agentName
`);
console.log(`\nMLPredictionAgent signals (last 24h):`);
if (mlSignals.length > 0) {
  console.log(`  Count: ${mlSignals[0].count}, Avg Confidence: ${mlSignals[0].avgConf?.toFixed(2) || 'N/A'}%`);
} else {
  console.log("  No signals found");
}

// Check recent MLPredictionAgent signal details
const [recentML] = await connection.query(`
  SELECT timestamp, symbol, direction, confidence, evidence
  FROM agentSignals 
  WHERE agentName = 'MLPredictionAgent'
  ORDER BY timestamp DESC
  LIMIT 3
`);
console.log(`\nRecent MLPredictionAgent signals:`);
recentML.forEach(s => {
  console.log(`  ${s.timestamp}: ${s.symbol} - ${s.direction} (${s.confidence}%)`);
  if (s.evidence) {
    try {
      const ev = JSON.parse(s.evidence);
      console.log(`    Reason: ${ev.reason || 'N/A'}`);
    } catch(e) {}
  }
});

await connection.end();
