import mysql from 'mysql2/promise';
const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log('='.repeat(80));
console.log('API/WEBSOCKET & EXCHANGE INTEGRATION AUDIT');
console.log('='.repeat(80));

// Check exchanges
console.log('\n=== CONFIGURED EXCHANGES ===');
try {
  const [exchanges] = await connection.execute(`SELECT * FROM exchanges`);
  console.log(`Total exchanges: ${exchanges.length}`);
  for (const e of exchanges) {
    console.log(`  ${e.exchangeName}: active=${e.isActive}, status=${e.connectionStatus}, lastConnected=${e.lastConnectedAt}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check exchange settings
console.log('\n=== EXCHANGE SETTINGS ===');
try {
  const [settings] = await connection.execute(`SELECT * FROM exchangeSettings`);
  console.log(`Total settings: ${settings.length}`);
  for (const s of settings) {
    console.log(`  User ${s.userId} - ${s.exchangeName}: enabled=${s.enabled}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check API keys (encrypted)
console.log('\n=== API KEYS (ENCRYPTED) ===');
try {
  const [keys] = await connection.execute(`
    SELECT userId, exchangeId, isActive, createdAt, updatedAt
    FROM apiKeys
  `);
  console.log(`Total API keys: ${keys.length}`);
  for (const k of keys) {
    console.log(`  User ${k.userId} - Exchange ${k.exchangeId}: active=${k.isActive}, created=${k.createdAt}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check external API keys
console.log('\n=== EXTERNAL API KEYS ===');
try {
  const [extKeys] = await connection.execute(`
    SELECT userId, serviceName, isActive, lastUsedAt, createdAt
    FROM externalApiKeys
  `);
  console.log(`Total external keys: ${extKeys.length}`);
  for (const k of extKeys) {
    console.log(`  User ${k.userId} - ${k.serviceName}: active=${k.isActive}, lastUsed=${k.lastUsedAt}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check MetaAPI credentials
console.log('\n=== METAAPI CREDENTIALS ===');
try {
  const [meta] = await connection.execute(`SELECT * FROM metaApiCredentials`);
  console.log(`Total MetaAPI accounts: ${meta.length}`);
  for (const m of meta) {
    console.log(`  User ${m.userId} - Account ${m.accountId}: connected=${m.isConnected}, lastSync=${m.lastSyncAt}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check service health
console.log('\n=== SERVICE HEALTH ===');
try {
  const [health] = await connection.execute(`
    SELECT serviceName, status, lastHeartbeat, errorCount, responseTime
    FROM serviceHealth
    ORDER BY lastHeartbeat DESC
  `);
  console.log(`Total services: ${health.length}`);
  for (const h of health) {
    console.log(`  ${h.serviceName}: status=${h.status}, lastHeartbeat=${h.lastHeartbeat}, errors=${h.errorCount}, responseTime=${h.responseTime}ms`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check service health history
console.log('\n=== SERVICE HEALTH HISTORY (Last 24h) ===');
try {
  const [history] = await connection.execute(`
    SELECT serviceName, 
           COUNT(*) as checks,
           SUM(CASE WHEN status = 'healthy' THEN 1 ELSE 0 END) as healthy,
           SUM(CASE WHEN status = 'degraded' THEN 1 ELSE 0 END) as degraded,
           SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline,
           AVG(responseTime) as avgResponseTime
    FROM serviceHealthHistory
    WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
    GROUP BY serviceName
  `);
  console.log(`Services with history: ${history.length}`);
  for (const h of history) {
    const uptime = h.checks > 0 ? ((h.healthy / h.checks) * 100).toFixed(1) : '0.0';
    console.log(`  ${h.serviceName}: checks=${h.checks}, uptime=${uptime}%, avgResponse=${h.avgResponseTime?.toFixed(0) || 'N/A'}ms`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check tick data freshness
console.log('\n=== TICK DATA FRESHNESS ===');
try {
  const [ticks] = await connection.execute(`
    SELECT symbol, COUNT(*) as count, MAX(timestamp) as lastTick
    FROM ticks
    WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR)
    GROUP BY symbol
  `);
  console.log(`Symbols with recent ticks: ${ticks.length}`);
  for (const t of ticks) {
    console.log(`  ${t.symbol}: ${t.count} ticks in last hour, last=${t.lastTick}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check candle data freshness
console.log('\n=== CANDLE DATA FRESHNESS ===');
try {
  const [candles] = await connection.execute(`
    SELECT symbol, timeframe, COUNT(*) as count, MAX(timestamp) as lastCandle
    FROM candleData
    WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
    GROUP BY symbol, timeframe
    ORDER BY lastCandle DESC
    LIMIT 10
  `);
  console.log(`Recent candle data:`);
  for (const c of candles) {
    console.log(`  ${c.symbol} ${c.timeframe}: ${c.count} candles, last=${c.lastCandle}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check execution latency logs
console.log('\n=== EXECUTION LATENCY LOGS ===');
try {
  const [latency] = await connection.execute(`
    SELECT operationType, 
           COUNT(*) as count,
           AVG(latencyMs) as avgLatency,
           MAX(latencyMs) as maxLatency,
           MIN(latencyMs) as minLatency
    FROM executionLatencyLogs
    WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
    GROUP BY operationType
  `);
  console.log(`Operation types: ${latency.length}`);
  for (const l of latency) {
    console.log(`  ${l.operationType}: count=${l.count}, avg=${l.avgLatency?.toFixed(0)}ms, max=${l.maxLatency}ms, min=${l.minLatency}ms`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

await connection.end();
