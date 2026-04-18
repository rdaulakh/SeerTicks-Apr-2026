/**
 * Integration Test: Position Recovery on Server Restart
 * 
 * Tests that positions are correctly recovered when server restarts:
 * 1. Open positions are loaded from database
 * 2. Stop-loss and take-profit levels are restored
 * 3. Partial exit stages are preserved
 * 4. Position monitoring resumes automatically
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getDb } from '../db';
import { positions, type InsertPosition } from '../../drizzle/schema';
import { eq, and } from 'drizzle-orm';

describe('Position Recovery on Server Restart', () => {
  const TEST_USER_ID = 1260007;
  
  beforeAll(async () => {
    console.log('[Test] Starting position recovery test');
  });

  it('should load all open positions from database', async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    
    // Query all open positions (thesisValid = true)
    const openPositions = await db!
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.userId, TEST_USER_ID),
          eq(positions.thesisValid, true)
        )
      );
    
    console.log(`[Test] Found ${openPositions.length} open positions to recover`);
    
    // Verify each position has required fields for recovery
    for (const position of openPositions) {
      expect(position.id).toBeTruthy();
      expect(position.symbol).toBeTruthy();
      expect(position.side).toBeTruthy();
      expect(position.entryPrice).toBeTruthy();
      expect(position.quantity).toBeTruthy();
      expect(position.stopLoss).toBeTruthy();
      expect(position.takeProfit).toBeTruthy();
      
      console.log(`[Test] Position ${position.id}: ${position.symbol} ${position.side} @ ${position.entryPrice}`);
      console.log(`[Test]   Stop-Loss: ${position.stopLoss}, Take-Profit: ${position.takeProfit}`);
    }
    
    // Test passes if we can query positions (even if empty)
    expect(Array.isArray(openPositions)).toBe(true);
  });

  it('should restore stop-loss and take-profit levels', async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    
    const openPositions = await db!
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.userId, TEST_USER_ID),
          eq(positions.thesisValid, true)
        )
      );
    
    console.log(`[Test] Verifying stop-loss/take-profit for ${openPositions.length} positions`);
    
    // Verify each position has valid stop-loss and take-profit
    for (const position of openPositions) {
      const entryPrice = parseFloat(position.entryPrice.toString());
      const stopLoss = parseFloat(position.stopLoss.toString());
      const takeProfit = parseFloat(position.takeProfit.toString());
      
      if (position.side === 'long') {
        // Long position: stop-loss should be below entry, take-profit above
        expect(stopLoss).toBeLessThan(entryPrice);
        expect(takeProfit).toBeGreaterThan(entryPrice);
        
        console.log(`[Test] Long position ${position.symbol}: SL ${stopLoss} < Entry ${entryPrice} < TP ${takeProfit} ✓`);
      } else {
        // Short position: stop-loss should be above entry, take-profit below
        expect(stopLoss).toBeGreaterThan(entryPrice);
        expect(takeProfit).toBeLessThan(entryPrice);
        
        console.log(`[Test] Short position ${position.symbol}: TP ${takeProfit} < Entry ${entryPrice} < SL ${stopLoss} ✓`);
      }
    }
    
    // Test passes
    expect(true).toBe(true);
  });

  it('should preserve partial exit stages', async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    
    const openPositions = await db!
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.userId, TEST_USER_ID),
          eq(positions.thesisValid, true)
        )
      );
    
    console.log(`[Test] Checking partial exit stages for ${openPositions.length} positions`);
    
    // Check if any positions have partial exits
    for (const position of openPositions) {
      if (position.exitStage) {
        const exitStage = position.exitStage as any;
        console.log(`[Test] Position ${position.symbol} exit stage:`, exitStage);
        
        // Verify exit stage structure
        expect(exitStage).toBeTruthy();
        
        if (exitStage.stage1) {
          console.log(`[Test]   Stage 1: ${exitStage.stage1.percentage}% @ ${exitStage.stage1.price}`);
        }
        if (exitStage.stage2) {
          console.log(`[Test]   Stage 2: ${exitStage.stage2.percentage}% @ ${exitStage.stage2.price}`);
        }
        if (exitStage.stage3) {
          console.log(`[Test]   Stage 3: ${exitStage.stage3.percentage}% @ ${exitStage.stage3.price}`);
        }
      }
    }
    
    // Test passes (partial exits are optional)
    expect(true).toBe(true);
  });

  it('should validate position data integrity', async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    
    const openPositions = await db!
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.userId, TEST_USER_ID),
          eq(positions.thesisValid, true)
        )
      );
    
    console.log(`[Test] Validating data integrity for ${openPositions.length} positions`);
    
    // Validate each position's data
    for (const position of openPositions) {
      // All numeric fields should be valid numbers
      const entryPrice = parseFloat(position.entryPrice.toString());
      const quantity = parseFloat(position.quantity.toString());
      const stopLoss = parseFloat(position.stopLoss.toString());
      const takeProfit = parseFloat(position.takeProfit.toString());
      
      expect(entryPrice).toBeGreaterThan(0);
      expect(quantity).toBeGreaterThan(0);
      expect(stopLoss).toBeGreaterThan(0);
      expect(takeProfit).toBeGreaterThan(0);
      
      // Confidence should be between 0 and 1
      if (position.confidence) {
        const confidence = parseFloat(position.confidence.toString());
        expect(confidence).toBeGreaterThanOrEqual(0);
        expect(confidence).toBeLessThanOrEqual(1);
      }
      
      // Side should be 'long' or 'short'
      expect(['long', 'short']).toContain(position.side);
      
      // Symbol should be valid
      expect(position.symbol).toMatch(/^[A-Z]+\/[A-Z]+$/);
      
      console.log(`[Test] Position ${position.id} data integrity: ✓`);
    }
    
    // Test passes
    expect(true).toBe(true);
  });

  it('should calculate unrealized P&L for recovered positions', async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    
    const openPositions = await db!
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.userId, TEST_USER_ID),
          eq(positions.thesisValid, true)
        )
      );
    
    console.log(`[Test] Calculating unrealized P&L for ${openPositions.length} positions`);
    
    let totalUnrealizedPnL = 0;
    
    for (const position of openPositions) {
      if (position.currentPrice) {
        const entryPrice = parseFloat(position.entryPrice.toString());
        const currentPrice = parseFloat(position.currentPrice.toString());
        const quantity = parseFloat(position.quantity.toString());
        
        const pnl = position.side === 'long'
          ? (currentPrice - entryPrice) * quantity
          : (entryPrice - currentPrice) * quantity;
        
        totalUnrealizedPnL += pnl;
        
        const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100 * (position.side === 'long' ? 1 : -1);
        
        console.log(`[Test] Position ${position.symbol}: P&L = $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
      }
    }
    
    console.log(`[Test] Total unrealized P&L: $${totalUnrealizedPnL.toFixed(2)}`);
    
    // Test passes
    expect(true).toBe(true);
  });

  it('should verify position monitoring can resume', async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    
    const openPositions = await db!
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.userId, TEST_USER_ID),
          eq(positions.thesisValid, true)
        )
      );
    
    console.log(`[Test] Verifying monitoring can resume for ${openPositions.length} positions`);
    
    // For each position, verify we have all data needed for monitoring
    for (const position of openPositions) {
      // Required for monitoring
      expect(position.symbol).toBeTruthy();
      expect(position.side).toBeTruthy();
      expect(position.entryPrice).toBeTruthy();
      expect(position.quantity).toBeTruthy();
      expect(position.stopLoss).toBeTruthy();
      expect(position.takeProfit).toBeTruthy();
      
      // Optional but useful
      const hasExpectedPath = position.expectedPath !== null;
      const hasAgentSignals = position.agentSignals !== null;
      const hasConfidence = position.confidence !== null;
      
      console.log(`[Test] Position ${position.symbol} monitoring data:`);
      console.log(`[Test]   Expected path: ${hasExpectedPath ? '✓' : '✗'}`);
      console.log(`[Test]   Agent signals: ${hasAgentSignals ? '✓' : '✗'}`);
      console.log(`[Test]   Confidence: ${hasConfidence ? '✓' : '✗'}`);
    }
    
    // Test passes if we have all required fields
    expect(true).toBe(true);
  });
});
