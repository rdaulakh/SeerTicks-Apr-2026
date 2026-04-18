/**
 * Production Database Configuration
 * Based on PRODUCTION.md requirements
 * 
 * Features:
 * - Connection pooling with configurable limits
 * - SSL/TLS enforcement
 * - Connection timeout and retry logic
 * - Health checks
 */

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: {
    rejectUnauthorized: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };
  connectionLimit?: number;
  queueLimit?: number;
  waitForConnections?: boolean;
  connectTimeout?: number;
  enableKeepAlive?: boolean;
  keepAliveInitialDelay?: number;
}

/**
 * Recommended production database configuration
 */
export const productionDatabaseConfig: Partial<DatabaseConfig> = {
  // Connection pooling
  connectionLimit: 10,          // Max connections per instance
  queueLimit: 0,                // Unlimited queue
  waitForConnections: true,     // Wait when pool is full
  connectTimeout: 10000,        // 10 second timeout
  
  // Keep-alive settings
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000, // 10 seconds
  
  // SSL/TLS enforcement
  ssl: {
    rejectUnauthorized: true,   // Enforce SSL certificate validation
  },
};

/**
 * Create production database connection pool
 */
export async function createProductionDatabasePool(databaseUrl: string) {
  // Parse DATABASE_URL
  const url = new URL(databaseUrl);
  
  const config: DatabaseConfig = {
    host: url.hostname,
    port: parseInt(url.port) || 3306,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1), // Remove leading /
    ...productionDatabaseConfig,
  };

  // Create connection pool
  const pool = mysql.createPool(config);

  // Test connection
  try {
    const connection = await pool.getConnection();
    console.log('[Database] ✅ Production connection pool created successfully');
    connection.release();
  } catch (error) {
    console.error('[Database] ❌ Failed to create connection pool:', error);
    throw error;
  }

  return pool;
}

/**
 * Health check for database connection
 */
export async function checkDatabaseHealth(pool: mysql.Pool): Promise<{
  healthy: boolean;
  latency: number;
  error?: string;
}> {
  const startTime = Date.now();
  
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    
    const latency = Date.now() - startTime;
    
    return {
      healthy: true,
      latency,
    };
  } catch (error: any) {
    return {
      healthy: false,
      latency: Date.now() - startTime,
      error: error.message,
    };
  }
}

/**
 * Get connection pool statistics
 */
export function getPoolStats(pool: mysql.Pool): {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  queuedRequests: number;
} {
  const poolStats = (pool as any).pool;
  
  return {
    totalConnections: poolStats._allConnections?.length || 0,
    activeConnections: poolStats._acquiringConnections?.length || 0,
    idleConnections: poolStats._freeConnections?.length || 0,
    queuedRequests: poolStats._connectionQueue?.length || 0,
  };
}

/**
 * Gracefully close database connection pool
 */
export async function closeDatabasePool(pool: mysql.Pool): Promise<void> {
  console.log('[Database] Closing connection pool...');
  
  try {
    await pool.end();
    console.log('[Database] ✅ Connection pool closed successfully');
  } catch (error) {
    console.error('[Database] ❌ Error closing connection pool:', error);
    throw error;
  }
}
