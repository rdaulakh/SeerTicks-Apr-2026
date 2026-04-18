import mysql from 'mysql2/promise';
const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log('='.repeat(80));
console.log('ML SERVICES AUDIT');
console.log('='.repeat(80));

// Check ML training data
console.log('\n=== ML TRAINING DATA ===');
try {
  const [training] = await connection.execute(`
    SELECT COUNT(*) as total, MIN(timestamp) as first, MAX(timestamp) as last
    FROM mlTrainingData
  `);
  console.log(`Total records: ${training[0].total}`);
  console.log(`First: ${training[0].first}`);
  console.log(`Last: ${training[0].last}`);
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check NN predictions
console.log('\n=== NEURAL NETWORK PREDICTIONS ===');
try {
  const [predictions] = await connection.execute(`
    SELECT COUNT(*) as total, MIN(createdAt) as first, MAX(createdAt) as last
    FROM nnPredictions
  `);
  console.log(`Total records: ${predictions[0].total}`);
  console.log(`First: ${predictions[0].first}`);
  console.log(`Last: ${predictions[0].last}`);
  
  // Recent predictions
  const [recent] = await connection.execute(`
    SELECT symbol, predictedDirection, confidence, actualDirection, wasCorrect, createdAt
    FROM nnPredictions
    ORDER BY createdAt DESC
    LIMIT 5
  `);
  console.log('\nRecent predictions:');
  for (const p of recent) {
    console.log(`  ${p.createdAt} | ${p.symbol} | Pred: ${p.predictedDirection} | Conf: ${p.confidence}% | Actual: ${p.actualDirection || 'N/A'} | Correct: ${p.wasCorrect}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check RL models
console.log('\n=== REINFORCEMENT LEARNING MODELS ===');
try {
  const [rlModels] = await connection.execute(`SELECT * FROM rlModels`);
  console.log(`Total models: ${rlModels.length}`);
  for (const m of rlModels) {
    console.log(`  ${m.modelName}: version=${m.version}, active=${m.isActive}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check RL training history
console.log('\n=== RL TRAINING HISTORY ===');
try {
  const [rlHistory] = await connection.execute(`
    SELECT COUNT(*) as total, MAX(createdAt) as last
    FROM rlTrainingHistory
  `);
  console.log(`Total records: ${rlHistory[0].total}`);
  console.log(`Last training: ${rlHistory[0].last}`);
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check learned parameters
console.log('\n=== LEARNED PARAMETERS ===');
try {
  const [params] = await connection.execute(`
    SELECT parameterName, currentValue, optimizedValue, lastOptimizedAt
    FROM learnedParameters
    ORDER BY lastOptimizedAt DESC
    LIMIT 10
  `);
  console.log(`Found ${params.length} parameters`);
  for (const p of params) {
    console.log(`  ${p.parameterName}: current=${p.currentValue}, optimized=${p.optimizedValue}, last=${p.lastOptimizedAt}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check training jobs
console.log('\n=== TRAINING JOBS ===');
try {
  const [jobs] = await connection.execute(`
    SELECT jobType, status, progress, startedAt, completedAt
    FROM trainingJobs
    ORDER BY startedAt DESC
    LIMIT 5
  `);
  console.log(`Recent jobs: ${jobs.length}`);
  for (const j of jobs) {
    console.log(`  ${j.jobType}: status=${j.status}, progress=${j.progress}%, started=${j.startedAt}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check parameter optimization history
console.log('\n=== PARAMETER OPTIMIZATION HISTORY ===');
try {
  const [optHistory] = await connection.execute(`
    SELECT COUNT(*) as total, MAX(createdAt) as last
    FROM parameterOptimizationHistory
  `);
  console.log(`Total records: ${optHistory[0].total}`);
  console.log(`Last optimization: ${optHistory[0].last}`);
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check agent weights (ML-optimized)
console.log('\n=== AGENT WEIGHTS (ML-OPTIMIZED) ===');
try {
  const [weights] = await connection.execute(`
    SELECT agentName, weight, accuracy, lastUpdated
    FROM agentWeights
    ORDER BY weight DESC
    LIMIT 12
  `);
  console.log(`Found ${weights.length} agent weights`);
  for (const w of weights) {
    console.log(`  ${w.agentName}: weight=${w.weight}, accuracy=${w.accuracy}%, updated=${w.lastUpdated}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

await connection.end();
