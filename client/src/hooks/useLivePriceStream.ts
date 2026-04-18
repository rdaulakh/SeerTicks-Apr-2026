/**
 * useLivePriceStream Hook - Enhanced Real-Time Price Streaming
 * 
 * Provides millisecond-level price updates with:
 * - Direct Socket.IO connection to priceFeedService
 * - Price change detection with direction indicators
 * - Automatic reconnection with exponential backoff
 * - Visual flash animations for price movements
 * - P&L calculation helpers
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';

export interface LivePriceData {
  symbol: string;
  price: number;
  previousPrice: number;
  timestamp: number;
  source: 'websocket' | 'rest' | 'cache';
  volume24h?: number;
  change24h?: number;
  direction: 'up' | 'down' | 'neutral';
  lastChangeTime: number;
}

export interface PriceFlash {
  symbol: string;
  direction: 'up' | 'down';
  timestamp: number;
}

interface UseLivePriceStreamOptions {
  symbols: string[];
  onPriceUpdate?: (price: LivePriceData) => void;
  updateThrottleMs?: number; // Minimum time between UI updates per symbol
}

export function useLivePriceStream(options: UseLivePriceStreamOptions) {
  const { symbols, onPriceUpdate, updateThrottleMs = 50 } = options;
  
  const [prices, setPrices] = useState<Map<string, LivePriceData>>(new Map());
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  const [priceFlashes, setPriceFlashes] = useState<Map<string, PriceFlash>>(new Map());
  
  const socketRef = useRef<Socket | null>(null);
  const previousPricesRef = useRef<Map<string, number>>(new Map());
  const lastUpdateTimeRef = useRef<Map<string, number>>(new Map());
  const reconnectAttempts = useRef(0);
  const isUnmountedRef = useRef(false);
  
  // Memoize symbols string to prevent unnecessary reconnections
  const symbolsKey = useMemo(() => symbols.sort().join(','), [symbols]);

  const handlePriceUpdate = useCallback((data: any[] | any) => {
    const updates = Array.isArray(data) ? data : [data];
    const now = Date.now();
    
    setPrices(prev => {
      const newPrices = new Map(prev);
      const newFlashes = new Map<string, PriceFlash>();
      
      updates.forEach(update => {
        if (!update?.symbol || typeof update.price !== 'number') return;
        
        const symbol = update.symbol;
        const newPrice = update.price;
        
        // Throttle updates per symbol
        const lastSymbolUpdate = lastUpdateTimeRef.current.get(symbol) || 0;
        if (now - lastSymbolUpdate < updateThrottleMs) return;
        lastUpdateTimeRef.current.set(symbol, now);
        
        // Get previous price for direction detection
        const previousPrice = previousPricesRef.current.get(symbol) || newPrice;
        
        // Determine price direction
        let direction: 'up' | 'down' | 'neutral' = 'neutral';
        if (newPrice > previousPrice) {
          direction = 'up';
          newFlashes.set(symbol, { symbol, direction: 'up', timestamp: now });
        } else if (newPrice < previousPrice) {
          direction = 'down';
          newFlashes.set(symbol, { symbol, direction: 'down', timestamp: now });
        }
        
        // Update previous price reference
        previousPricesRef.current.set(symbol, newPrice);
        
        const priceData: LivePriceData = {
          symbol,
          price: newPrice,
          previousPrice,
          timestamp: update.timestamp || now,
          source: update.source || 'websocket',
          volume24h: update.volume24h,
          change24h: update.change24h,
          direction,
          lastChangeTime: direction !== 'neutral' ? now : (prev.get(symbol)?.lastChangeTime || now),
        };
        
        newPrices.set(symbol, priceData);
        
        // Call optional callback
        if (onPriceUpdate) {
          onPriceUpdate(priceData);
        }
      });
      
      // Update flashes
      if (newFlashes.size > 0) {
        setPriceFlashes(newFlashes);
        // Clear flashes after animation duration
        setTimeout(() => {
          setPriceFlashes(new Map());
        }, 300);
      }
      
      return newPrices;
    });
    
    setLastUpdate(now);
  }, [onPriceUpdate, updateThrottleMs]);

  // Connect to Socket.IO
  useEffect(() => {
    if (symbols.length === 0) return;
    
    console.log('[useLivePriceStream] Connecting for symbols:', symbols);
    
    const socket = io({
      path: '/api/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity, // Phase 37: NEVER give up
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000, // Phase 37: Cap at 30s
      timeout: 10000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[useLivePriceStream] ✅ Connected to price feed');
      setConnected(true);
      reconnectAttempts.current = 0;
      
      // Subscribe to symbols
      if (symbols.length > 0) {
        socket.emit('subscribe', symbols);
        console.log('[useLivePriceStream] Subscribed to:', symbols);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('[useLivePriceStream] ⚠️ Disconnected:', reason);
      setConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.warn('[useLivePriceStream] Connection error:', error.message);
      reconnectAttempts.current++;
    });

    // Handle initial prices on connection
    socket.on('initial_prices', (prices: any[]) => {
      console.log('[useLivePriceStream] Received initial prices:', prices.length);
      handlePriceUpdate(prices);
    });

    // Handle real-time price updates
    socket.on('price_update', (data: any[] | any) => {
      handlePriceUpdate(data);
    });

    // Phase 37: Reconnect when tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !isUnmountedRef.current) {
        if (!socketRef.current?.connected) {
          console.log('[useLivePriceStream] Tab visible — reconnecting');
          reconnectAttempts.current = 0;
          socket.connect();
        }
      }
    };

    const handleFocus = () => {
      if (!isUnmountedRef.current && !socketRef.current?.connected) {
        console.log('[useLivePriceStream] Window focused — reconnecting');
        reconnectAttempts.current = 0;
        socket.connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    isUnmountedRef.current = false;

    return () => {
      isUnmountedRef.current = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      console.log('[useLivePriceStream] Cleaning up connection');
      if (symbols.length > 0) {
        socket.emit('unsubscribe', symbols);
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, [symbolsKey, handlePriceUpdate]);

  // Helper to get price for a specific symbol
  const getPrice = useCallback((symbol: string): LivePriceData | undefined => {
    return prices.get(symbol);
  }, [prices]);

  // Helper to get price flash for a symbol
  const getPriceFlash = useCallback((symbol: string): PriceFlash | undefined => {
    return priceFlashes.get(symbol);
  }, [priceFlashes]);

  // Calculate P&L for a position
  const calculatePnL = useCallback((
    symbol: string,
    entryPrice: number,
    quantity: number,
    side: 'long' | 'short'
  ): { pnl: number; pnlPercent: number; currentPrice: number } => {
    const priceData = prices.get(symbol);
    const currentPrice = priceData?.price || entryPrice;
    
    const direction = side === 'long' ? 1 : -1;
    const priceDiff = (currentPrice - entryPrice) * direction;
    const pnl = priceDiff * quantity;
    const pnlPercent = entryPrice > 0 ? (priceDiff / entryPrice) * 100 : 0;
    
    return { pnl, pnlPercent, currentPrice };
  }, [prices]);

  // Manual subscribe/unsubscribe
  const subscribe = useCallback((newSymbols: string[]) => {
    if (socketRef.current?.connected && newSymbols.length > 0) {
      socketRef.current.emit('subscribe', newSymbols);
    }
  }, []);

  const unsubscribe = useCallback((symbolsToRemove: string[]) => {
    if (socketRef.current?.connected && symbolsToRemove.length > 0) {
      socketRef.current.emit('unsubscribe', symbolsToRemove);
    }
  }, []);

  return {
    prices,
    connected,
    lastUpdate,
    priceFlashes,
    getPrice,
    getPriceFlash,
    calculatePnL,
    subscribe,
    unsubscribe,
  };
}

/**
 * Hook for calculating live P&L for positions
 */
