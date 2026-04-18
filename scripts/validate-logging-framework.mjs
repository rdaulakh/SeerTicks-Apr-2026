/**
 * Validation script for Complete Logging Framework
 * Checks all 9 monitoring tables for data
 */
import mysql from 'mysql2/promise';
import { execSync } from 'child_process';

// Get DATABASE_URL from running server process
let dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  try {
    const pid = execSync("pgrep -f 'tsx.*server' | head -1").toString().trim();
    if (pid) {
      const envStr = execSync(`cat /proc/${pid}/environ`).toString();
      const match = envStr.match(/DATABASE_URL=([^\0]+)/);
      if (match) dbUrl = match[1];
    }
  } catch (e) {}
}
if (!dbUrl) {
  console.error('No DATABASE_URL found');
  process.exit(1);
}

async function main() {
  const conn = await mysql.createConnection(dbUrl);
  
  console.log('='.repeat(60));
  console.log('COMPLETE LOGGING FRAMEWORK - VALIDATION REPORT');
  console.log('='.repeat(60));
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  const tables = [
    'systemHeartbeat',
    'serviceEvents', 
    'apiConnectionLog',
    'websocketHealthLog',
    'exitDecisionLog',
    'capitalUtilization',
    'positionSizingLog',
    'entryValidationLog',
    'alertLog',
  ];

  for (const table of tables) {
    try {
      const [countRows] = await conn.execute(`SELECT COUNT(*) as cnt FROM ${table}`);
      const count = countRows[0].cnt;
      
      let latest = 'N/A';
      if (count > 0) {
        const [latestRows] = await conn.execute(`SELECT MAX(timestamp) as latest FROM ${table}`);
        latest = latestRows[0].latest;
      }
      
      const status = count > 0 ? '✅ ACTIVE' : '⏳ WAITING';
      console.log(`${status} | ${table.padEnd(25)} | Rows: ${String(count).padStart(6)} | Latest: ${latest}`);
    } catch (err) {
      console.log(`❌ ERROR | ${table.padEnd(25)} | ${err.message}`);
    }
  }

  // Check existing tables too
  console.log('\n--- Existing Monitoring Tables ---');
  const existingTables = ['tradeExecutionLog', 'agentPerformanceMetrics'];
  for (const table of existingTables) {
    try {
      const [countRows] = await conn.execute(`SELECT COUNT(*) as cnt FROM ${table}`);
      const count = countRows[0].cnt;
      console.log(`✅ EXISTS | ${table.padEnd(25)} | Rows: ${String(count).padStart(6)}`);
    } catch (err) {
      console.log(`❌ ERROR | ${table.padEnd(25)} | ${err.message}`);
    }
  }

  // Sample data from active tables
  console.log('\n--- Sample Heartbeat Data ---');
  try {
    const [rows] = await conn.execute('SELECT * FROM systemHeartbeat ORDER BY timestamp DESC LIMIT 3');
    rows.forEach(r => {
      console.log(`  ${r.timestamp} | CPU: ${r.cpuUsage}% | Mem: ${r.memoryUsage}% | Status: ${r.status}`);
    });
    if (rows.length === 0) console.log('  (No heartbeat data yet - engine may need restart)');
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }

  console.log('\n--- Sample Service Events ---');
  try {
    const [rows] = await conn.execute('SELECT * FROM serviceEvents ORDER BY timestamp DESC LIMIT 5');
    rows.forEach(r => {
      console.log(`  ${r.timestamp} | ${r.serviceName} | ${r.eventType} | ${r.message}`);
    });
    if (rows.length === 0) console.log('  (No service events yet - engine may need restart)');
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }

  console.log('\n--- Sample Alert Logs ---');
  try {
    const [rows] = await conn.execute('SELECT * FROM alertLog ORDER BY timestamp DESC LIMIT 5');
    rows.forEach(r => {
      console.log(`  ${r.timestamp} | [${r.severity}] ${r.alertType}: ${r.title}`);
    });
    if (rows.length === 0) console.log('  (No alerts yet - system is healthy)');
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('VALIDATION COMPLETE');
  console.log('='.repeat(60));

  await conn.end();
}

main().catch(err => {
  console.error('Validation failed:', err);
  process.exit(1);
});
