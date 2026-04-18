import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== FAST AGENT SIGNAL DATA AUDIT ===\n");

// Get a sample of TechnicalAnalyst signal data
console.log("1. SAMPLE TECHNICAL ANALYST SIGNAL DATA:");
const [techSignals] = await conn.query(`
  SELECT 
    id,
    agentName, 
    signalType,
    confidence,
    executionScore,
    signalData,
    timestamp
  FROM agentSignals 
  WHERE agentName = 'TechnicalAnalyst'
  ORDER BY timestamp DESC
  LIMIT 3
`);

for (const sig of techSignals) {
  console.log(`\n--- Signal ID: ${sig.id} ---`);
  console.log(`Type: ${sig.signalType}, Confidence: ${sig.confidence}, ExecutionScore: ${sig.executionScore}`);
  console.log(`Timestamp: ${sig.timestamp}`);
  
  // Parse and display signal data
  if (sig.signalData) {
    const data = typeof sig.signalData === 'string' ? JSON.parse(sig.signalData) : sig.signalData;
    console.log(`Signal from data: ${data.signal}`);
    console.log(`Confidence from data: ${data.confidence}`);
    console.log(`Strength from data: ${data.strength}`);
    console.log(`Reasoning: ${data.reasoning?.substring(0, 200)}...`);
    if (data.evidence) {
      console.log(`Evidence RSI: ${data.evidence.rsi}`);
      console.log(`Evidence MACD: ${JSON.stringify(data.evidence.macd)}`);
      console.log(`Evidence currentPrice: ${data.evidence.currentPrice}`);
    }
  }
}

// Get a sample of PatternMatcher signal data
console.log("\n\n2. SAMPLE PATTERN MATCHER SIGNAL DATA:");
const [patternSignals] = await conn.query(`
  SELECT 
    id,
    agentName, 
    signalType,
    confidence,
    executionScore,
    signalData,
    timestamp
  FROM agentSignals 
  WHERE agentName = 'PatternMatcher'
  ORDER BY timestamp DESC
  LIMIT 3
`);

for (const sig of patternSignals) {
  console.log(`\n--- Signal ID: ${sig.id} ---`);
  console.log(`Type: ${sig.signalType}, Confidence: ${sig.confidence}, ExecutionScore: ${sig.executionScore}`);
  
  if (sig.signalData) {
    const data = typeof sig.signalData === 'string' ? JSON.parse(sig.signalData) : sig.signalData;
    console.log(`Signal from data: ${data.signal}`);
    console.log(`Confidence from data: ${data.confidence}`);
    console.log(`Reasoning: ${data.reasoning?.substring(0, 200)}...`);
  }
}

await conn.end();
console.log("\n\n=== AUDIT COMPLETE ===");
