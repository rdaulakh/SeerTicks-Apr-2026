import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check ML settings
const [settings] = await conn.execute("SELECT * FROM systemSettings WHERE `key` LIKE 'ml_%'");
console.log('ML Settings:', settings);

// Check RL models
try {
  const [models] = await conn.execute("SELECT id, name, agentType, symbol, status FROM rlModels LIMIT 10");
  console.log('\nRL Models:', models);
} catch (e) {
  console.log('\nRL Models table not found or empty');
}

// Check RL training sessions
try {
  const [sessions] = await conn.execute("SELECT id, modelId, status, episodes FROM rlTrainingSessions ORDER BY id DESC LIMIT 5");
  console.log('\nRecent Training Sessions:', sessions);
} catch (e) {
  console.log('\nRL Training Sessions table not found or empty');
}

await conn.end();
