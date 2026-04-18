import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

// Get DATABASE_URL from running process
let dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  try {
    const pid = execSync('pgrep -f tsx').toString().trim().split('\n')[0];
    const env = readFileSync(`/proc/${pid}/environ`, 'utf8');
    const match = env.split('\0').find(e => e.startsWith('DATABASE_URL='));
    if (match) dbUrl = match.substring('DATABASE_URL='.length);
  } catch(e) {
    console.error('Could not find DATABASE_URL');
    process.exit(1);
  }
}

const conn = await mysql.createConnection(dbUrl);
const tables = [
  'systemHeartbeat', 'serviceEvents', 'apiConnectionLog', 
  'websocketHealthLog', 'exitDecisionLog', 'capitalUtilization', 
  'positionSizingLog', 'entryValidationLog', 'alertLog'
];

console.log('=== Monitoring Table Status ===');
for (const t of tables) {
  try {
    const [rows] = await conn.query(`SELECT COUNT(*) as cnt FROM \`${t}\``);
    const status = rows[0].cnt > 0 ? '✅' : '⏳';
    console.log(`${status} ${t}: ${rows[0].cnt} rows`);
    
    if (rows[0].cnt > 0) {
      const [latest] = await conn.query(`SELECT * FROM \`${t}\` ORDER BY id DESC LIMIT 1`);
      console.log(`   Latest: ${JSON.stringify(latest[0]).substring(0, 200)}`);
    }
  } catch(e) {
    console.log(`❌ ${t}: ERROR - ${e.message}`);
  }
}

await conn.end();
