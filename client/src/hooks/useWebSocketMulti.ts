/**
 * useWebSocketMulti Hook
 * Connects to /ws/seer-multi for multi-exchange, multi-symbol real-time updates
 * 
 * CRITICAL: This hook must maintain stable references to prevent re-render loops
 * - Uses refs for WebSocket and reconnection state
 * - Batches state updates to prevent cascading re-renders
 * - Debounces reconnection attempts
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

export interface SymbolTickData {
  exchangeId: number;
  exchangeName: string;
  symbol: string;
  signals: any[];
  recommendation: any;
  decision: any;
  state: any;
  // Direct price properties from server (SymbolOrchestrator.getStatus())
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

export interface WebSocketMultiState {
  connected: boolean;
  lastTick: MultiTickData | null;
  symbolStates: Map<string, SymbolTickData>;
  positions: any[];
  engineStatus: any | null;
  error: string | null;
  
  // New real-time data fields
  tradingStats: TradingStats | null;
  activityFeed: any[];
  healthMetrics: any | null;
  latencyMetrics: any | null;
  marketData: any | null;
  agentSignals: any[] | null;
  consensus: any | null;
  
  // Real-time price updates (every tick)
  priceUpdates: Map<string, PriceTickData>;
  lastPriceUpdate: PriceTickData | null;
}

const initialState: WebSocketMultiState = {
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

export function useWebSocketMulti(userId?: number, autoConnect: boolean = true) {
  const [state, setState] = useState<WebSocketMultiState>(initialState);

  // Use refs for all mutable state to prevent re-render loops
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const userIdRef = useRef<number | undefined>(userId);
  const isConnecting = useRef(false);
  const hasConnected = useRef(false);
  const maxReconnectAttempts = 5;

  // Update userIdRef when userId changes
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  // Stable connect function using useCallback with no dependencies
  const connect = useCallback(() => {
    // Prevent multiple simultaneous connection attempts
    if (isConnecting.current) {
      console.log('[useWebSocketMulti] Connection already in progress, skipping');
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[useWebSocketMulti] Already connected');
      return;
    }

    // Stop reconnecting after max attempts
    if (reconnectAttempts.current >= maxReconnectAttempts) {
      console.warn('[useWebSocketMulti] Max reconnection attempts reached, stopping reconnection');
      setState(prev => ({ ...prev, error: 'Failed to connect after multiple attempts' }));
      return;
    }

    isConnecting.current = true;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const url = `${protocol}//${host}/ws/seer-multi`;

      console.log('[useWebSocketMulti] Connecting to', url, `(attempt ${reconnectAttempts.current + 1})`);
      const ws = new WebSocket(url);

      // Set a connection timeout
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.warn('[useWebSocketMulti] Connection timeout, closing socket');
          isConnecting.current = false;
          ws.close();
        }
      }, 10000); // 10 second timeout

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        isConnecting.current = false;
        hasConnected.current = true;
        console.log('[useWebSocketMulti] Connected');
        setState(prev => ({ ...prev, connected: true, error: null }));
        reconnectAttempts.current = 0;

        // Send auth message with userId from ref
        const currentUserId = userIdRef.current;
        if (currentUserId) {
          console.log('[useWebSocketMulti] 📤 Sending auth message with userId:', currentUserId);
          try {
            ws.send(JSON.stringify({ type: 'auth', userId: currentUserId }));
            console.log('[useWebSocketMulti] ✅ Auth message sent successfully');
          } catch (error) {
            console.error('[useWebSocketMulti] ❌ Failed to send auth message:', error);
          }
        } else {
          console.log('[useWebSocketMulti] ⚠️ No userId available, sending request_status');
          try {
            ws.send(JSON.stringify({ type: 'request_status' }));
          } catch (error) {
            console.error('[useWebSocketMulti] ❌ Failed to send request_status:', error);
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          if (!event.data || typeof event.data !== 'string') {
            return;
          }
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (error) {
          // Silently ignore parse errors to prevent console spam
        }
      };

      ws.onerror = () => {
        clearTimeout(connectionTimeout);
        isConnecting.current = false;
        // Silently handle errors - onclose will manage reconnection
      };

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        isConnecting.current = false;
        
        if (event.code !== 1000 && reconnectAttempts.current === 0) {
          console.log('[useWebSocketMulti] Disconnected, code:', event.code);
        }
        
        setState(prev => ({ ...prev, connected: false }));
        wsRef.current = null;

        // Attempt reconnection with exponential backoff
        if (autoConnect && reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          if (reconnectAttempts.current < 3) {
            console.log(`[useWebSocketMulti] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1}/${maxReconnectAttempts})...`);
          }
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            connect();
          }, delay);
        } else if (reconnectAttempts.current >= maxReconnectAttempts) {
          console.error('[useWebSocketMulti] Max reconnection attempts reached');
          setState(prev => ({ 
            ...prev, 
            error: 'Connection lost. Please refresh the page.' 
          }));
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[useWebSocketMulti] Connection failed:', error);
      isConnecting.current = false;
      setState(prev => ({ ...prev, error: 'Failed to establish connection' }));
    }
  }, []); // No dependencies - uses refs

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setState(initialState);
  }, []);

  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'multi_tick':
        handleMultiTick(message.data);
        break;

      case 'status':
        handleStatus(message.data);
        break;

      case 'symbol_tick':
        handleSymbolTick(message.data);
        break;

      case 'position':
        handlePosition(message.data);
        break;

      case 'trading_stats':
        setState(prev => ({ ...prev, tradingStats: message.data }));
        break;

      case 'activity':
        setState(prev => ({
          ...prev,
          activityFeed: [message.data, ...prev.activityFeed].slice(0, 100),
        }));
        break;

      case 'health':
        setState(prev => ({ ...prev, healthMetrics: message.data }));
        break;

      case 'latency':
        setState(prev => ({ ...prev, latencyMetrics: message.data }));
        break;

      case 'market_data':
        setState(prev => ({ ...prev, marketData: message.data }));
        break;

      case 'agent_signals':
        setState(prev => ({ ...prev, agentSignals: message.data }));
        break;

      case 'consensus':
        setState(prev => ({ ...prev, consensus: message.data }));
        break;
      
      case 'position_prices':
        setState(prev => {
          const updatedPositions = (prev.positions || []).map(position => {
            const priceUpdate = message.data.find((p: any) => p.positionId === position.id);
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
        break;

      // ============================================
      // REAL-TIME PRICE TICK HANDLER
      // Receives every price tick from priceFeedService
      // ============================================
      case 'price_tick':
        setState(prev => {
          const priceData = message.data as PriceTickData;
          const newPriceUpdates = new Map(prev.priceUpdates);
          newPriceUpdates.set(priceData.symbol, priceData);
          
          // Also update symbolStates with the new price
          const newSymbolStates = new Map(prev.symbolStates);
          newSymbolStates.forEach((symbolState, key) => {
            if (symbolState.symbol === priceData.symbol) {
              newSymbolStates.set(key, {
                ...symbolState,
                currentPrice: priceData.price,
              });
            }
          });
          
          // Also update positions with the new price for real-time P&L
          const updatedPositions = (prev.positions || []).map(position => {
            if (position.symbol === priceData.symbol) {
              const entryPrice = parseFloat(position.entryPrice || position.entry_price || '0');
              const quantity = parseFloat(position.quantity || '0');
              const currentPrice = priceData.price;
              
              // Calculate P&L
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
            lastPriceUpdate: priceData,
            symbolStates: newSymbolStates,
            positions: updatedPositions,
          };
        });
        break;

      default:
        // Silently ignore unknown message types
        break;
    }
  }, []);

  const handleMultiTick = useCallback((data: MultiTickData) => {
    setState(prev => {
      const newSymbolStates = new Map(prev.symbolStates);
      data.results.forEach(result => {
        const key = `${result.exchangeId}-${result.symbol}`;
        newSymbolStates.set(key, result);
      });
      return {
        ...prev,
        lastTick: data,
        symbolStates: newSymbolStates,
      };
    });
  }, []);

  const handleStatus = useCallback((data: any) => {
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
  }, []);

  const handleSymbolTick = useCallback((data: SymbolTickData | null) => {
    if (!data) return;
    setState(prev => {
      const newSymbolStates = new Map(prev.symbolStates);
      const key = `${data.exchangeId}-${data.symbol}`;
      newSymbolStates.set(key, data);
      return {
        ...prev,
        symbolStates: newSymbolStates,
      };
    });
  }, []);

  const handlePosition = useCallback((data: any) => {
    if (data.action === 'list') {
      setState(prev => ({ ...prev, positions: data.positions }));
    }
  }, []);

  const requestSymbolState = useCallback((exchangeId: number, symbol: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'request_symbol_state',
        exchangeId,
        symbol,
      }));
    }
  }, []);

  const requestPositions = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'request_positions',
      }));
    }
  }, []);

  // Initial connection - runs once on mount
  useEffect(() => {
    if (autoConnect && !hasConnected.current) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  // Handle userId changes - send auth message if already connected
  // CRITICAL SAFEGUARD: Clear stale data when userId changes to prevent cross-user data leakage
  useEffect(() => {
    if (!userId) return;
    
    // Clear any existing data when userId changes to prevent showing stale data from another user
    setState(prev => ({
      ...initialState,
      connected: prev.connected, // Preserve connection state
    }));
    
    // If already connected, send auth message to get fresh data for this user
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[useWebSocketMulti] 📤 Sending auth for userId:', userId, '(clearing stale data)');
      wsRef.current.send(JSON.stringify({ type: 'auth', userId }));
    }
    // If not connected and autoConnect is enabled, the initial effect will handle connection
  }, [userId]);

  // Memoize the return value to prevent unnecessary re-renders in consumers
  return useMemo(() => ({
    ...state,
    connect,
    disconnect,
    requestSymbolState,
    requestPositions,
  }), [state, connect, disconnect, requestSymbolState, requestPositions]);
}
