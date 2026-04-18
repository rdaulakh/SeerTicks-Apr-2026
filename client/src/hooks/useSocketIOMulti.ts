/**
 * useSocketIOMulti Hook
 * 
 * Socket.IO-based real-time data hook for multi-exchange, multi-symbol updates.
 * Uses Socket.IO instead of raw WebSocket for better proxy compatibility and
 * automatic reconnection in production environments.
 * 
 * This hook connects to the same Socket.IO server as priceFeedService (/api/socket.io)
 * and handles all real-time data including:
 * - Price ticks
 * - Trading stats
 * - Agent signals
 * - Consensus updates
 * - Position updates
 * - Health metrics
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';

export interface SymbolTickData {
  exchangeId: number;
  exchangeName: string;
  symbol: string;
  signals: any[];
  recommendation: any;
  decision: any;
  state: any;
  currentPrice?: number;
  priceChange24h?: number;
}

export interface MultiTickData {
  tickCount: number;
  timestamp: number;
  results: SymbolTickData[];
  status: any;
}

export interface TradingStats {
  balance: number;
  equity: number;
  unrealizedPnL: number;
  realizedPnL: number;
  totalTrades: number;
  winRate: number;
  winningTrades: number;
  losingTrades: number;
  totalPnL: number;
  timestamp: number;
}

export interface PriceTickData {
  symbol: string;
  price: number;
  timestamp: number;
  source: string;
  volume24h?: number;
  change24h?: number;
}

export interface SocketIOMultiState {
  connected: boolean;
  lastTick: MultiTickData | null;
  symbolStates: Map<string, SymbolTickData>;
  positions: any[];
  engineStatus: any | null;
  error: string | null;
  tradingStats: TradingStats | null;
  activityFeed: any[];
  healthMetrics: any | null;
  latencyMetrics: any | null;
  marketData: any | null;
  agentSignals: any[] | null;
  consensus: any | null;
  priceUpdates: Map<string, PriceTickData>;
  lastPriceUpdate: PriceTickData | null;
}

const initialState: SocketIOMultiState = {
  connected: false,
  lastTick: null,
  symbolStates: new Map(),
  positions: [],
  engineStatus: null,
  error: null,
  tradingStats: null,
  activityFeed: [],
  healthMetrics: null,
  latencyMetrics: null,
  marketData: null,
  agentSignals: null,
  consensus: null,
  priceUpdates: new Map(),
  lastPriceUpdate: null,
};

export function useSocketIOMulti(userId?: number, autoConnect: boolean = true) {
  const [state, setState] = useState<SocketIOMultiState>(initialState);
  const socketRef = useRef<Socket | null>(null);
  const userIdRef = useRef<number | undefined>(userId);
  const reconnectAttempts = useRef(0);
  const isUnmountedRef = useRef(false);

  // Update userIdRef when userId changes
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const connect = useCallback(() => {
    // Check if already connected or connecting
    if (socketRef.current?.connected) {
      // Ensure state reflects actual connection status
      setState(prev => prev.connected ? prev : { ...prev, connected: true, error: null });
      return;
    }
    
    // If socket exists but not connected, clean it up first
    if (socketRef.current) {

      socketRef.current.disconnect();
      socketRef.current = null;
    }

    try {
      // OPTIMIZED: Faster initial connection for better UX
      // Server is already running - frontend is just a display layer

      const socket = io({
        path: '/api/socket.io',
        // Use WebSocket first for faster connection, fallback to polling
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity, // Phase 37: NEVER give up
        reconnectionDelay: 500,
        reconnectionDelayMax: 30000, // Phase 37: Cap at 30s
        timeout: 10000, // Reduced timeout for faster failure detection (was 45s)
        upgrade: true,
        forceNew: true,
        multiplex: false,
        withCredentials: false,
        // Add extra query params for debugging
        query: {
          t: Date.now(),
        },
      });

      socket.on('connect', () => {

        setState(prev => ({ ...prev, connected: true, error: null }));
        reconnectAttempts.current = 0;

        // Send auth message with userId
        const currentUserId = userIdRef.current;
        if (currentUserId) {

          socket.emit('auth', { userId: currentUserId });
        }

        // Subscribe to all price updates
        socket.emit('subscribe', ['BTC-USD', 'ETH-USD', 'SOL-USD']);
      });

      socket.on('disconnect', (reason) => {

        setState(prev => ({ ...prev, connected: false }));
      });

      socket.on('connect_error', (error) => {
        reconnectAttempts.current++;
        // Phase 37: Never give up — just log the attempt count
        if (reconnectAttempts.current % 10 === 0) {
          console.log(`[SocketIO] Reconnect attempt ${reconnectAttempts.current}...`);
        }
        setState(prev => ({ ...prev, connected: false }));
      });

      // Handle price ticks
      socket.on('price_tick', (data: PriceTickData) => {
        setState(prev => {
          const newPriceUpdates = new Map(prev.priceUpdates);
          newPriceUpdates.set(data.symbol, data);
          
          // Update symbolStates with new price
          const newSymbolStates = new Map(prev.symbolStates);
          newSymbolStates.forEach((symbolState, key) => {
            if (symbolState.symbol === data.symbol) {
              newSymbolStates.set(key, {
                ...symbolState,
                currentPrice: data.price,
              });
            }
          });
          
          // Update positions with new price for real-time P&L
          const updatedPositions = (prev.positions || []).map(position => {
            if (position.symbol === data.symbol) {
              const entryPrice = parseFloat(position.entryPrice || position.entry_price || '0');
              const quantity = parseFloat(position.quantity || '0');
              const currentPrice = data.price;
              
              let unrealizedPnl: number;
              if (position.side === 'long') {
                unrealizedPnl = (currentPrice - entryPrice) * quantity;
              } else {
                unrealizedPnl = (entryPrice - currentPrice) * quantity;
              }
              const unrealizedPnlPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
              
              return {
                ...position,
                currentPrice,
                unrealizedPnl,
                unrealizedPnlPercent: position.side === 'long' ? unrealizedPnlPercent : -unrealizedPnlPercent,
              };
            }
            return position;
          });
          
          return {
            ...prev,
            priceUpdates: newPriceUpdates,
            lastPriceUpdate: data,
            symbolStates: newSymbolStates,
            positions: updatedPositions,
          };
        });
      });

      // Handle initial prices
      socket.on('initial_prices', (prices: PriceTickData[]) => {
        setState(prev => {
          const newPriceUpdates = new Map(prev.priceUpdates);
          prices.forEach(price => {
            newPriceUpdates.set(price.symbol, price);
          });
          return { ...prev, priceUpdates: newPriceUpdates };
        });
      });

      // Handle price sync
      socket.on('price_sync', (prices: PriceTickData[]) => {
        setState(prev => {
          const newPriceUpdates = new Map(prev.priceUpdates);
          prices.forEach(price => {
            newPriceUpdates.set(price.symbol, price);
          });
          return { ...prev, priceUpdates: newPriceUpdates };
        });
      });

      // Handle multi-engine events (forwarded from WebSocket server)
      socket.on('multi_tick', (data: MultiTickData) => {
        setState(prev => {
          const newSymbolStates = new Map(prev.symbolStates);
          data.results.forEach(result => {
            const key = `${result.exchangeId}-${result.symbol}`;
            newSymbolStates.set(key, result);
          });
          return { ...prev, lastTick: data, symbolStates: newSymbolStates };
        });
      });

      socket.on('status', (data: any) => {
        setState(prev => {
          const newSymbolStates = new Map(prev.symbolStates);
          if (data.symbols) {
            data.symbols.forEach((symbolState: SymbolTickData) => {
              const key = `${symbolState.exchangeId}-${symbolState.symbol}`;
              newSymbolStates.set(key, symbolState);
            });
          }
          return {
            ...prev,
            symbolStates: newSymbolStates,
            positions: data.positions || prev.positions,
            engineStatus: data.engine || prev.engineStatus,
          };
        });
      });

      socket.on('trading_stats', (data: TradingStats) => {
        setState(prev => ({ ...prev, tradingStats: data }));
      });

      socket.on('activity', (data: any) => {
        setState(prev => ({
          ...prev,
          activityFeed: [data, ...prev.activityFeed].slice(0, 100),
        }));
      });

      socket.on('health', (data: any) => {
        setState(prev => ({ ...prev, healthMetrics: data }));
      });

      socket.on('latency', (data: any) => {
        setState(prev => ({ ...prev, latencyMetrics: data }));
      });

      socket.on('market_data', (data: any) => {
        setState(prev => ({ ...prev, marketData: data }));
      });

      socket.on('agent_signals', (data: any) => {
        setState(prev => ({ ...prev, agentSignals: data }));
      });

      socket.on('consensus', (data: any) => {
        setState(prev => ({ ...prev, consensus: data }));
      });

      socket.on('position_prices', (data: any) => {
        setState(prev => {
          const updatedPositions = (prev.positions || []).map(position => {
            const priceUpdate = data.find((p: any) => p.positionId === position.id);
            if (priceUpdate) {
              return {
                ...position,
                currentPrice: priceUpdate.currentPrice,
                unrealizedPnl: priceUpdate.unrealizedPnl,
                unrealizedPnlPercent: priceUpdate.unrealizedPnlPercent,
                stopLoss: priceUpdate.stopLoss,
                takeProfit: priceUpdate.takeProfit,
              };
            }
            return position;
          });
          return { ...prev, positions: updatedPositions };
        });
      });

      socketRef.current = socket;

    } catch (error) {

      setState(prev => ({ ...prev, error: 'Failed to establish connection' }));
    }
  }, []);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setState(initialState);
  }, []);

  const requestSymbolState = useCallback((exchangeId: number, symbol: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('request_symbol_state', { exchangeId, symbol });
    }
  }, []);

  const requestPositions = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('request_positions');
    }
  }, []);

  // Initial connection + Phase 37: visibilitychange reconnection
  useEffect(() => {
    isUnmountedRef.current = false;
    if (autoConnect) {
      connect();
    }

    // Phase 37: Reconnect when tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !isUnmountedRef.current) {
        if (!socketRef.current?.connected) {
          console.log('[SocketIO] Tab visible — reconnecting');
          reconnectAttempts.current = 0;
          connect();
        }
      }
    };

    const handleFocus = () => {
      if (!isUnmountedRef.current && !socketRef.current?.connected) {
        console.log('[SocketIO] Window focused — reconnecting');
        reconnectAttempts.current = 0;
        connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      isUnmountedRef.current = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  // Handle userId changes
  useEffect(() => {
    if (!userId) return;
    
    // Clear stale data when userId changes
    setState(prev => ({
      ...initialState,
      connected: prev.connected,
    }));
    
    // Send auth message if connected
    if (socketRef.current?.connected) {

      socketRef.current.emit('auth', { userId });
    }
  }, [userId]);

  return useMemo(() => ({
    ...state,
    connect,
    disconnect,
    requestSymbolState,
    requestPositions,
  }), [state, connect, disconnect, requestSymbolState, requestPositions]);
}
