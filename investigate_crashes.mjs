import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== CRASH LOOP INVESTIGATION ===\n");

// 1. Check startup log patterns
console.log("=== RECENT STARTUP LOGS (Last 50) ===");
const [startups] = await conn.query(`
  SELECT id, startedAt, status, startupType, startupDurationMs, 
         servicesInitialized, errorMessage
  FROM systemStartupLog 
  ORDER BY startedAt DESC 
  LIMIT 50
`);

// Group by hour to see crash frequency
const hourlyCount = {};
startups.forEach(s => {
  if (s.startedAt) {
    const hour = new Date(s.startedAt).toISOString().slice(0, 13);
    hourlyCount[hour] = (hourlyCount[hour] || 0) + 1;
  }
});

console.log("\nHourly restart frequency (recent):");
Object.entries(hourlyCount).slice(0, 10).forEach(([hour, count]) => {
  console.log(`  ${hour}: ${count} restarts`);
});

// 2. Check for error patterns
console.log("\n=== ERROR PATTERNS ===");
const [errors] = await conn.query(`
  SELECT errorMessage, COUNT(*) as count
  FROM systemStartupLog 
  WHERE errorMessage IS NOT NULL AND errorMessage != ''
  GROUP BY errorMessage
  ORDER BY count DESC
  LIMIT 10
`);
errors.forEach(e => console.log(`  ${e.count}x: ${e.errorMessage?.slice(0, 100)}`));

// 3. Check startup status distribution
console.log("\n=== STARTUP STATUS DISTRIBUTION ===");
const [statuses] = await conn.query(`
  SELECT status, COUNT(*) as count
  FROM systemStartupLog 
  GROUP BY status
  ORDER BY count DESC
`);
statuses.forEach(s => console.log(`  ${s.status || 'null'}: ${s.count}`));

// 4. Check startup type distribution
console.log("\n=== STARTUP TYPE DISTRIBUTION ===");
const [types] = await conn.query(`
  SELECT startupType, COUNT(*) as count
  FROM systemStartupLog 
  GROUP BY startupType
  ORDER BY count DESC
`);
types.forEach(t => console.log(`  ${t.startupType || 'null'}: ${t.count}`));

// 5. Check services initialized
console.log("\n=== SERVICES INITIALIZED PATTERNS ===");
const [services] = await conn.query(`
  SELECT servicesInitialized, COUNT(*) as count
  FROM systemStartupLog 
  GROUP BY servicesInitialized
  ORDER BY count DESC
  LIMIT 10
`);
services.forEach(s => console.log(`  ${s.count}x: ${s.servicesInitialized?.slice(0, 80) || 'null'}`));

// 6. Check if restarts are from the same process or different
console.log("\n=== TIME BETWEEN RESTARTS (Last 20) ===");
for (let i = 0; i < Math.min(19, startups.length - 1); i++) {
  const curr = startups[i];
  const prev = startups[i + 1];
  if (curr.startedAt && prev.startedAt) {
    const diff = (new Date(curr.startedAt) - new Date(prev.startedAt)) / 1000;
    console.log(`  ${diff.toFixed(0)}s between restart ${i} and ${i+1}`);
  }
}

// 7. Check service health for crash indicators
console.log("\n=== SERVICE HEALTH ERRORS (Last 24h) ===");
const [healthErrors] = await conn.query(`
  SELECT serviceName, status, errorMessage, COUNT(*) as count
  FROM serviceHealth 
  WHERE status != 'healthy' 
    AND lastHeartbeat > DATE_SUB(NOW(), INTERVAL 24 HOUR)
  GROUP BY serviceName, status, errorMessage
  ORDER BY count DESC
  LIMIT 15
`);
healthErrors.forEach(h => console.log(`  ${h.serviceName}: ${h.status} (${h.count}x) - ${h.errorMessage?.slice(0, 50) || 'no error'}`));

await conn.end();
console.log("\n=== INVESTIGATION COMPLETE ===");
