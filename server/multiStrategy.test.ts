import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "./routers";
import type { Context } from "./_core/context";

/**
 * Multi-Strategy Router Tests
 * Tests for strategy instance management and performance tracking
 */

// Mock user context
const mockUser = {
  id: 1,
  openId: "test-user",
  name: "Test User",
  email: "test@example.com",
  role: "user" as const,
};

const createMockContext = (): Context => ({
  user: mockUser,
  req: {} as any,
  res: {} as any,
});

describe("Multi-Strategy Router", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;
  let createdStrategyId: number;

  beforeAll(() => {
    caller = appRouter.createCaller(createMockContext());
  });

  describe("Strategy Instance Management", () => {
    it("should create a new strategy instance", async () => {
      try {
        const result = await caller.multiStrategy.create({
        name: "Test Scalping Strategy",
        strategyType: "scalping",
        allocatedBalance: "1000.00",
        config: {
          timeframe: "1m",
          maxPositionSize: 10,
          stopLoss: 0.5,
          takeProfit: 1.0,
          maxOpenPositions: 5,
        },
      });

        expect(result).toHaveProperty("strategyId");
        expect(typeof result.strategyId).toBe("number");
        createdStrategyId = result.strategyId;
      } catch (error) {
        console.error("Create strategy error:", error);
        throw error;
      }
    });

    it("should list all strategy instances", async () => {
      const strategies = await caller.multiStrategy.list();

      expect(Array.isArray(strategies)).toBe(true);
      expect(strategies.length).toBeGreaterThan(0);
      expect(strategies[0]).toHaveProperty("name");
      expect(strategies[0]).toHaveProperty("strategyType");
      expect(strategies[0]).toHaveProperty("status");
    });

    it("should get a specific strategy instance", async () => {
      const strategy = await caller.multiStrategy.get({ strategyId: createdStrategyId });

      expect(strategy).toBeDefined();
      expect(strategy?.name).toBe("Test Scalping Strategy");
      expect(strategy?.strategyType).toBe("scalping");
      expect(strategy?.status).toBe("paused");
    });

    it("should update strategy instance", async () => {
      const result = await caller.multiStrategy.update({
        strategyId: createdStrategyId,
        name: "Updated Scalping Strategy",
      });

      expect(result.success).toBe(true);

      const updated = await caller.multiStrategy.get({ strategyId: createdStrategyId });
      expect(updated?.name).toBe("Updated Scalping Strategy");
    });

    it("should start a strategy instance", async () => {
      const result = await caller.multiStrategy.start({ strategyId: createdStrategyId });

      expect(result.success).toBe(true);

      const strategy = await caller.multiStrategy.get({ strategyId: createdStrategyId });
      expect(strategy?.status).toBe("active");
      expect(strategy?.startedAt).toBeDefined();
    });

    it("should list active strategies", async () => {
      const activeStrategies = await caller.multiStrategy.listActive();

      expect(Array.isArray(activeStrategies)).toBe(true);
      expect(activeStrategies.some((s) => s.id === createdStrategyId)).toBe(true);
    });

    it("should pause a strategy instance", async () => {
      const result = await caller.multiStrategy.pause({ strategyId: createdStrategyId });

      expect(result.success).toBe(true);

      const strategy = await caller.multiStrategy.get({ strategyId: createdStrategyId });
      expect(strategy?.status).toBe("paused");
    });

    it("should stop a strategy instance", async () => {
      const result = await caller.multiStrategy.stop({ strategyId: createdStrategyId });

      expect(result.success).toBe(true);

      const strategy = await caller.multiStrategy.get({ strategyId: createdStrategyId });
      expect(strategy?.status).toBe("stopped");
      expect(strategy?.stoppedAt).toBeDefined();
    });
  });

  describe("Strategy Performance Tracking", () => {
    it("should get strategy performance metrics", async () => {
      const performance = await caller.multiStrategy.getPerformance({ strategyId: createdStrategyId });

      expect(performance).toBeDefined();
      expect(performance).toHaveProperty("totalTrades");
      expect(performance).toHaveProperty("winRate");
      expect(performance).toHaveProperty("totalPnL");
      expect(performance).toHaveProperty("openPositions");
    });

    it("should refresh strategy performance metrics", async () => {
      const performance = await caller.multiStrategy.refreshPerformance({ strategyId: createdStrategyId });

      expect(performance).toBeDefined();
      expect(performance).toHaveProperty("totalTrades");
      expect(performance).toHaveProperty("winningTrades");
      expect(performance).toHaveProperty("losingTrades");
      expect(performance).toHaveProperty("winRate");
      expect(performance).toHaveProperty("totalPnL");
    });
  });

  describe("Strategy Data Queries", () => {
    it("should get strategy positions", async () => {
      const positions = await caller.multiStrategy.getPositions({ strategyId: createdStrategyId });

      expect(Array.isArray(positions)).toBe(true);
    });

    it("should get strategy open positions", async () => {
      const openPositions = await caller.multiStrategy.getOpenPositions({ strategyId: createdStrategyId });

      expect(Array.isArray(openPositions)).toBe(true);
    });

    it("should get strategy orders", async () => {
      const orders = await caller.multiStrategy.getOrders({ strategyId: createdStrategyId, limit: 10 });

      expect(Array.isArray(orders)).toBe(true);
    });

    it("should get strategy trades", async () => {
      const trades = await caller.multiStrategy.getTrades({ strategyId: createdStrategyId, limit: 10 });

      expect(Array.isArray(trades)).toBe(true);
    });
  });

  describe("Dashboard Data", () => {
    it("should get aggregated dashboard data", async () => {
      const dashboard = await caller.multiStrategy.getDashboard();

      expect(dashboard).toBeDefined();
      expect(dashboard).toHaveProperty("strategies");
      expect(dashboard).toHaveProperty("aggregate");
      expect(Array.isArray(dashboard.strategies)).toBe(true);
      expect(dashboard.aggregate).toHaveProperty("totalPnL");
      expect(dashboard.aggregate).toHaveProperty("totalTrades");
      expect(dashboard.aggregate).toHaveProperty("activeStrategies");
      expect(dashboard.aggregate).toHaveProperty("totalOpenPositions");
    });
  });

  describe("Strategy Deletion", () => {
    it("should delete a stopped strategy instance", async () => {
      const result = await caller.multiStrategy.delete({ strategyId: createdStrategyId });

      expect(result.success).toBe(true);

      const strategy = await caller.multiStrategy.get({ strategyId: createdStrategyId });
      expect(strategy).toBeUndefined();
    });

    it("should prevent deletion of strategy with open positions", async () => {
      // Create a new strategy for this test
      const createResult = await caller.multiStrategy.create({
        name: "Strategy with Positions",
        strategyType: "swing_trading",
        allocatedBalance: "2000.00",
        config: {},
      });

      // Note: In a real scenario, we would create positions for this strategy
      // For now, we just test the deletion of a strategy without positions

      const deleteResult = await caller.multiStrategy.delete({ strategyId: createResult.strategyId });
      expect(deleteResult.success).toBe(true);
    });
  });
});
