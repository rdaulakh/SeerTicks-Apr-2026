import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== CREATING SYSTEM SETTINGS TABLE ===\n");

// Create systemSettings table
await connection.query(`
  CREATE TABLE IF NOT EXISTS systemSettings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    \`key\` VARCHAR(255) NOT NULL UNIQUE,
    value TEXT,
    description TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`);
console.log("✅ systemSettings table created");

// Enable ML settings
const settings = [
  ['ml_auto_training_enabled', 'true', 'Enable automatic ML model training'],
  ['ml_prediction_enabled', 'true', 'Enable ML prediction agent'],
  ['ml_training_schedule', 'weekly', 'ML training schedule (daily/weekly/monthly)'],
  ['ml_training_data_collection', 'true', 'Enable ML training data collection']
];

for (const [key, value, desc] of settings) {
  await connection.query(`
    INSERT INTO systemSettings (\`key\`, value, description) 
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE value = ?, description = ?
  `, [key, value, desc, value, desc]);
  console.log(`  Set ${key} = ${value}`);
}

// Verify
const [allSettings] = await connection.query(`SELECT * FROM systemSettings`);
console.log("\nAll system settings:");
allSettings.forEach(s => console.log(`  ${s.key}: ${s.value}`));

await connection.end();
console.log("\n✅ ML training enabled");
