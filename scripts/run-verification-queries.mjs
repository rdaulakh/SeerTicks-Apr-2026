import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

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
const results = {};

async function runQuery(name, sql) {
  try {
    const [rows] = await conn.query(sql);
    results[name] = rows;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 ${name}`);
    console.log(`${'='.repeat(60)}`);
    if (rows.length === 0) {
      console.log('  (no data yet)');
    } else {
      console.table(rows);
    }
    return rows;
  } catch(e) {
    console.log(`\n❌ ${name}: ${e.message}`);
    results[name] = { error: e.message };
    return [];
  }
}

// ============================================================
// STEP 1: VERIFICATION QUERIES
// ============================================================
console.log('\n' + '🔍'.repeat(30));
console.log('STEP 1: VERIFICATION QUERIES');
console.log('🔍'.repeat(30));

// Query 1: Heartbeat
await runQuery('1. Heartbeat Status (Last Hour)', `
  SELECT 
    COUNT(*) as heartbeats,
    MIN(timestamp) as first_beat,
    MAX(timestamp) as last_beat,
    TIMESTAMPDIFF(MINUTE, MIN(timestamp), MAX(timestamp)) as minutes_tracked,
    ROUND(AVG(cpuPercent), 2) as avg_cpu,
    ROUND(AVG(memoryMb), 0) as avg_memory_mb
  FROM systemHeartbeat
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR)
`);

// Query 2: Service Events
await runQuery('2. Service Events (Recent)', `
  SELECT 
    serviceName,
    eventType,
    timestamp,
    reason,
    version
  FROM serviceEvents
  ORDER BY timestamp DESC
  LIMIT 10
`);

// Query 3: API Connection Monitoring
await runQuery('3. API Connection Health (Last Hour)', `
  SELECT 
    apiName,
    connectionStatus,
    COUNT(*) as attempts,
    ROUND(AVG(responseTimeMs), 0) as avg_response_ms,
    MAX(timestamp) as last_attempt
  FROM apiConnectionLog
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR)
  GROUP BY apiName, connectionStatus
`);

// Query 4: Capital Utilization
await runQuery('4. Capital Utilization (Recent)', `
  SELECT 
    timestamp,
    totalCapital,
    deployedCapital,
    idleCapital,
    utilizationPercent,
    openPositionsCount
  FROM capitalUtilization
  ORDER BY timestamp DESC
  LIMIT 10
`);

// Query 5: Exit Decisions
await runQuery('5. Exit Decisions (Last Hour)', `
  SELECT 
    COUNT(*) as total_exits,
    COUNT(DISTINCT triggeredExit) as unique_exit_types
  FROM exitDecisionLog
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR)
`);

// ============================================================
// STEP 2: DASHBOARD ANALYSIS QUERIES
// ============================================================
console.log('\n' + '📈'.repeat(30));
console.log('STEP 2: DASHBOARD ANALYSIS QUERIES');
console.log('📈'.repeat(30));

// Daily System Health
await runQuery('6. Daily System Health Dashboard', `
  SELECT 'System Heartbeats' as metric, CAST(COUNT(*) AS CHAR) as value
  FROM systemHeartbeat WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
  UNION ALL
  SELECT 'Service Restarts', CAST(COUNT(*) AS CHAR)
  FROM serviceEvents WHERE eventType IN ('restart', 'crash') AND timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
  UNION ALL
  SELECT 'API Failures', CAST(COUNT(*) AS CHAR)
  FROM apiConnectionLog WHERE connectionStatus != 'connected' AND timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
  UNION ALL
  SELECT 'Avg CPU Usage', CONCAT(ROUND(AVG(cpuPercent), 1), '%')
  FROM systemHeartbeat WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
  UNION ALL
  SELECT 'Avg Memory Usage', CONCAT(ROUND(AVG(memoryMb), 0), ' MB')
  FROM systemHeartbeat WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
`);

// 24/7 Operations Verification
await runQuery('7. 24/7 Operations (Hourly Heartbeats)', `
  SELECT 
    DATE(timestamp) as date,
    HOUR(timestamp) as hour,
    COUNT(*) as heartbeats,
    CASE 
      WHEN COUNT(*) = 0 THEN '❌ SYSTEM DOWN'
      WHEN COUNT(*) < 30 THEN '⚠️ DEGRADED'
      WHEN COUNT(*) >= 30 THEN '✅ HEALTHY'
    END as status
  FROM systemHeartbeat
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
  GROUP BY DATE(timestamp), HOUR(timestamp)
  ORDER BY date DESC, hour DESC
`);

// Connection Health Report
await runQuery('8. Connection Health Report', `
  SELECT 
    apiName,
    DATE(timestamp) as date,
    COUNT(*) as total_attempts,
    SUM(CASE WHEN connectionStatus = 'connected' THEN 1 ELSE 0 END) as successful,
    SUM(CASE WHEN connectionStatus != 'connected' THEN 1 ELSE 0 END) as failed,
    ROUND(SUM(CASE WHEN connectionStatus = 'connected' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as success_rate,
    ROUND(AVG(CASE WHEN connectionStatus = 'connected' THEN responseTimeMs END), 0) as avg_response_ms
  FROM apiConnectionLog
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
  GROUP BY apiName, DATE(timestamp)
  ORDER BY date DESC, success_rate ASC
`);

// WebSocket Health
await runQuery('9. WebSocket Health (Recent)', `
  SELECT 
    websocketName,
    connectionStatus,
    COUNT(*) as records,
    ROUND(AVG(messagesReceivedLastMinute), 0) as avg_msgs_per_min,
    MAX(timestamp) as last_update
  FROM websocketHealthLog
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR)
  GROUP BY websocketName, connectionStatus
`);

// Alert History
await runQuery('10. Alert History', `
  SELECT 
    alertType,
    severity,
    title,
    message,
    timestamp
  FROM alertLog
  ORDER BY timestamp DESC
  LIMIT 10
`);

// Entry Validation Log
await runQuery('11. Entry Validation Log (Recent)', `
  SELECT 
    COUNT(*) as total_validations,
    SUM(CASE WHEN result = 'approved' THEN 1 ELSE 0 END) as approved,
    SUM(CASE WHEN result = 'rejected' THEN 1 ELSE 0 END) as rejected
  FROM entryValidationLog
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
`);

// Position Sizing Log
await runQuery('12. Position Sizing Log (Recent)', `
  SELECT COUNT(*) as total_sizing_decisions
  FROM positionSizingLog
  WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
`);

// Summary
console.log('\n' + '='.repeat(60));
console.log('📋 SUMMARY');
console.log('='.repeat(60));

const tables = [
  'systemHeartbeat', 'serviceEvents', 'apiConnectionLog', 
  'websocketHealthLog', 'exitDecisionLog', 'capitalUtilization', 
  'positionSizingLog', 'entryValidationLog', 'alertLog'
];

for (const t of tables) {
  const [rows] = await conn.query(`SELECT COUNT(*) as cnt FROM \`${t}\``);
  const status = rows[0].cnt > 0 ? '✅' : '⏳';
  console.log(`${status} ${t}: ${rows[0].cnt} rows`);
}

// Save results to file
writeFileSync('/home/ubuntu/seer/VERIFICATION_RESULTS.json', JSON.stringify(results, null, 2));
console.log('\n✅ Results saved to VERIFICATION_RESULTS.json');

await conn.end();
