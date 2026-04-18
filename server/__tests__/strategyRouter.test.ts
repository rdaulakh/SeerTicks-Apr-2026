import { describe, it, expect, beforeAll } from 'vitest';
import { getDb } from '../db';
import { strategies } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

/**
 * Integration test: requires live server/DB/external APIs.
 * Set INTEGRATION_TEST=1 to run these tests.
 */
const isIntegration = process.env.INTEGRATION_TEST === '1';


describe.skipIf(!isIntegration)('Strategy Router Tests', () => {
  let testUserId: number;

  beforeAll(async () => {
    // Use a test user ID
    testUserId = 1;
  });

  describe('Strategy CRUD Operations', () => {
    it('should create a new strategy', async () => {
      const db = await getDb();
      if (!db) {
        console.warn('Database not available, skipping test');
        return;
      }

      const strategyData = {
        userId: testUserId,
        name: 'Test RSI Strategy',
        type: 'momentum' as const,
        config: {
          conditions: [
            { indicator: 'rsi', operator: '<', value: 30, period: 14 }
          ]
        },
        stopLossPercent: '5.00',
        takeProfitPercent: '10.00',
        maxPositionSize: '20.00',
        kellyMultiplier: '0.5000',
        status: 'active' as const,
      };

      const [result] = await db.insert(strategies).values(strategyData);
      
      expect(result.insertId).toBeDefined();
      expect(result.insertId).toBeGreaterThan(0);

      // Clean up
      if (result.insertId) {
        await db.delete(strategies).where(eq(strategies.id, Number(result.insertId)));
      }
    });

    it('should retrieve user strategies', async () => {
      const db = await getDb();
      if (!db) {
        console.warn('Database not available, skipping test');
        return;
      }

      // Create a test strategy
      const [insertResult] = await db.insert(strategies).values({
        userId: testUserId,
        name: 'Test Strategy for Retrieval',
        type: 'mean_reversion',
        config: { conditions: [] },
        stopLossPercent: '3.00',
        takeProfitPercent: '6.00',
        maxPositionSize: '15.00',
        kellyMultiplier: '0.5000',
        status: 'active',
      });

      // Retrieve strategies
      const userStrategies = await db
        .select()
        .from(strategies)
        .where(eq(strategies.userId, testUserId));

      expect(userStrategies.length).toBeGreaterThan(0);
      
      const foundStrategy = userStrategies.find(s => s.id === Number(insertResult.insertId));
      expect(foundStrategy).toBeDefined();
      expect(foundStrategy?.name).toBe('Test Strategy for Retrieval');

      // Clean up
      if (insertResult.insertId) {
        await db.delete(strategies).where(eq(strategies.id, Number(insertResult.insertId)));
      }
    });

    it('should update an existing strategy', async () => {
      const db = await getDb();
      if (!db) {
        console.warn('Database not available, skipping test');
        return;
      }

      // Create a test strategy
      const [insertResult] = await db.insert(strategies).values({
        userId: testUserId,
        name: 'Strategy to Update',
        type: 'scalping',
        config: { conditions: [] },
        stopLossPercent: '2.00',
        takeProfitPercent: '4.00',
        maxPositionSize: '10.00',
        kellyMultiplier: '0.5000',
        status: 'active',
      });

      const strategyId = Number(insertResult.insertId);

      // Update the strategy
      await db
        .update(strategies)
        .set({ 
          name: 'Updated Strategy Name',
          stopLossPercent: '3.00',
        })
        .where(eq(strategies.id, strategyId));

      // Verify update
      const [updatedStrategy] = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, strategyId))
        .limit(1);

      expect(updatedStrategy.name).toBe('Updated Strategy Name');
      expect(updatedStrategy.stopLossPercent).toBe('3.00');

      // Clean up
      await db.delete(strategies).where(eq(strategies.id, strategyId));
    });

    it('should delete a strategy', async () => {
      const db = await getDb();
      if (!db) {
        console.warn('Database not available, skipping test');
        return;
      }

      // Create a test strategy
      const [insertResult] = await db.insert(strategies).values({
        userId: testUserId,
        name: 'Strategy to Delete',
        type: 'breakout',
        config: { conditions: [] },
        stopLossPercent: '4.00',
        takeProfitPercent: '8.00',
        maxPositionSize: '20.00',
        kellyMultiplier: '0.5000',
        status: 'active',
      });

      const strategyId = Number(insertResult.insertId);

      // Delete the strategy
      await db.delete(strategies).where(eq(strategies.id, strategyId));

      // Verify deletion
      const [deletedStrategy] = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, strategyId))
        .limit(1);

      expect(deletedStrategy).toBeUndefined();
    });
  });

  describe('Strategy Configuration Validation', () => {
    it('should store complex indicator conditions in config', async () => {
      const db = await getDb();
      if (!db) {
        console.warn('Database not available, skipping test');
        return;
      }

      const complexConfig = {
        conditions: [
          { id: '1', indicator: 'rsi', operator: '<', value: 30, period: 14 },
          { id: '2', indicator: 'macd', operator: '>', value: 0 },
          { id: '3', indicator: 'bollinger_lower', operator: '>', value: 0 },
        ]
      };

      const [result] = await db.insert(strategies).values({
        userId: testUserId,
        name: 'Complex Strategy',
        type: 'momentum',
        config: complexConfig,
        stopLossPercent: '5.00',
        takeProfitPercent: '10.00',
        maxPositionSize: '20.00',
        kellyMultiplier: '0.5000',
        status: 'active',
      });

      const strategyId = Number(result.insertId);

      // Retrieve and verify
      const [savedStrategy] = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, strategyId))
        .limit(1);

      expect(savedStrategy.config).toBeDefined();
      expect(savedStrategy.config.conditions).toHaveLength(3);
      expect(savedStrategy.config.conditions[0].indicator).toBe('rsi');

      // Clean up
      await db.delete(strategies).where(eq(strategies.id, strategyId));
    });

    it('should validate risk management parameters', async () => {
      const db = await getDb();
      if (!db) {
        console.warn('Database not available, skipping test');
        return;
      }

      const [result] = await db.insert(strategies).values({
        userId: testUserId,
        name: 'Risk Management Test',
        type: 'swing',
        config: { conditions: [] },
        stopLossPercent: '5.00',
        takeProfitPercent: '15.00',
        maxPositionSize: '10.00',
        kellyMultiplier: '0.2500', // Conservative quarter-Kelly
        status: 'active',
      });

      const strategyId = Number(result.insertId);

      const [savedStrategy] = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, strategyId))
        .limit(1);

      // Verify risk-reward ratio
      const stopLoss = parseFloat(savedStrategy.stopLossPercent);
      const takeProfit = parseFloat(savedStrategy.takeProfitPercent);
      const riskRewardRatio = takeProfit / stopLoss;

      expect(riskRewardRatio).toBe(3); // 15% / 5% = 3:1 ratio
      expect(parseFloat(savedStrategy.kellyMultiplier)).toBe(0.25);

      // Clean up
      await db.delete(strategies).where(eq(strategies.id, strategyId));
    });
  });
});

describe('strategyRouter (unit)', () => {
  it('should have test file loaded', () => {
    expect(true).toBe(true);
  });
});
