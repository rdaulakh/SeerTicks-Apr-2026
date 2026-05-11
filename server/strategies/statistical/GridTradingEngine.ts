/**
 * GridTradingEngine - Automated grid trading strategies
 */
import { EventEmitter } from 'events';
import { getActiveClock } from '../../_core/clock';

export interface GridLevel { price: number; type: 'buy' | 'sell'; status: 'pending' | 'filled' | 'cancelled'; orderId?: string; filledAt?: number; quantity: number; }
export interface Grid { id: string; symbol: string; upperPrice: number; lowerPrice: number; gridCount: number; gridType: 'arithmetic' | 'geometric'; levels: GridLevel[]; totalInvestment: number; realizedPnL: number; unrealizedPnL: number; status: 'active' | 'paused' | 'stopped'; createdAt: number; lastUpdate: number; }
export interface GridMetrics { id: string; profitPercent: number; tradesExecuted: number; avgProfitPerTrade: number; gridEfficiency: number; }
export interface GridConfig { defaultGridCount: number; minGridSpacing: number; maxGridSpacing: number; rebalanceThreshold: number; }

export class GridTradingEngine extends EventEmitter {
  private config: GridConfig;
  private grids: Map<string, Grid> = new Map();
  private isRunning = false;
  
  constructor(config?: Partial<GridConfig>) { super(); this.config = { defaultGridCount: 10, minGridSpacing: 0.5, maxGridSpacing: 5, rebalanceThreshold: 10, ...config }; }
  
  start(): void { this.isRunning = true; }
  stop(): void { this.isRunning = false; }
  
  createGrid(params: { symbol: string; upperPrice: number; lowerPrice: number; gridCount?: number; gridType?: 'arithmetic' | 'geometric'; totalInvestment: number }): Grid {
    const id = `grid_${params.symbol}_${getActiveClock().now()}`;
    const gridCount = params.gridCount || this.config.defaultGridCount;
    const gridType = params.gridType || 'arithmetic';
    
    const levels: GridLevel[] = [];
    const priceRange = params.upperPrice - params.lowerPrice;
    const quantityPerLevel = params.totalInvestment / gridCount;
    
    for (let i = 0; i <= gridCount; i++) {
      let price: number;
      if (gridType === 'arithmetic') {
        price = params.lowerPrice + (priceRange * i / gridCount);
      } else {
        const ratio = Math.pow(params.upperPrice / params.lowerPrice, i / gridCount);
        price = params.lowerPrice * ratio;
      }
      levels.push({ price: Math.round(price * 100) / 100, type: i < gridCount / 2 ? 'buy' : 'sell', status: 'pending', quantity: quantityPerLevel / price });
    }
    
    const grid: Grid = { id, symbol: params.symbol, upperPrice: params.upperPrice, lowerPrice: params.lowerPrice, gridCount, gridType, levels, totalInvestment: params.totalInvestment, realizedPnL: 0, unrealizedPnL: 0, status: 'active', createdAt: getActiveClock().now(), lastUpdate: getActiveClock().now() };
    this.grids.set(id, grid);
    this.emit('gridCreated', grid);
    return grid;
  }
  
  processPrice(data: { symbol: string; timestamp: number; price: number }): void {
    if (!this.isRunning) return;
    for (const grid of this.grids.values()) {
      if (grid.symbol !== data.symbol || grid.status !== 'active') continue;
      this.updateGrid(grid, data.price);
    }
  }
  
  private updateGrid(grid: Grid, currentPrice: number): void {
    let updated = false;
    for (const level of grid.levels) {
      if (level.status !== 'pending') continue;
      if (level.type === 'buy' && currentPrice <= level.price) {
        level.status = 'filled';
        level.filledAt = getActiveClock().now();
        updated = true;
        this.emit('levelFilled', { gridId: grid.id, level, type: 'buy', price: currentPrice });
        // Create corresponding sell level
        const sellPrice = level.price * 1.01; // 1% profit target
        const sellLevel = grid.levels.find(l => l.status === 'pending' && l.type === 'sell' && l.price <= sellPrice);
        if (sellLevel) sellLevel.price = sellPrice;
      } else if (level.type === 'sell' && currentPrice >= level.price) {
        level.status = 'filled';
        level.filledAt = getActiveClock().now();
        updated = true;
        const profit = level.quantity * (currentPrice - level.price * 0.99);
        grid.realizedPnL += profit;
        this.emit('levelFilled', { gridId: grid.id, level, type: 'sell', price: currentPrice, profit });
      }
    }
    
    // Calculate unrealized PnL
    const filledBuys = grid.levels.filter(l => l.type === 'buy' && l.status === 'filled');
    grid.unrealizedPnL = filledBuys.reduce((sum, l) => sum + l.quantity * (currentPrice - l.price), 0);
    
    // Check rebalance
    if (this.checkRebalance(grid, currentPrice)) {
      this.emit('rebalanceNeeded', { gridId: grid.id, currentPrice });
    }
    
    if (updated) {
      grid.lastUpdate = getActiveClock().now();
      this.emit('gridUpdated', grid);
    }
  }
  
  private checkRebalance(grid: Grid, currentPrice: number): boolean {
    const midPrice = (grid.upperPrice + grid.lowerPrice) / 2;
    const deviation = Math.abs(currentPrice - midPrice) / midPrice * 100;
    return deviation > this.config.rebalanceThreshold;
  }
  
  calculateOptimalGrid(symbol: string, currentPrice: number, volatility: number, investment: number): { upperPrice: number; lowerPrice: number; gridCount: number; gridType: 'arithmetic' | 'geometric' } {
    const range = volatility * 2;
    const upperPrice = currentPrice * (1 + range / 100);
    const lowerPrice = currentPrice * (1 - range / 100);
    const gridCount = Math.min(20, Math.max(5, Math.floor(range / 2)));
    return { upperPrice, lowerPrice, gridCount, gridType: volatility > 30 ? 'geometric' : 'arithmetic' };
  }
  
  getGrid(gridId: string): Grid | undefined { return this.grids.get(gridId); }
  getGridsForSymbol(symbol: string): Grid[] { return Array.from(this.grids.values()).filter(g => g.symbol === symbol); }
  getAllGrids(): Grid[] { return Array.from(this.grids.values()); }
  
  getGridMetrics(gridId: string): GridMetrics | null {
    const grid = this.grids.get(gridId);
    if (!grid) return null;
    const filledLevels = grid.levels.filter(l => l.status === 'filled');
    const tradesExecuted = filledLevels.length;
    return { id: gridId, profitPercent: grid.totalInvestment > 0 ? (grid.realizedPnL / grid.totalInvestment) * 100 : 0, tradesExecuted, avgProfitPerTrade: tradesExecuted > 0 ? grid.realizedPnL / tradesExecuted : 0, gridEfficiency: tradesExecuted / (grid.gridCount * 2) * 100 };
  }
  
  pauseGrid(gridId: string): void { const grid = this.grids.get(gridId); if (grid) { grid.status = 'paused'; this.emit('gridPaused', grid); } }
  resumeGrid(gridId: string): void { const grid = this.grids.get(gridId); if (grid) { grid.status = 'active'; this.emit('gridResumed', grid); } }
  stopGrid(gridId: string): void { const grid = this.grids.get(gridId); if (grid) { grid.status = 'stopped'; this.emit('gridStopped', grid); } }
}

let instance: GridTradingEngine | null = null;
export function getGridTradingEngine(config?: Partial<GridConfig>): GridTradingEngine { if (!instance) instance = new GridTradingEngine(config); return instance; }
export function resetGridTradingEngine(): void { if (instance) instance.stop(); instance = null; }
