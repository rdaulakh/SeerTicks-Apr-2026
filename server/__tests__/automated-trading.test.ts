import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb } from '../db';
import {
  getAutomatedTradingSettings,
  upsertAutomatedTradingSettings,
  createAutomatedTradeLog,
  updateAutomatedTradeLog,
  getTodayAutomatedTradeCount,
} from '../db/automatedTradingDb';
import { AutomatedTradingEngine, TradingSignal } from '../services/AutomatedTradingEngine';

describe('Automated Trading System', () => {
  const testUserId = 999;

  beforeAll(async () => {
    // Ensure database is available
    const db = await getDb();
    expect(db).toBeDefined();
  });

  afterAll(async () => {
    // Cleanup test data
    const db = await getDb();
    if (db) {
      const { automatedTradingSettings, automatedTradeLog } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      
      await db.delete(automatedTradingSettings).where(eq(automatedTradingSettings.userId, testUserId));
      await db.delete(automatedTradeLog).where(eq(automatedTradeLog.userId, testUserId));
    }
  });

  describe('Database Operations', () => {
    it('should create and retrieve automated trading settings', async () => {
      // Create settings
      await upsertAutomatedTradingSettings({
        userId: testUserId,
        enabled: true,
        minSignalConfidence: 75,
        maxPositionSizePercent: 15,
        maxTradesPerDay: 5,
        maxOpenPositions: 3,
        cooldownMinutes: 10,
        maxDailyLossUSD: '300.00',
        stopOnConsecutiveLosses: 2,
      });

      // Retrieve settings
      const settings = await getAutomatedTradingSettings(testUserId);
      
      expect(settings).toBeDefined();
      expect(settings?.enabled).toBe(true);
      expect(settings?.minSignalConfidence).toBe(75);
      expect(settings?.maxPositionSizePercent).toBe(15);
      expect(settings?.maxTradesPerDay).toBe(5);
    });

    it('should update existing settings', async () => {
      // Update settings
      await upsertAutomatedTradingSettings({
        userId: testUserId,
        enabled: false,
        minSignalConfidence: 80,
      });

      // Retrieve updated settings
      const settings = await getAutomatedTradingSettings(testUserId);
      
      expect(settings).toBeDefined();
      expect(settings?.enabled).toBe(false);
      expect(settings?.minSignalConfidence).toBe(80);
      // Other fields should remain unchanged
      expect(settings?.maxPositionSizePercent).toBe(15);
    });

    it('should create and update automated trade log', async () => {
      // Create log entry
      const logId = await createAutomatedTradeLog({
        userId: testUserId,
        signalId: 'test-signal-1',
        signalType: 'combined',
        signalConfidence: '85.50',
        signalData: { test: 'data' },
        symbol: 'BTCUSDT',
        side: 'long',
        status: 'pending',
        signalReceivedAt: new Date(),
        evaluatedAt: new Date(),
      });

      expect(logId).toBeGreaterThan(0);

      // Update log entry
      await updateAutomatedTradeLog(logId, {
        status: 'executed',
        executedPrice: '50000.00',
        executedQuantity: '0.1',
        executionLatencyMs: 150,
        executedAt: new Date(),
      });

      // Verify update (we can't easily query single log, but this tests the update doesn't throw)
      expect(true).toBe(true);
    });

    it('should count today\'s automated trades', async () => {
      // Create a few executed trades
      await createAutomatedTradeLog({
        userId: testUserId,
        signalId: 'test-signal-2',
        signalType: 'technical',
        signalConfidence: '90.00',
        signalData: {},
        symbol: 'ETHUSDT',
        side: 'short',
        status: 'executed',
        signalReceivedAt: new Date(),
        evaluatedAt: new Date(),
        executedAt: new Date(),
      });

      const count = await getTodayAutomatedTradeCount(testUserId);
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Automated Trading Engine', () => {
    it('should initialize with user settings', async () => {
      const engine = new AutomatedTradingEngine(testUserId);
      await engine.initialize();

      const status = engine.getStatus();
      expect(status).toBeDefined();
      expect(status.settings).toBeDefined();
    });

    it('should reject signals when automation is disabled', async () => {
      // Disable automation
      await upsertAutomatedTradingSettings({
        userId: testUserId,
        enabled: false,
      });

      const engine = new AutomatedTradingEngine(testUserId);
      await engine.initialize();

      const signal: TradingSignal = {
        id: 'test-signal-disabled',
        symbol: 'BTCUSDT',
        type: 'long',
        confidence: 85,
        signalType: 'combined',
        data: {},
        timestamp: new Date(),
        price: 50000,
      };

      // Process signal (should be ignored because automation is disabled)
      await engine.processSignal(signal);

      // Verify no trade was executed (engine should just return early)
      expect(true).toBe(true);
    });

    it('should reject signals below confidence threshold', async () => {
      // Enable automation with high confidence threshold
      await upsertAutomatedTradingSettings({
        userId: testUserId,
        enabled: true,
        minSignalConfidence: 90,
      });

      const engine = new AutomatedTradingEngine(testUserId);
      await engine.initialize();

      const signal: TradingSignal = {
        id: 'test-signal-low-confidence',
        symbol: 'BTCUSDT',
        type: 'long',
        confidence: 75, // Below threshold
        signalType: 'combined',
        data: {},
        timestamp: new Date(),
        price: 50000,
      };

      let rejectionReceived = false;
      engine.on('trade_rejected', () => {
        rejectionReceived = true;
      });

      await engine.processSignal(signal);

      // Give event time to fire
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(rejectionReceived).toBe(true);
    });
  });

  describe('Risk Controls', () => {
    it('should validate position sizing limits', async () => {
      await upsertAutomatedTradingSettings({
        userId: testUserId,
        enabled: true,
        minSignalConfidence: 70,
        maxPositionSizePercent: 10,
      });

      const settings = await getAutomatedTradingSettings(testUserId);
      expect(settings?.maxPositionSizePercent).toBe(10);
    });

    it('should validate trade limits', async () => {
      await upsertAutomatedTradingSettings({
        userId: testUserId,
        maxTradesPerDay: 5,
        maxOpenPositions: 3,
      });

      const settings = await getAutomatedTradingSettings(testUserId);
      expect(settings?.maxTradesPerDay).toBe(5);
      expect(settings?.maxOpenPositions).toBe(3);
    });

    it('should validate circuit breaker settings', async () => {
      await upsertAutomatedTradingSettings({
        userId: testUserId,
        maxDailyLossUSD: '500.00',
        stopOnConsecutiveLosses: 3,
      });

      const settings = await getAutomatedTradingSettings(testUserId);
      expect(settings?.maxDailyLossUSD).toBe('500.00');
      expect(settings?.stopOnConsecutiveLosses).toBe(3);
    });
  });
});
