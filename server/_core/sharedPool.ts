/**
 * Shared Database Connection Pool
 * 
 * Single connection pool shared across all modules to prevent
 * connection exhaustion on TiDB Cloud free tier.
 */

import mysql from "mysql2/promise";

let sharedPool: mysql.Pool | null = null;

export function getSharedPool(): mysql.Pool {
  if (!sharedPool) {
    // Parse DATABASE_URL to extract connection details
    const dbUrl = process.env.DATABASE_URL || '';
    const parsed = new URL(dbUrl);

    // SSL is opt-in via `?ssl=...` query param (JSON or truthy).
    // RDS inside the VPC is reached over private network — TLS optional.
    const sslParam = parsed.searchParams.get('ssl');
    let ssl: any = false;
    if (sslParam) {
      try {
        ssl = JSON.parse(sslParam);
      } catch {
        ssl = { rejectUnauthorized: true };
      }
    }

    sharedPool = mysql.createPool({
      host: parsed.hostname,
      port: parseInt(parsed.port) || 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.slice(1),
      ssl,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 100,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: 30000,
    });
    console.log('[SharedPool] Created shared database connection pool (ssl=' + !!ssl + ')');
  }
  return sharedPool;
}

export async function closeSharedPool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
    console.log('[SharedPool] Closed shared database connection pool');
  }
}
