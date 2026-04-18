/**
 * Wallet and Position Tests
 * Tests for wallet balance updates and position creation with stop loss/take profit
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getPaperWallet, upsertPaperWallet, insertPaperPosition, getPaperPositions } from '../db';

describe('Wallet and Position Management', () => {
  const testUserId = 1260007; // Use actual user ID

  describe('Wallet Balance', () => {
    it('should load current wallet balance', async () => {
      // First ensure wallet exists by creating one if needed
      let wallet = await getPaperWallet(testUserId);
      
      if (!wallet) {
        // Create a new wallet for testing
        await upsertPaperWallet({
          userId: testUserId,
          balance: '10000.00',
          equity: '10000.00',
          margin: '0.00',
          marginLevel: '0.00',
          totalPnL: '0.00',
          realizedPnL: '0.00',
          unrealizedPnL: '0.00',
          totalCommission: '0.00',
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: '0.00',
        });
        wallet = await getPaperWallet(testUserId);
      }
      
      expect(wallet).toBeTruthy();
      console.log('Current wallet balance:', wallet?.balance);
      console.log('Current equity:', wallet?.equity);
      console.log('Total trades:', wallet?.totalTrades);
    });

    it('should add funds to wallet', async () => {
      // First ensure wallet exists
      let wallet = await getPaperWallet(testUserId);
      
      if (!wallet) {
        // Create a new wallet for testing
        await upsertPaperWallet({
          userId: testUserId,
          balance: '10000.00',
          equity: '10000.00',
          margin: '0.00',
          marginLevel: '0.00',
          totalPnL: '0.00',
          realizedPnL: '0.00',
          unrealizedPnL: '0.00',
          totalCommission: '0.00',
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: '0.00',
        });
        wallet = await getPaperWallet(testUserId);
      }
      
      expect(wallet).toBeTruthy();
      
      const currentBalance = parseFloat(wallet!.balance);
      const amountToAdd = 1000;
      const newBalance = currentBalance + amountToAdd;
      
      await upsertPaperWallet({
        userId: testUserId,
        balance: newBalance.toFixed(2),
        equity: newBalance.toFixed(2),
        margin: wallet!.margin,
        marginLevel: wallet!.marginLevel,
        totalPnL: wallet!.totalPnL,
        realizedPnL: wallet!.realizedPnL,
        unrealizedPnL: wallet!.unrealizedPnL,
        totalCommission: wallet!.totalCommission,
        totalTrades: wallet!.totalTrades,
        winningTrades: wallet!.winningTrades,
        losingTrades: wallet!.losingTrades,
        winRate: wallet!.winRate,
      });
      
      const updatedWallet = await getPaperWallet(testUserId);
      expect(updatedWallet).toBeTruthy();
      expect(parseFloat(updatedWallet!.balance)).toBe(newBalance);
      
      console.log('Added $1000 to wallet');
      console.log('New balance:', updatedWallet!.balance);
    });
  });

  describe('Position Creation', () => {
    it('should create position with stop loss and take profit', async () => {
      const testPosition = {
        userId: testUserId,
        symbol: 'BTCUSDT',
        exchange: 'binance' as const,
        side: 'long' as const,
        entryPrice: '92000.00',
        currentPrice: '92000.00',
        quantity: '0.01',
        stopLoss: '90000.00', // Stop loss at $90,000
        takeProfit: '95000.00', // Take profit at $95,000
        entryTime: new Date(),
        unrealizedPnL: '0.00',
        unrealizedPnLPercent: '0.00',
        commission: '0.92',
        strategy: 'Test Strategy',
        status: 'open' as const,
      };
      
      const insertedPosition = await insertPaperPosition(testPosition);
      
      // Verify the returned position
      expect(insertedPosition).toBeTruthy();
      
      // Also verify by querying
      const positions = await getPaperPositions(testUserId);
      const createdPosition = positions.find(p => 
        p.symbol === 'BTCUSDT' && 
        p.status === 'open' &&
        p.entryPrice === '92000.00'
      );
      
      expect(createdPosition).toBeTruthy();
      expect(createdPosition!.stopLoss).toBe('90000.00');
      expect(createdPosition!.takeProfit).toBe('95000.00');
      
      console.log('Created position with:');
      console.log('  Stop Loss:', createdPosition!.stopLoss);
      console.log('  Take Profit:', createdPosition!.takeProfit);
    });

    it('should list all open positions', async () => {
      const positions = await getPaperPositions(testUserId);
      const openPositions = positions.filter(p => p.status === 'open');
      
      console.log(`Found ${openPositions.length} open positions`);
      openPositions.forEach(pos => {
        console.log(`  ${pos.symbol} ${pos.side} - SL: ${pos.stopLoss || 'N/A'}, TP: ${pos.takeProfit || 'N/A'}`);
      });
    });
  });
});
