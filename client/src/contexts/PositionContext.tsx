/**
 * PositionContext - Centralized Position Data Provider
 * 
 * Single source of truth for position data across the entire application.
 * Eliminates duplicate fetching and ensures header and pages show consistent data.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';

export interface Position {
  id: string;
  exchange: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  stopLoss: number;
  takeProfit: number;
  trailingStop?: number;
  entryTime: string;
  reasoning?: string;
  kellySize?: number;
  atrMultiplier?: number;
  strategy?: string;
  status: 'open' | 'partial' | 'closing';
  lastTickTime?: number;
  priceDirection?: 'up' | 'down' | 'neutral';
  previousPrice?: number;
}

interface PositionContextValue {
  positions: Position[];
  isLoading: boolean;
  error: string | null;
  lastUpdateTime: number;
  refetch: () => Promise<void>;
  // Computed metrics for header
  totalPnL: number;
  openPositionCount: number;
}

const PositionContext = createContext<PositionContextValue | null>(null);

// Singleton fetch controller to prevent duplicate requests
let globalFetchInProgress = false;
let globalLastFetchTime = 0;
const FETCH_DEBOUNCE_MS = 2000; // Minimum time between fetches

export function PositionProvider({ children }: { children: ReactNode }) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(Date.now());
  
  const { user } = useAuth();
  const fetchIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const fetchPositions = useCallback(async () => {
    // Prevent duplicate fetches
    const now = Date.now();
    if (globalFetchInProgress || (now - globalLastFetchTime < FETCH_DEBOUNCE_MS)) {
      console.log('[PositionContext] Skipping fetch - debounced or in progress');
      return;
    }

    if (!user) {
      setPositions([]);
      setIsLoading(false);
      return;
    }

    globalFetchInProgress = true;
    globalLastFetchTime = now;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // Increased timeout for slow connections

      const response = await fetch('/api/positions/live', {
        credentials: 'include',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!mountedRef.current) return;

      if (response.ok) {
        const data = await response.json();
        const parsedPositions: Position[] = (data.positions || []).map((pos: any) => ({
          ...pos,
          id: String(pos.id),
          entryPrice: Number(pos.entryPrice) || 0,
          currentPrice: Number(pos.currentPrice) || 0,
          quantity: Number(pos.quantity) || 0,
          unrealizedPnl: Number(pos.unrealizedPnl) || 0,
          unrealizedPnlPercent: Number(pos.unrealizedPnlPercent) || 0,
          stopLoss: Number(pos.stopLoss) || 0,
          takeProfit: Number(pos.takeProfit) || 0,
        }));
        
        setPositions(parsedPositions);
        setError(null);
        setLastUpdateTime(Date.now());
        console.log('[PositionContext] Fetched', parsedPositions.length, 'positions');
      } else if (response.status === 504) {
        console.warn('[PositionContext] Gateway timeout, will retry');
      } else if (response.status === 401) {
        setPositions([]);
        setError('Not authenticated');
      } else {
        setError(`Failed to fetch positions: ${response.status}`);
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      
      if (err.name === 'AbortError') {
        console.warn('[PositionContext] Fetch timed out');
      } else {
        console.error('[PositionContext] Fetch error:', err);
        setError(err.message);
      }
    } finally {
      globalFetchInProgress = false;
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [user]);

  // Initial fetch and polling
  useEffect(() => {
    mountedRef.current = true;
    
    // Initial fetch
    fetchPositions();
    
    // Set up polling interval (5 seconds)
    fetchIntervalRef.current = setInterval(fetchPositions, 5000);

    return () => {
      mountedRef.current = false;
      if (fetchIntervalRef.current) {
        clearInterval(fetchIntervalRef.current);
      }
    };
  }, [fetchPositions]);

  // Computed metrics
  const totalPnL = positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
  const openPositionCount = positions.length;

  const value: PositionContextValue = {
    positions,
    isLoading,
    error,
    lastUpdateTime,
    refetch: fetchPositions,
    totalPnL,
    openPositionCount,
  };

  return (
    <PositionContext.Provider value={value}>
      {children}
    </PositionContext.Provider>
  );
}

export function usePositions(): PositionContextValue {
  const context = useContext(PositionContext);
  if (!context) {
    throw new Error('usePositions must be used within a PositionProvider');
  }
  return context;
}

// Hook for components that only need position count (header)
export function usePositionCount(): { count: number; totalPnL: number; isLoading: boolean } {
  const { openPositionCount, totalPnL, isLoading } = usePositions();
  return { count: openPositionCount, totalPnL, isLoading };
}
