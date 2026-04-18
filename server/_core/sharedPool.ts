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
    
    sharedPool = mysql.createPool({
      uri: dbUrl,
      waitForConnections: true,
      connectionLimit: 5, // Single pool with 5 connections for all auth operations
      queueLimit: 100, // Allow queuing requests
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: 30000,
      // TiDB Cloud requires SSL
      ssl: {
        rejectUnauthorized: true,
      },
    });
    console.log('[SharedPool] Created shared database connection pool with SSL');
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
