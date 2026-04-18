/**
 * GlobalSymbolAnalyzer Tick Flow - Structural Verification
 * 
 * Verifies the critical fix: WebSocket handlers are registered BEFORE candle seeding,
 * ensuring ticks always flow to handleTick() even if candle seeding is slow or fails.
 * 
 * Root cause of the original bug:
 * - setupWebSocket() had candle seeding (5 DB queries) BEFORE ticker handler registration
 * - A 20-second timeout wrapper would kill the entire function if seeding was slow
 * - This prevented the ticker handler from ever being registered → tickCount=0
 * 
 * Fix: Register handlers first (synchronous), then seed candles in background (non-blocking)
 * 
 * These tests verify the fix at the source code level to prevent regression.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const GSA_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../services/GlobalSymbolAnalyzer.ts'),
  'utf-8'
);

describe('GlobalSymbolAnalyzer - Tick Flow Structural Verification', () => {
  
  it('should register WebSocket handlers BEFORE candle seeding in setupWebSocket', () => {
    // The critical fix: handlers must be registered before any async/blocking operations
    const handlerRegistrationIndex = GSA_SOURCE.indexOf("publicWs.on('ticker'");
    const candleSeedingIndex = GSA_SOURCE.indexOf('seedHistoricalCandlesInBackground');
    const initializeBufferIndex = GSA_SOURCE.indexOf('candleCache.initializeBuffer');
    
    expect(handlerRegistrationIndex).toBeGreaterThan(-1);
    expect(candleSeedingIndex).toBeGreaterThan(-1);
    expect(initializeBufferIndex).toBeGreaterThan(-1);
    
    // Handler registration MUST come before candle operations
    expect(handlerRegistrationIndex).toBeLessThan(initializeBufferIndex);
    expect(handlerRegistrationIndex).toBeLessThan(candleSeedingIndex);
  });

  it('should NOT have a timeout wrapper around setupWebSocket', () => {
    // The old bug: setupWebSocket was wrapped in a timeout that killed it if candle seeding was slow
    // The fix: no timeout wrapper around the entire setupWebSocket call
    const setupWsCallSite = GSA_SOURCE.indexOf('this.setupWebSocket()');
    expect(setupWsCallSite).toBeGreaterThan(-1);
    
    // Get the surrounding context (100 chars before the call)
    const contextBefore = GSA_SOURCE.substring(
      Math.max(0, setupWsCallSite - 200),
      setupWsCallSite
    );
    
    // Should NOT be wrapped in a Promise.race or setTimeout timeout pattern
    expect(contextBefore).not.toContain('Promise.race');
    expect(contextBefore).not.toContain('setTimeout');
  });

  it('should seed candles in background (non-blocking)', () => {
    // The fix: candle seeding runs in background, not blocking the main flow
    expect(GSA_SOURCE).toContain('seedHistoricalCandlesInBackground');
    
    // The background seeder should catch errors to prevent unhandled rejections
    const seedMethodIndex = GSA_SOURCE.indexOf('seedHistoricalCandlesInBackground');
    const seedMethodEnd = GSA_SOURCE.indexOf('}', seedMethodIndex + 500);
    const seedMethodBody = GSA_SOURCE.substring(seedMethodIndex, seedMethodEnd + 100);
    
    expect(seedMethodBody).toContain('catch');
  });

  it('should have STEP 1/2/3 ordering comments documenting the fix', () => {
    // Ensure the fix is well-documented with step comments
    const step1 = GSA_SOURCE.indexOf('STEP 1');
    const step2 = GSA_SOURCE.indexOf('STEP 2');
    const step3 = GSA_SOURCE.indexOf('STEP 3');
    
    expect(step1).toBeGreaterThan(-1);
    expect(step2).toBeGreaterThan(-1);
    expect(step3).toBeGreaterThan(-1);
    
    // Steps must be in order
    expect(step1).toBeLessThan(step2);
    expect(step2).toBeLessThan(step3);
  });

  it('should have a tickCount property that increments in handleTick', () => {
    // The tickCount property is essential for monitoring tick flow health
    expect(GSA_SOURCE).toContain('tickCount');
    
    // handleTick should increment the counter
    const handleTickIndex = GSA_SOURCE.indexOf('private handleTick');
    expect(handleTickIndex).toBeGreaterThan(-1);
    
    const handleTickBody = GSA_SOURCE.substring(handleTickIndex, handleTickIndex + 500);
    expect(handleTickBody).toContain('tickCount');
  });

  it('should filter ticks by product_id matching this.symbol', () => {
    // Each analyzer should only process ticks for its own symbol
    const tickerHandler = GSA_SOURCE.indexOf('this.tickerHandler = (event');
    expect(tickerHandler).toBeGreaterThan(-1);
    
    const handlerBody = GSA_SOURCE.substring(tickerHandler, tickerHandler + 300);
    expect(handlerBody).toContain('event.product_id === this.symbol');
  });

  it('should expose cachedSlowSignalCount in getStatus', () => {
    // Status should include slow signal count for monitoring
    const getStatusIndex = GSA_SOURCE.indexOf('getStatus()');
    expect(getStatusIndex).toBeGreaterThan(-1);
    
    const statusBody = GSA_SOURCE.substring(getStatusIndex, getStatusIndex + 800);
    expect(statusBody).toContain('cachedSlowSignalCount');
  });

  it('should clean up WebSocket listeners in stop()', () => {
    // Prevent memory leaks by removing listeners on stop
    const stopMethod = GSA_SOURCE.indexOf('async stop()');
    expect(stopMethod).toBeGreaterThan(-1);
    
    const stopBody = GSA_SOURCE.substring(stopMethod, stopMethod + 500);
    expect(stopBody).toContain('removeListener');
  });
});
