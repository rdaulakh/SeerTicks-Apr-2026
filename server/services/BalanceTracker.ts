/**
 * Balance Tracker Service
 * Real-time balance and equity tracking for trading accounts
 */

import { getPaperWallet } from '../db';

export interface BalanceSnapshot {
  totalBalance: number;
  availableBalance: number;
  marginUsed: number;
  equity: number;
  unrealizedPnL: number;
  realizedPnL: number;
  timestamp: Date;
}

export interface PositionSummary {
  id: number;
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  marginUsed: number;
}

class BalanceTracker {
  private userId: number;
  private initialBalance: number = 10000; // Default paper trading balance
  private realizedPnL: number = 0;
  private positions: Map<string, PositionSummary> = new Map();
  private lastUpdate: Date = new Date();
  private updateInterval: NodeJS.Timeout | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(userId: number, initialBalance: number = 10000) {
    this.userId = userId;
    this.initialBalance = initialBalance;
    // Start loading balance from database
    this.initPromise = this.loadBalanceFromDatabase();
  }

  /**
   * Ensure initialization is complete
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
  }

  /**
   * Load balance and P&L from database
   */
  private async loadBalanceFromDatabase(): Promise<void> {
    try {
      const wallet = await getPaperWallet(this.userId);
      if (wallet) {
        this.initialBalance = parseFloat(wallet.balance.toString());
        this.realizedPnL = parseFloat(wallet.realizedPnL.toString());
        console.log(`[BalanceTracker] Loaded balance for user ${this.userId}: $${this.initialBalance.toFixed(2)}, Realized P&L: $${this.realizedPnL.toFixed(2)}`);
      }
    } catch (error) {
      console.error('[BalanceTracker] Failed to load balance from database:', error);
    }
  }

  /**
   * Sync balance with database (call after adding/removing funds)
   */
  async syncWithDatabase(): Promise<void> {
    await this.loadBalanceFromDatabase();
  }

  /**
   * Update position information
   */
  updatePosition(position: PositionSummary): void {
    this.positions.set(position.symbol, position);
    this.lastUpdate = new Date();
  }

  /**
   * Remove a position (when closed)
   */
  removePosition(symbol: string): void {
    this.positions.delete(symbol);
    this.lastUpdate = new Date();
  }

  /**
   * Add realized P&L from closed position
   */
  addRealizedPnL(amount: number): void {
    this.realizedPnL += amount;
    this.lastUpdate = new Date();
  }

  /**
   * Calculate current balance snapshot
   */
  getBalanceSnapshot(): BalanceSnapshot {
    // Note: This is synchronous for compatibility, but positions may be stale
    // Use getBalanceSnapshotAsync() for real-time accuracy
    // Calculate total unrealized P&L from all positions
    let unrealizedPnL = 0;
    let marginUsed = 0;

    for (const position of this.positions.values()) {
      unrealizedPnL += position.unrealizedPnL;
      marginUsed += position.marginUsed;
    }

    // Total balance = initial + realized P&L
    const totalBalance = this.initialBalance + this.realizedPnL;
    
    // Equity = total balance + unrealized P&L
    const equity = totalBalance + unrealizedPnL;
    
    // Available balance = total balance - margin used
    const availableBalance = Math.max(0, totalBalance - marginUsed);

    // Update timestamp to reflect current calculation
    this.lastUpdate = new Date();

    return {
      totalBalance,
      availableBalance,
      marginUsed,
      equity,
      unrealizedPnL,
      realizedPnL: this.realizedPnL,
      timestamp: this.lastUpdate,
    };
  }

  /**
   * Calculate balance snapshot with real-time position data from database
   */
  async getBalanceSnapshotAsync(): Promise<BalanceSnapshot> {
    // Ensure initialization is complete
    await this.ensureInitialized();
    
    // Load latest positions from database
    await this.loadPositionsFromDatabase();
    
    // Calculate total unrealized P&L from all positions
    let unrealizedPnL = 0;
    let marginUsed = 0;

    for (const position of this.positions.values()) {
      unrealizedPnL += position.unrealizedPnL;
      marginUsed += position.marginUsed;
    }

    // Total balance = initial + realized P&L
    const totalBalance = this.initialBalance + this.realizedPnL;
    
    // Equity = total balance + unrealized P&L
    const equity = totalBalance + unrealizedPnL;
    
    // Available balance = total balance - margin used
    const availableBalance = Math.max(0, totalBalance - marginUsed);

    // Update timestamp to reflect current calculation
    this.lastUpdate = new Date();

    return {
      totalBalance,
      availableBalance,
      marginUsed,
      equity,
      unrealizedPnL,
      realizedPnL: this.realizedPnL,
      timestamp: this.lastUpdate,
    };
  }

