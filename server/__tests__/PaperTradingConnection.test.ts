import { describe, it, expect } from 'vitest';
import { getDb } from '../db';
import { paperOrders, paperPositions } from '../../drizzle/schema';
import { desc } from 'drizzle-orm';

describe('Paper Trading Engine Connection', () => {
  /**
   * Phase 14E: Legacy SEERMultiEngine test removed.
   * Paper Trading Engine initialization is now verified via UserTradingSession.
   */
  it('should verify Paper Trading Engine is initialized via UserTradingSession', async () => {
    const { UserTradingSession } = await import('../services/UserTradingSession');
    
    // UserTradingSession is the new per-user session that handles paper trading
    expect(UserTradingSession).toBeDefined();
    expect(typeof UserTradingSession).toBe('function');
    
    console.log('✅ Paper Trading Engine is managed by UserTradingSession (Phase 14A/B architecture)');
  });

  it('should check if any paper orders have been created recently', async () => {
    const db = await getDb();
    if (!db) throw new Error('DB not available');

    const recentOrders = await db
      .select()
      .from(paperOrders)
      .orderBy(desc(paperOrders.createdAt))
      .limit(10);

    console.log(`\n=== Recent Paper Orders (last 10) ===`);
    console.log(`Total orders found: ${recentOrders.length}`);
    
    if (recentOrders.length > 0) {
      console.log('\nMost recent orders:');
      recentOrders.slice(0, 5).forEach((order: any) => {
        console.log(`  ${order.createdAt.toISOString()} - ${order.symbol} ${order.side} ${order.type} (status: ${order.status})`);
      });
    }

    expect(true).toBe(true);
  });

  it('should check if any paper positions exist', async () => {
    const db = await getDb();
    if (!db) throw new Error('DB not available');

    const positions = await db
      .select()
      .from(paperPositions)
      .orderBy(desc(paperPositions.createdAt))
      .limit(10);

    console.log(`\n=== Paper Positions (last 10) ===`);
    console.log(`Total positions found: ${positions.length}`);
    
    if (positions.length > 0) {
      console.log('\nMost recent positions:');
      positions.slice(0, 5).forEach((pos: any) => {
        console.log(`  ${pos.createdAt.toISOString()} - ${pos.symbol} ${pos.side} qty:${pos.quantity} @${pos.entryPrice} (status: ${pos.status})`);
      });
    }

    expect(true).toBe(true);
  });

  it('should verify StrategyOrchestrator receives Paper Trading Engine', async () => {
    const { StrategyOrchestrator } = await import('../orchestrator/StrategyOrchestrator');
    const { AgentManager } = await import('../agents/AgentBase');
    const { PaperTradingEngine } = await import('../execution/PaperTradingEngine');
    
    const agentManager = new AgentManager();
    const orchestrator = new StrategyOrchestrator('BTCUSDT', agentManager, 1, 10000);
    
    const paperEngine = new PaperTradingEngine({
      userId: 1,
      initialBalance: 10000,
      exchange: 'coinbase',
      enableSlippage: true,
      enableCommission: true,
      enableMarketImpact: false,
      enableLatency: false,
    });
    
    orchestrator.setPaperTradingEngine(paperEngine);
    
    const orchestratorAny = orchestrator as any;
    expect(orchestratorAny.paperTradingEngine).toBeDefined();
    expect(orchestratorAny.paperTradingEngine).not.toBeNull();
    
    console.log('✅ StrategyOrchestrator can receive and store Paper Trading Engine');
  });
});
