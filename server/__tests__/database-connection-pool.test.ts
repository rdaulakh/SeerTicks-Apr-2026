/**
 * Database Connection Pool Tests
 * Tests for connection pool configuration, retry logic, and leak detection
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb, getPoolStats, closeDb } from '../db';
import { withDatabaseRetry, DatabaseRetryPresets } from '../utils/DatabaseRetry';
import { connectionLeakDetector } from '../utils/ConnectionLeakDetector';

describe('Database Connection Pool', () => {
  beforeAll(async () => {
    // Ensure database is initialized
    await getDb();
  });

  afterAll(async () => {
    // Clean up connection pool
    await closeDb();
  });

  it('should initialize database connection pool', async () => {
    const db = await getDb();
    expect(db).toBeDefined();
    expect(db).not.toBeNull();
  });

  it('should provide connection pool statistics', () => {
    const stats = getPoolStats();
    expect(stats).toBeDefined();
    
    if (stats) {
      expect(stats).toHaveProperty('totalConnections');
      expect(stats).toHaveProperty('freeConnections');
      expect(stats).toHaveProperty('queuedRequests');
      
      // Validate stats are numbers
      expect(typeof stats.totalConnections).toBe('number');
      expect(typeof stats.freeConnections).toBe('number');
      expect(typeof stats.queuedRequests).toBe('number');
      
      // Validate reasonable values
      expect(stats.totalConnections).toBeGreaterThanOrEqual(0);
      expect(stats.totalConnections).toBeLessThanOrEqual(10); // connectionLimit
      expect(stats.freeConnections).toBeGreaterThanOrEqual(0);
      expect(stats.freeConnections).toBeLessThanOrEqual(stats.totalConnections);
    }
  });

  it('should execute simple query successfully', async () => {
    const db = await getDb();
    expect(db).toBeDefined();
    
    if (db) {
      // Execute a simple query to verify connection works
      const result = await db.execute('SELECT 1 as test');
      expect(result).toBeDefined();
    }
  });

  it('should handle multiple concurrent queries', async () => {
    const db = await getDb();
    expect(db).toBeDefined();
    
    if (db) {
      // Execute 5 concurrent queries
      const promises = Array.from({ length: 5 }, (_, i) => 
        db.execute(`SELECT ${i + 1} as test`)
      );
      
      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result).toBeDefined();
      });
    }
  });

  it('should retry failed operations with exponential backoff', async () => {
    let attemptCount = 0;
    
    // Simulate operation that fails twice then succeeds
    const operation = async () => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error('Connection lost'); // Retryable error
      }
      return 'success';
    };
    
    const result = await withDatabaseRetry(
      operation,
      DatabaseRetryPresets.FAST,
      'testRetry'
    );
    
    expect(result).toBe('success');
    expect(attemptCount).toBe(3);
  });

  it('should not retry non-retryable errors', async () => {
    let attemptCount = 0;
    
    // Simulate operation with non-retryable error
    const operation = async () => {
      attemptCount++;
      throw new Error('Syntax error in SQL'); // Non-retryable error
    };
    
    await expect(
      withDatabaseRetry(operation, DatabaseRetryPresets.FAST, 'testNonRetryable')
    ).rejects.toThrow('Syntax error in SQL');
    
    // Should only attempt once
    expect(attemptCount).toBe(1);
  });

  it('should respect max retry attempts', async () => {
    let attemptCount = 0;
    
    // Simulate operation that always fails
    const operation = async () => {
      attemptCount++;
      throw new Error('Connection lost'); // Retryable error
    };
    
    await expect(
      withDatabaseRetry(
        operation,
        { ...DatabaseRetryPresets.FAST, maxAttempts: 3 },
        'testMaxRetries'
      )
    ).rejects.toThrow('Connection lost');
    
    // Should attempt exactly 3 times
    expect(attemptCount).toBe(3);
  });

  it('should track connection leak detector statistics', () => {
    const stats = connectionLeakDetector.getStats();
    
    expect(stats).toBeDefined();
    expect(stats).toHaveProperty('activeConnections');
    expect(stats).toHaveProperty('totalAcquired');
    expect(stats).toHaveProperty('totalReleased');
    expect(stats).toHaveProperty('totalLeaksDetected');
    expect(stats).toHaveProperty('potentialLeaks');
    
    // Validate stats are numbers
    expect(typeof stats.activeConnections).toBe('number');
    expect(typeof stats.totalAcquired).toBe('number');
    expect(typeof stats.totalReleased).toBe('number');
    expect(typeof stats.totalLeaksDetected).toBe('number');
    expect(typeof stats.potentialLeaks).toBe('number');
  });

  it('should handle connection pool exhaustion gracefully', async () => {
    const db = await getDb();
    expect(db).toBeDefined();
    
    if (db) {
      // Try to execute more queries than connection limit (10)
      // This should queue requests and handle them gracefully
      const promises = Array.from({ length: 15 }, (_, i) => 
        db.execute(`SELECT ${i + 1} as test`)
      );
      
      const results = await Promise.all(promises);
      expect(results).toHaveLength(15);
      
      // All queries should complete successfully
      results.forEach(result => {
        expect(result).toBeDefined();
      });
    }
  }, 30000); // 30 second timeout for this test

  it('should maintain connection pool health under load', async () => {
    const db = await getDb();
    expect(db).toBeDefined();
    
    if (db) {
      // Execute 20 queries in batches
      for (let batch = 0; batch < 4; batch++) {
        const promises = Array.from({ length: 5 }, (_, i) => 
          db.execute(`SELECT ${batch * 5 + i + 1} as test`)
        );
        
        await Promise.all(promises);
        
        // Check pool stats after each batch
        const stats = getPoolStats();
        if (stats) {
          expect(stats.totalConnections).toBeLessThanOrEqual(10);
          expect(stats.freeConnections).toBeGreaterThanOrEqual(0);
        }
      }
    }
  }, 30000); // 30 second timeout for this test
});

describe('Database Retry Logic', () => {
  it('should use FAST preset for lightweight operations', async () => {
    const startTime = Date.now();
    let attemptCount = 0;
    
    const operation = async () => {
      attemptCount++;
      if (attemptCount < 2) {
        throw new Error('ETIMEDOUT');
      }
      return 'success';
    };
    
    const result = await withDatabaseRetry(
      operation,
      DatabaseRetryPresets.FAST,
      'testFastPreset'
    );
    
    const duration = Date.now() - startTime;
    
    expect(result).toBe('success');
    expect(attemptCount).toBe(2);
    // FAST preset should complete quickly (< 500ms for 1 retry)
    expect(duration).toBeLessThan(1000);
  });

  it('should use STANDARD preset for most operations', async () => {
    let attemptCount = 0;
    
    const operation = async () => {
      attemptCount++;
      if (attemptCount < 2) {
        throw new Error('Connection lost');
      }
      return 'success';
    };
    
    const result = await withDatabaseRetry(
      operation,
      DatabaseRetryPresets.STANDARD,
      'testStandardPreset'
    );
    
    expect(result).toBe('success');
    expect(attemptCount).toBe(2);
  });

  it('should use AGGRESSIVE preset for critical operations', async () => {
    let attemptCount = 0;
    
    const operation = async () => {
      attemptCount++;
      if (attemptCount < 4) {
        throw new Error('Too many connections');
      }
      return 'success';
    };
    
    const result = await withDatabaseRetry(
      operation,
      DatabaseRetryPresets.AGGRESSIVE,
      'testAggressivePreset'
    );
    
    expect(result).toBe('success');
    expect(attemptCount).toBe(4);
  });

  it('should apply exponential backoff correctly', async () => {
    const delays: number[] = [];
    let attemptCount = 0;
    let lastTime = Date.now();
    
    const operation = async () => {
      const now = Date.now();
      if (attemptCount > 0) {
        delays.push(now - lastTime);
      }
      lastTime = now;
      attemptCount++;
      
      if (attemptCount < 3) {
        throw new Error('ECONNREFUSED');
      }
      return 'success';
    };
    
    await withDatabaseRetry(
      operation,
      { 
        maxAttempts: 3, 
        initialDelayMs: 100, 
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        jitter: false, // Disable jitter for predictable testing
      },
      'testExponentialBackoff'
    );
    
    expect(delays).toHaveLength(2);
    // First delay should be ~100ms, second should be ~200ms (2x)
    expect(delays[0]).toBeGreaterThanOrEqual(90);
    expect(delays[0]).toBeLessThanOrEqual(150);
    expect(delays[1]).toBeGreaterThanOrEqual(180);
    expect(delays[1]).toBeLessThanOrEqual(250);
  });
});