  /**
   * Load positions from database
   */
  private async loadPositionsFromDatabase(): Promise<void> {
    try {
      const { getPaperPositions } = await import('../db');
      const dbPositions = await getPaperPositions(this.userId);
      
      // Clear existing positions
      this.positions.clear();
      
      // Load open positions - use position ID as key to support multiple positions per symbol
      for (const pos of dbPositions) {
        if (pos.status === 'open') {
          const entryPrice = parseFloat(pos.entryPrice.toString());
          const currentPrice = parseFloat(pos.currentPrice.toString());
          const quantity = parseFloat(pos.quantity.toString());
          const unrealizedPnL = parseFloat(pos.unrealizedPnL?.toString() || '0');
          
          // Use position ID as key to allow multiple positions per symbol
          this.positions.set(pos.id.toString(), {
            id: pos.id,
            symbol: pos.symbol,
            quantity,
            entryPrice,
            currentPrice,
            unrealizedPnL,
            marginUsed: entryPrice * quantity,
          });
        }
      }
      
      this.lastUpdate = new Date();
    } catch (error) {
      console.error('[BalanceTracker] Failed to load positions from database:', error);
    }
  }

  /**
   * Get all current positions
   */
  getPositions(): PositionSummary[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get position by symbol
   */
  getPosition(symbol: string): PositionSummary | undefined {
    return this.positions.get(symbol);
  }

  /**
   * Check if there's enough available balance for a new position
   */
  canOpenPosition(marginRequired: number, bufferPercent: number = 10): boolean {
    const snapshot = this.getBalanceSnapshot();
    const requiredWithBuffer = marginRequired * (1 + bufferPercent / 100);
    return snapshot.availableBalance >= requiredWithBuffer;
  }

  /**
   * Calculate maximum position size based on available balance
   */
  getMaxPositionSize(
    price: number,
    maxPositionPercent: number = 20,
    bufferPercent: number = 10
  ): number {
    const snapshot = this.getBalanceSnapshot();
    
    // Maximum position value = available balance * max position %
    const maxPositionValue = snapshot.availableBalance * (maxPositionPercent / 100);
    
    // Apply buffer
    const maxPositionValueWithBuffer = maxPositionValue * (1 - bufferPercent / 100);
    
    // Calculate quantity
    const maxQuantity = maxPositionValueWithBuffer / price;
    
    return Math.max(0, maxQuantity);
  }

  /**
   * Validate if a position can be opened
   */
  validateNewPosition(
    price: number,
    quantity: number,
    bufferPercent: number = 10
  ): { valid: boolean; reason?: string; maxQuantity?: number } {
    const marginRequired = price * quantity;
    const snapshot = this.getBalanceSnapshot();
    
    // Check if balance is positive
    if (snapshot.totalBalance <= 0) {
      return {
        valid: false,
        reason: 'Insufficient balance: account balance is zero or negative',
        maxQuantity: 0,
      };
    }

    // Check if available balance is sufficient
    const requiredWithBuffer = marginRequired * (1 + bufferPercent / 100);
    if (snapshot.availableBalance < requiredWithBuffer) {
      const maxQuantity = this.getMaxPositionSize(price, 20, bufferPercent);
      return {
        valid: false,
        reason: `Insufficient available balance. Required: $${requiredWithBuffer.toFixed(2)}, Available: $${snapshot.availableBalance.toFixed(2)}`,
        maxQuantity,
      };
    }

    return { valid: true };
  }

  /**
   * Reset balance to initial state
   */
  reset(newInitialBalance?: number): void {
    if (newInitialBalance !== undefined) {
      this.initialBalance = newInitialBalance;
    }
    this.realizedPnL = 0;
    this.positions.clear();
    this.lastUpdate = new Date();
  }

  /**
   * Get initial balance
   */
  getInitialBalance(): number {
    return this.initialBalance;
  }

  /**
   * Set initial balance (also updates realized P&L to maintain consistency)
   */
  setInitialBalance(balance: number, realizedPnL: number = 0): void {
    this.initialBalance = balance;
    this.realizedPnL = realizedPnL;
    this.lastUpdate = new Date();
  }

  /**
   * Start automatic balance updates
   */
  startAutoUpdate(intervalMs: number = 100): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    this.updateInterval = setInterval(() => {
      this.lastUpdate = new Date();
    }, intervalMs);
  }

  /**
   * Stop automatic balance updates
   */
  stopAutoUpdate(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopAutoUpdate();
    this.positions.clear();
  }

  /**
   * Register user (for compatibility with existing code)
   */
  registerUser(userId: number, initialBalance: number): void {
    this.userId = userId;
    this.setInitialBalance(initialBalance);
  }

  /**
   * Get current balance (for compatibility with existing code)
   */
  getBalance(): number {
    return this.getBalanceSnapshot().totalBalance;
  }
}

// Singleton instances per user
const balanceTrackers = new Map<number, BalanceTracker>();

export function getBalanceTracker(userId?: number, initialBalance?: number): BalanceTracker {
  // If no userId provided, return a default instance
  const key = userId ?? 0;
  if (!balanceTrackers.has(key)) {
    balanceTrackers.set(key, new BalanceTracker(key, initialBalance));
  }
  return balanceTrackers.get(key)!;
}

export function destroyBalanceTracker(userId: number): void {
  const tracker = balanceTrackers.get(userId);
  if (tracker) {
    tracker.destroy();
    balanceTrackers.delete(userId);
  }
}

export { BalanceTracker };
