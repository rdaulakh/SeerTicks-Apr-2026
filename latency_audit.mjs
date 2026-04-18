import mysql from 'mysql2/promise';
const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log('='.repeat(80));
console.log('LATENCY & MILLISECOND-LEVEL OPERATIONS AUDIT');
console.log('='.repeat(80));

// Check execution latency logs schema first
console.log('\n=== EXECUTION LATENCY LOGS SCHEMA ===');
try {
  const [columns] = await connection.execute(`DESCRIBE executionLatencyLogs`);
  console.log('Columns:');
  for (const col of columns) {
    console.log(`  ${col.Field}: ${col.Type}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check trade decision logs for latency data
console.log('\n=== TRADE DECISION LOGS (Recent) ===');
try {
  const [logs] = await connection.execute(`
    SELECT * FROM tradeDecisionLogs 
    ORDER BY id DESC 
    LIMIT 10
  `);
  console.log(`Recent trade decisions: ${logs.length}`);
  for (const log of logs) {
    console.log(`  ID ${log.id}: symbol=${log.symbol}, decision=${log.decision}, confidence=${log.confidence}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check automated trade log for execution times
console.log('\n=== AUTOMATED TRADE LOG (Recent) ===');
try {
  const [trades] = await connection.execute(`
    SELECT * FROM automatedTradeLog 
    ORDER BY id DESC 
    LIMIT 10
  `);
  console.log(`Recent automated trades: ${trades.length}`);
  for (const t of trades) {
    console.log(`  ID ${t.id}: ${t.symbol} ${t.action} @ ${t.price}, status=${t.status}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check system logs for performance data
console.log('\n=== SYSTEM LOGS (Warnings/Errors) ===');
try {
  const [logs] = await connection.execute(`
    SELECT * FROM systemLogs 
    WHERE level IN ('warn', 'error') 
    ORDER BY id DESC 
    LIMIT 10
  `);
  console.log(`Recent warnings/errors: ${logs.length}`);
  for (const log of logs) {
    const msg = log.message || '';
    console.log(`  [${log.level}] ${log.component}: ${msg.substring(0, 80)}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check tick processing latency (time between ticks)
console.log('\n=== TICK SCHEMA ===');
try {
  const [tickSchema] = await connection.execute(`DESCRIBE ticks`);
  console.log('Ticks table columns:');
  for (const col of tickSchema) {
    console.log(`  ${col.Field}: ${col.Type}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check service health response times
console.log('\n=== SERVICE HEALTH HISTORY SCHEMA ===');
try {
  const [schema] = await connection.execute(`DESCRIBE serviceHealthHistory`);
  console.log('ServiceHealthHistory columns:');
  for (const col of schema) {
    console.log(`  ${col.Field}: ${col.Type}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check service response times with correct column names
console.log('\n=== SERVICE RESPONSE TIMES ===');
try {
  const [health] = await connection.execute(`
    SELECT serviceName, 
           AVG(responseTime) as avgResponse,
           MAX(responseTime) as maxResponse,
           MIN(responseTime) as minResponse,
           COUNT(*) as samples
    FROM serviceHealthHistory
    GROUP BY serviceName
  `);
  console.log('Service response times:');
  for (const h of health) {
    const avg = typeof h.avgResponse === 'number' ? h.avgResponse.toFixed(0) : 'N/A';
    console.log(`  ${h.serviceName}: avg=${avg}ms, max=${h.maxResponse}ms, min=${h.minResponse}ms (${h.samples} samples)`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check for latency-related configuration
console.log('\n=== LATENCY CONFIGURATION ===');
try {
  const [config] = await connection.execute(`SELECT * FROM systemConfig`);
  console.log(`System configs: ${config.length}`);
  for (const c of config) {
    if (c.configKey && (c.configKey.toLowerCase().includes('latency') || 
        c.configKey.toLowerCase().includes('timeout') || 
        c.configKey.toLowerCase().includes('interval'))) {
      console.log(`  ${c.configKey}: ${c.configValue}`);
    }
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

await connection.end();
