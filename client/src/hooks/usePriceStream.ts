/**
 * usePriceStream Hook
 * Real-time price streaming via Socket.IO for millisecond-level updates
 * Connects to priceFeedService on /api/socket.io
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export interface PriceData {
  symbol: string;
  price: number;
  timestamp: number;
  source: 'websocket' | 'rest' | 'cache';
  volume24h?: number;
  change24h?: number;
}

export interface PriceStreamState {
  prices: Map<string, PriceData>;
  connected: boolean;
  lastUpdate: number;
}

export interface PriceChange {
  symbol: string;
  previousPrice: number;
  currentPrice: number;
  direction: 'up' | 'down' | 'neutral';
  timestamp: number;
}

export function usePriceStream(symbols?: string[]) {
  const [state, setState] = useState<PriceStreamState>({
    prices: new Map(),
    connected: false,
    lastUpdate: Date.now(),
  });
  
  const [priceChanges, setPriceChanges] = useState<Map<string, PriceChange>>(new Map());
  const socketRef = useRef<Socket | null>(null);
  const previousPricesRef = useRef<Map<string, number>>(new Map());

  const handlePriceUpdate = useCallback((data: PriceData[] | PriceData) => {
    const updates = Array.isArray(data) ? data : [data];
    
    setState(prev => {
      const newPrices = new Map(prev.prices);
      const newChanges = new Map(priceChanges);
      
      updates.forEach(price => {
        const previousPrice = previousPricesRef.current.get(price.symbol);
        
        // Detect price direction
        if (previousPrice !== undefined && previousPrice !== price.price) {
          const direction: 'up' | 'down' | 'neutral' = 
            price.price > previousPrice ? 'up' : 
            price.price < previousPrice ? 'down' : 'neutral';
          
          newChanges.set(price.symbol, {
            symbol: price.symbol,
            previousPrice,
            currentPrice: price.price,
            direction,
            timestamp: Date.now(),
          });
        }
        
        // Update previous price reference
        previousPricesRef.current.set(price.symbol, price.price);
        
        // Update current price
        newPrices.set(price.symbol, price);
      });
      
      // Update price changes state (for animations)
      setPriceChanges(newChanges);
      
      return {
        ...prev,
        prices: newPrices,
        lastUpdate: Date.now(),
      };
    });
  }, [priceChanges]);

  useEffect(() => {
    // Connect to Socket.IO server
    const socket = io({
      path: '/api/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[usePriceStream] Connected to price feed');
      setState(prev => ({ ...prev, connected: true }));
      
      // Subscribe to specific symbols if provided
      if (symbols && symbols.length > 0) {
        socket.emit('subscribe', symbols);
      }
    });

    socket.on('disconnect', () => {
      console.log('[usePriceStream] Disconnected from price feed');
      setState(prev => ({ ...prev, connected: false }));
    });

    socket.on('initial_prices', (prices: PriceData[]) => {
      console.log('[usePriceStream] Received initial prices:', prices.length);
      handlePriceUpdate(prices);
    });

    socket.on('price_update', (data: PriceData[] | PriceData) => {
      handlePriceUpdate(data);
    });

    socket.on('connect_error', (error) => {
      console.warn('[usePriceStream] Connection error:', error.message);
    });

    return () => {
      if (symbols && symbols.length > 0) {
        socket.emit('unsubscribe', symbols);
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, [symbols?.join(','), handlePriceUpdate]);

  // Clear price change after animation duration (500ms)
  useEffect(() => {
    if (priceChanges.size > 0) {
      const timeout = setTimeout(() => {
        setPriceChanges(new Map());
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [priceChanges]);

  const getPrice = useCallback((symbol: string): PriceData | undefined => {
    return state.prices.get(symbol);
  }, [state.prices]);

  const getPriceChange = useCallback((symbol: string): PriceChange | undefined => {
    return priceChanges.get(symbol);
  }, [priceChanges]);

  const subscribe = useCallback((newSymbols: string[]) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('subscribe', newSymbols);
    }
  }, []);

  const unsubscribe = useCallback((symbolsToRemove: string[]) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('unsubscribe', symbolsToRemove);
    }
  }, []);

  return {
    ...state,
    priceChanges,
    getPrice,
    getPriceChange,
    subscribe,
    unsubscribe,
  };
}
