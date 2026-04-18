import mysql from 'mysql2/promise';
const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log('='.repeat(80));
console.log('SERVER UPTIME & RELIABILITY SYSTEMS AUDIT');
console.log('='.repeat(80));

// Check system startup log
console.log('\n=== SYSTEM STARTUP LOG (Last 30 days) ===');
try {
  const [startups] = await connection.execute(`
    SELECT * FROM systemStartupLog 
    ORDER BY id DESC 
    LIMIT 20
  `);
  console.log(`Recent startups: ${startups.length}`);
  for (const s of startups) {
    console.log(`  ${s.startedAt}: ${s.startupType} - ${s.status} (took ${s.startupDurationMs}ms)`);
  }
  
  // Count restarts in last 7 days
  const [restartCount] = await connection.execute(`
    SELECT COUNT(*) as cnt FROM systemStartupLog 
    WHERE startedAt > DATE_SUB(NOW(), INTERVAL 7 DAY)
  `);
  console.log(`\nRestarts in last 7 days: ${restartCount[0].cnt}`);
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check engine state persistence
console.log('\n=== ENGINE STATE PERSISTENCE ===');
try {
  const [engines] = await connection.execute(`SELECT * FROM engineState`);
  console.log(`Engine states: ${engines.length}`);
  for (const e of engines) {
    console.log(`  User ${e.userId}: running=${e.isRunning}, started=${e.startedAt}, updated=${e.updatedAt}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check system state
console.log('\n=== SYSTEM STATE ===');
try {
  const [state] = await connection.execute(`SELECT * FROM systemState`);
  console.log(`System state records: ${state.length}`);
  for (const s of state) {
    console.log(`  ${s.stateKey}: ${s.stateValue} (updated: ${s.updatedAt})`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check system health
console.log('\n=== SYSTEM HEALTH ===');
try {
  const [health] = await connection.execute(`SELECT * FROM systemHealth ORDER BY id DESC LIMIT 5`);
  console.log(`Recent health records: ${health.length}`);
  for (const h of health) {
    console.log(`  ${h.checkedAt}: CPU=${h.cpuUsage}%, Memory=${h.memoryUsage}%, status=${h.overallStatus}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check service health summary
console.log('\n=== SERVICE HEALTH SUMMARY ===');
try {
  const [services] = await connection.execute(`SELECT * FROM serviceHealth`);
  console.log(`Services monitored: ${services.length}`);
  for (const s of services) {
    console.log(`  ${s.serviceName}: status=${s.status}, errors=${s.errorCount}, lastCheck=${s.lastCheckedAt}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check for error patterns in service health history
console.log('\n=== SERVICE DOWNTIME ANALYSIS (Last 7 days) ===');
try {
  const [downtime] = await connection.execute(`
    SELECT serviceName, 
           SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) as downCount,
           SUM(CASE WHEN status = 'degraded' THEN 1 ELSE 0 END) as degradedCount,
           SUM(CASE WHEN status = 'healthy' THEN 1 ELSE 0 END) as healthyCount,
           COUNT(*) as totalChecks
    FROM serviceHealthHistory
    WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY serviceName
  `);
  console.log('Service availability:');
  for (const d of downtime) {
    const uptime = d.totalChecks > 0 ? ((d.healthyCount / d.totalChecks) * 100).toFixed(2) : '0.00';
    console.log(`  ${d.serviceName}: ${uptime}% uptime (down=${d.downCount}, degraded=${d.degradedCount}, healthy=${d.healthyCount})`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check risk events
console.log('\n=== RISK EVENTS (Last 7 days) ===');
try {
  const [risks] = await connection.execute(`
    SELECT * FROM riskEvents 
    ORDER BY id DESC 
    LIMIT 10
  `);
  console.log(`Recent risk events: ${risks.length}`);
  for (const r of risks) {
    console.log(`  ${r.eventType}: ${r.severity} - ${r.description?.substring(0, 60)}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check risk limit breaches
console.log('\n=== RISK LIMIT BREACHES ===');
try {
  const [breaches] = await connection.execute(`
    SELECT * FROM riskLimitBreaches 
    ORDER BY id DESC 
    LIMIT 10
  `);
  console.log(`Recent breaches: ${breaches.length}`);
  for (const b of breaches) {
    console.log(`  ${b.limitType}: value=${b.actualValue} > limit=${b.limitValue}, action=${b.actionTaken}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check pipeline status
console.log('\n=== PIPELINE STATUS ===');
try {
  const [pipelines] = await connection.execute(`SELECT * FROM pipelineStatus`);
  console.log(`Pipelines: ${pipelines.length}`);
  for (const p of pipelines) {
    console.log(`  ${p.pipelineName}: status=${p.status}, lastRun=${p.lastRunAt}, nextRun=${p.nextRunAt}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check data ingestion jobs
console.log('\n=== DATA INGESTION JOBS ===');
try {
  const [jobs] = await connection.execute(`SELECT * FROM dataIngestionJobs ORDER BY id DESC LIMIT 10`);
  console.log(`Recent jobs: ${jobs.length}`);
  for (const j of jobs) {
    console.log(`  ${j.jobType}: status=${j.status}, records=${j.recordsProcessed}, errors=${j.errorCount}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

await connection.end();
