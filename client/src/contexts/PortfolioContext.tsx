/**
 * PortfolioContext - Centralized Portfolio Data Provider
 * 
 * Single source of truth for portfolio metrics across the entire application.
 * Ensures consistent P&L, balance, and equity values across Dashboard, Positions, and Performance pages.
 * 
 * This context consolidates data from:
 * - Position data (open positions, unrealized P&L)
 * - Order history (closed positions, realized P&L)
 * - Trading mode config (portfolio funds, paper trading settings)
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode, useMemo } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';

export interface PortfolioMetrics {
  // Core values
  portfolioFunds: number;        // Initial/configured portfolio funds
  portfolioValue: number;        // Current total value (funds + unrealized P&L)
  
  // P&L breakdown
  totalPnL: number;              // Realized + Unrealized
  realizedPnL: number;           // From closed positions
  unrealizedPnL: number;         // From open positions
  
  // Position metrics
  openPositionCount: number;
  positionValue: number;         // Total value of open positions
  
  // Performance metrics
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  
  // ROI
  roi: number;                   // Return on investment percentage
  
  // Trading mode
  isPaperTrading: boolean;
  
  // Loading state
  isLoading: boolean;
  isInitialized: boolean;
  lastUpdateTime: number;
}

interface PortfolioContextValue extends PortfolioMetrics {
  refetch: () => Promise<void>;
}

const defaultMetrics: PortfolioMetrics = {
  portfolioFunds: 0,
  portfolioValue: 0,
  totalPnL: 0,
  realizedPnL: 0,
  unrealizedPnL: 0,
  openPositionCount: 0,
  positionValue: 0,
  winRate: 0,
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  profitFactor: 0,
  avgWin: 0,
  avgLoss: 0,
  largestWin: 0,
  largestLoss: 0,
  roi: 0,
  isPaperTrading: true,
  isLoading: true,
  isInitialized: false,
  lastUpdateTime: 0,
};

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [isInitialized, setIsInitialized] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState(0);
  
  // Fetch portfolio funds - primary source for balance
  const { 
    data: portfolioFundsData, 
    isLoading: fundsLoading,
    refetch: refetchFunds 
  } = trpc.settings.getPortfolioFunds.useQuery(undefined, {
    enabled: !!user,
    staleTime: 5000,      // Reduced from 30s to 5s for faster initial load
    refetchInterval: 10000, // Refresh every 10 seconds
  });
  
  // Fetch trading mode config
  const { 
    data: tradingModeConfig, 
    isLoading: modeLoading 
  } = trpc.settings.getTradingMode.useQuery(undefined, {
    enabled: !!user,
    staleTime: 5000,
    refetchInterval: 30000,
  });
  
  // Fetch positions for unrealized P&L
  const { 
    data: positions, 
    isLoading: positionsLoading,
    refetch: refetchPositions 
  } = trpc.seerMulti.getPositions.useQuery(undefined, {
    enabled: !!user,
    staleTime: 2000,
    refetchInterval: 5000,
  });
  
  // Fetch order analytics for realized P&L and trade stats
  const { 
    data: orderAnalytics, 
    isLoading: analyticsLoading,
    refetch: refetchAnalytics 
  } = trpc.orderHistory.getAnalytics.useQuery(
    { isPaper: tradingModeConfig?.mode === 'paper' },
    {
      enabled: !!user && !!tradingModeConfig,
      staleTime: 5000,
      refetchInterval: 15000,
    }
  );
  
  // Calculate all metrics from the fetched data
  const metrics = useMemo<PortfolioMetrics>(() => {
    const isPaperTrading = tradingModeConfig?.mode === 'paper';
    const portfolioFunds = parseFloat(portfolioFundsData?.funds || '10000');
    
    // Calculate unrealized P&L from open positions
    const unrealizedPnL = (positions || []).reduce((sum: number, pos: any) => {
      // Try unrealizedPnl field first (from WebSocket/live data)
      if (pos.unrealizedPnl !== undefined && pos.unrealizedPnl !== null) {
        return sum + Number(pos.unrealizedPnl);
      }
      // Calculate from prices if unrealizedPnl not available
      const currentPrice = parseFloat(pos.currentPrice || pos.entryPrice || '0');
      const entryPrice = parseFloat(pos.entryPrice || '0');
      const quantity = parseFloat(pos.quantity || '0');
      const side = (pos.side || '').toUpperCase();
      if (side === 'LONG' || side === 'BUY') {
        return sum + (currentPrice - entryPrice) * quantity;
      } else {
        return sum + (entryPrice - currentPrice) * quantity;
      }
    }, 0);
    
    // Calculate position value
    const positionValue = (positions || []).reduce((sum: number, pos: any) => {
      const currentPrice = parseFloat(pos.currentPrice || pos.entryPrice || '0');
      const quantity = parseFloat(pos.quantity || '0');
      return sum + (currentPrice * quantity);
    }, 0);
    
    // Get realized P&L from order analytics
    const realizedPnL = orderAnalytics?.netPnl ?? 0;
    
    // Total P&L = Realized + Unrealized
    const totalPnL = realizedPnL + unrealizedPnL;
    
    // Portfolio value = Initial funds + Total P&L (for paper trading)
    // For live trading, it would be the actual account balance
    const portfolioValue = isPaperTrading 
      ? portfolioFunds + totalPnL
      : portfolioFunds + totalPnL; // Same calculation for now
    
    // ROI calculation
    const roi = portfolioFunds > 0 ? (totalPnL / portfolioFunds) * 100 : 0;
    
    // Determine loading state
    const isLoading = fundsLoading || modeLoading || positionsLoading || analyticsLoading;
    
    return {
      portfolioFunds,
      portfolioValue,
      totalPnL,
      realizedPnL,
      unrealizedPnL,
      openPositionCount: positions?.length || 0,
      positionValue,
      winRate: orderAnalytics?.winRate ?? 0,
      totalTrades: orderAnalytics?.totalTrades ?? 0,
      winningTrades: orderAnalytics?.winningTrades ?? 0,
      losingTrades: orderAnalytics?.losingTrades ?? 0,
      profitFactor: orderAnalytics?.profitFactor ?? 0,
      avgWin: orderAnalytics?.avgWin ?? 0,
      avgLoss: orderAnalytics?.avgLoss ?? 0,
      largestWin: orderAnalytics?.largestWin ?? 0,
      largestLoss: orderAnalytics?.largestLoss ?? 0,
      roi,
      isPaperTrading,
      isLoading,
      isInitialized: !isLoading && portfolioFundsData !== undefined,
      lastUpdateTime: Date.now(),
    };
  }, [
    portfolioFundsData, 
    tradingModeConfig, 
    positions, 
    orderAnalytics,
    fundsLoading,
    modeLoading,
    positionsLoading,
    analyticsLoading,
  ]);
  
  // Mark as initialized once first data load completes
  useEffect(() => {
    if (!metrics.isLoading && portfolioFundsData !== undefined) {
      setIsInitialized(true);
      setLastUpdateTime(Date.now());
    }
  }, [metrics.isLoading, portfolioFundsData]);
  
  // Refetch all data
  const refetch = useCallback(async () => {
    await Promise.all([
      refetchFunds(),
      refetchPositions(),
      refetchAnalytics(),
    ]);
    setLastUpdateTime(Date.now());
  }, [refetchFunds, refetchPositions, refetchAnalytics]);
  
  const value: PortfolioContextValue = {
    ...metrics,
    isInitialized,
    lastUpdateTime,
    refetch,
  };
  
  return (
    <PortfolioContext.Provider value={value}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio(): PortfolioContextValue {
  const context = useContext(PortfolioContext);
  if (!context) {
    throw new Error('usePortfolio must be used within a PortfolioProvider');
  }
  return context;
}

// Convenience hook for components that only need portfolio value
export function usePortfolioValue(): { 
  value: number; 
  pnl: number; 
  isLoading: boolean;
  isInitialized: boolean;
} {
  const { portfolioValue, totalPnL, isLoading, isInitialized } = usePortfolio();
  return { 
    value: portfolioValue, 
    pnl: totalPnL, 
    isLoading,
    isInitialized,
  };
}
