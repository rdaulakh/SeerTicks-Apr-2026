import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== ENABLING ML TRAINING ===\n");

// Check current systemSettings
const [settings] = await connection.query(`SELECT * FROM systemSettings WHERE \`key\` LIKE 'ml%'`);
console.log("Current ML settings:");
settings.forEach(s => console.log(`  ${s.key}: ${s.value}`));

// Enable ML auto-training
console.log("\nEnabling ML auto-training...");
await connection.query(`
  INSERT INTO systemSettings (\`key\`, value, updatedAt) 
  VALUES ('ml_auto_training_enabled', 'true', NOW())
  ON DUPLICATE KEY UPDATE value = 'true', updatedAt = NOW()
`);

// Enable ML prediction
await connection.query(`
  INSERT INTO systemSettings (\`key\`, value, updatedAt) 
  VALUES ('ml_prediction_enabled', 'true', NOW())
  ON DUPLICATE KEY UPDATE value = 'true', updatedAt = NOW()
`);

// Set training schedule (weekly)
await connection.query(`
  INSERT INTO systemSettings (\`key\`, value, updatedAt) 
  VALUES ('ml_training_schedule', 'weekly', NOW())
  ON DUPLICATE KEY UPDATE value = 'weekly', updatedAt = NOW()
`);

// Verify
const [newSettings] = await connection.query(`SELECT * FROM systemSettings WHERE \`key\` LIKE 'ml%'`);
console.log("\nUpdated ML settings:");
newSettings.forEach(s => console.log(`  ${s.key}: ${s.value}`));

await connection.end();
console.log("\n✅ ML training enabled");
