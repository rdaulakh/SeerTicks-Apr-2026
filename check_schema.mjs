import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check agentSignals columns
const [cols] = await conn.execute(`DESCRIBE agentSignals`);
console.log("=== agentSignals columns ===");
cols.forEach(c => console.log(`  ${c.Field}: ${c.Type}`));

// Check paperPositions columns  
const [pcols] = await conn.execute(`DESCRIBE paperPositions`);
console.log("\n=== paperPositions columns ===");
pcols.forEach(c => console.log(`  ${c.Field}: ${c.Type}`));

await conn.end();
