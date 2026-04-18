import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getBalanceTracker, destroyBalanceTracker } from '../services/BalanceTracker';

// Mock database functions
vi.mock('../db', () => ({
  getPaperWallet: vi.fn(async (userId: number) => ({
    userId,
    balance: '18208.50',
    equity: '18208.50',
    margin: '804.80',
    realizedPnL: '0',
    unrealizedPnL: '0',
    totalPnL: '0',
    winRate: '0',
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  getPaperPositions: vi.fn(async (userId: number) => [
    {
      id: 1,
      userId,
      symbol: 'ETHUSD',
      side: 'long',
      quantity: '0.16981619',
      entryPrice: '2945.90',
      currentPrice: '2945.90',
      unrealizedPnL: '0',
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 2,
      userId,
      symbol: 'BTCUSD',
      side: 'long',
      quantity: '0.0034043',
      entryPrice: '88209.38',
      currentPrice: '88209.38',
      unrealizedPnL: '0',
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 3,
      userId,
      symbol: 'ETHUSD2', // Unique key for duplicate symbol tracking
      side: 'long',
      quantity: '0.0014407',
      entryPrice: '2946.93',
      currentPrice: '2946.93',
      unrealizedPnL: '0',
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]),
}));

describe('BalanceTracker', () => {
  const testUserId = 999;

  beforeEach(() => {
    // Clean up any existing tracker
    destroyBalanceTracker(testUserId);
  });

  it('should load balance from database on initialization', async () => {
    const tracker = getBalanceTracker(testUserId);
    const snapshot = await tracker.getBalanceSnapshotAsync();

    expect(snapshot.totalBalance).toBe(18208.50);
    expect(snapshot.realizedPnL).toBe(0);
  });

  it('should track positions from database', async () => {
    const tracker = getBalanceTracker(testUserId);
    const snapshot = await tracker.getBalanceSnapshotAsync();
    const positions = tracker.getPositions();

    // Should have positions loaded
    expect(positions.length).toBeGreaterThan(0);
  });

  it('should calculate margin correctly from all positions', async () => {
    const tracker = getBalanceTracker(testUserId);
    const snapshot = await tracker.getBalanceSnapshotAsync();

    // Margin should be calculated from position entry prices * quantities
    expect(snapshot.marginUsed).toBeGreaterThan(0);
    expect(snapshot.marginUsed).toBeCloseTo(804.80, 0);
  });

  it('should calculate available balance correctly', async () => {
    const tracker = getBalanceTracker(testUserId);
    const snapshot = await tracker.getBalanceSnapshotAsync();

    // Available = Total - Margin
    expect(snapshot.availableBalance).toBe(snapshot.totalBalance - snapshot.marginUsed);
    expect(snapshot.availableBalance).toBeGreaterThan(0);
  });

  it('should update timestamp on each snapshot', async () => {
    const tracker = getBalanceTracker(testUserId);
    
    const snapshot1 = await tracker.getBalanceSnapshotAsync();
    const time1 = snapshot1.timestamp.getTime();

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));

    const snapshot2 = await tracker.getBalanceSnapshotAsync();
    const time2 = snapshot2.timestamp.getTime();

    // Second snapshot should have newer timestamp
    expect(time2).toBeGreaterThan(time1);
  });

  it('should sync with database when requested', async () => {
    const tracker = getBalanceTracker(testUserId);
    
    // Initial snapshot
    const snapshot1 = await tracker.getBalanceSnapshotAsync();
    expect(snapshot1.totalBalance).toBe(18208.50);

    // Sync with database (would reload fresh data)
    await tracker.syncWithDatabase();
    const snapshot2 = await tracker.getBalanceSnapshotAsync();

    // Should still have correct balance after sync
    expect(snapshot2.totalBalance).toBe(18208.50);
  });

  it('should calculate equity correctly', async () => {
    const tracker = getBalanceTracker(testUserId);
    const snapshot = await tracker.getBalanceSnapshotAsync();

    // Equity = Total Balance + Unrealized P&L
    expect(snapshot.equity).toBe(snapshot.totalBalance + snapshot.unrealizedPnL);
  });

  it('should handle position updates correctly', async () => {
    const tracker = getBalanceTracker(testUserId);
    
    // Get initial snapshot
    await tracker.getBalanceSnapshotAsync();

    // Simulate position update using PositionSummary interface
    tracker.updatePosition({
      id: 1,
      symbol: 'ETHUSD',
      quantity: 0.16981619,
      entryPrice: 2945.90,
      currentPrice: 3000,
      unrealizedPnL: 9.19,
      marginUsed: 500.26,
    });

    const snapshot2 = tracker.getBalanceSnapshot();
    
    // Unrealized P&L should reflect the update
    expect(snapshot2.unrealizedPnL).toBeGreaterThan(0);
  });

  it('should validate new position against available balance', async () => {
    const tracker = getBalanceTracker(testUserId);
    await tracker.getBalanceSnapshotAsync();
    
    // Try to open a position that's too large
    const validation = tracker.validateNewPosition(3000, 10, 10); // $30,000 position with 10% buffer
    
    // Should fail because available balance is only ~$17,403
    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain('Insufficient');
  });

  it('should calculate max position size correctly', async () => {
    const tracker = getBalanceTracker(testUserId);
    await tracker.getBalanceSnapshotAsync();
    
    // Max position size with 20% of available balance, no buffer
    const maxQty = tracker.getMaxPositionSize(3000, 20, 0);
    
    // Should be > 0 and reasonable
    expect(maxQty).toBeGreaterThan(0);
    expect(maxQty).toBeLessThan(10); // Sanity check
  });
});