export function useLivePositionPnL(
  positions: Array<{
    id: string;
    symbol: string;
    entryPrice: number;
    quantity: number;
    side: 'long' | 'short';
  }>
) {
  // Get unique symbols from positions
  const symbols = useMemo(() => 
    [...new Set(positions.map(p => p.symbol))],
    [positions]
  );

  const { prices, connected, priceFlashes, calculatePnL } = useLivePriceStream({
    symbols,
  });

  // Calculate P&L for all positions
  const positionsWithPnL = useMemo(() => {
    return positions.map(pos => {
      const { pnl, pnlPercent, currentPrice } = calculatePnL(
        pos.symbol,
        pos.entryPrice,
        pos.quantity,
        pos.side
      );
      
      const priceData = prices.get(pos.symbol);
      const flash = priceFlashes.get(pos.symbol);
      
      return {
        ...pos,
        currentPrice,
        unrealizedPnl: pnl,
        unrealizedPnlPercent: pnlPercent,
        priceDirection: priceData?.direction || 'neutral',
        previousPrice: priceData?.previousPrice,
        lastTickTime: priceData?.timestamp,
        priceFlash: flash?.direction,
      };
    });
  }, [positions, prices, priceFlashes, calculatePnL]);

  // Calculate totals
  const totals = useMemo(() => {
    let totalValue = 0;
    let totalPnL = 0;
    let winningCount = 0;
    let losingCount = 0;

    positionsWithPnL.forEach(pos => {
      const posValue = pos.currentPrice * pos.quantity;
      totalValue += posValue;
      totalPnL += pos.unrealizedPnl;
      
      if (pos.unrealizedPnl > 0) winningCount++;
      else if (pos.unrealizedPnl < 0) losingCount++;
    });

    return {
      totalValue,
      totalPnL,
      totalPnLPercent: totalValue > 0 ? (totalPnL / totalValue) * 100 : 0,
      winningCount,
      losingCount,
    };
  }, [positionsWithPnL]);

  return {
    positions: positionsWithPnL,
    totals,
    connected,
    priceFlashes,
  };
}
