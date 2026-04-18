/**
 * WebSocket Hook for SEER Real-time Updates
 * 
 * Phase 37 FIX: Persistent connection that NEVER gives up.
 * - Infinite reconnection with exponential backoff (capped at 30s)
 * - visibilitychange handler: reconnects immediately when tab becomes visible
 * - Resets reconnect counter on successful connection
 * - Server-side engine keeps running regardless of client state
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export interface AgentSignalData {
  agentName: string;
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  strength: number;
  reasoning: string;
}

export interface RecommendationData {
  action: 'buy' | 'sell' | 'hold' | 'reduce' | 'exit';
  confidence: number;
  strength: number;
  positionSize: number;
  reasoning: string;
  consensusScore: number;
  isAlphaSignal: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  expectedReturn: number;
  riskRewardRatio: number;
}

export interface ExecutionDecisionData {
  shouldExecute: boolean;
  direction: 'long' | 'short' | 'hold';
  positionSize: number;
  confidence: number;
  threshold: number;
  tradeType: 'MAX' | 'HIGH' | 'STRONG' | 'STANDARD' | 'MODERATE' | 'SCOUT' | 'NONE';
  reasoning: string;
}

export interface PositionData {
  id: number;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  riskRewardRatio: number;
  partialExits: Array<{
    price: number;
    quantity: number;
    timestamp: number;
  }>;
}

export interface TickData {
  tickCount: number;
  timestamp: number;
  signals: AgentSignalData[];
  recommendation: RecommendationData;
  decision: ExecutionDecisionData;
  positions: PositionData[];
}

export interface WebSocketMessage {
  type: 'tick' | 'signal' | 'recommendation' | 'decision' | 'position' | 'health' | 'error' | 'status';
  timestamp: number;
  data: any;
}

export interface SEERStatus {
  isRunning: boolean;
  currentSymbol: string;
  tickCount: number;
  lastTickTime: number;
  activePositions: number;
  totalPnL: number;
  agentsHealthy: number;
  agentsTotal: number;
}

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastTick, setLastTick] = useState<TickData | null>(null);
  const [status, setStatus] = useState<SEERStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isUnmountedRef = useRef(false);
  const connectRef = useRef<() => void>(undefined);

  const connect = useCallback(() => {
    // Don't reconnect if component is unmounted
    if (isUnmountedRef.current) return;

    // Clear any existing connection
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws/seer`;

      console.log('[WebSocket] Connecting to', wsUrl);
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[WebSocket] Connected');
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0; // Reset on success
        ws.send(JSON.stringify({ type: 'get_status' }));
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          switch (message.type) {
            case 'tick':
              setLastTick(message.data);
              break;
            case 'status':
              setStatus(message.data);
              break;
            case 'position':
              console.log('[WebSocket] Position update:', message.data);
              break;
            case 'error':
              console.error('[WebSocket] Server error:', message.data);
              setError(message.data.message);
              break;
            default:
              break;
          }
        } catch (err) {
          console.error('[WebSocket] Failed to parse message:', err);
        }
      };

      ws.onerror = (event) => {
        console.error('[WebSocket] Error:', event);
      };

      ws.onclose = () => {
        console.log('[WebSocket] Disconnected');
        setIsConnected(false);

        // Phase 37: INFINITE reconnection — never give up
        if (!isUnmountedRef.current) {
          const delay = Math.min(1000 * Math.pow(1.5, Math.min(reconnectAttemptsRef.current, 15)), 30000);
          console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connectRef.current?.();
          }, delay);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('[WebSocket] Failed to create connection:', err);
      setError('Failed to create WebSocket connection');
      
      // Even on creation failure, retry
      if (!isUnmountedRef.current) {
        const delay = Math.min(2000 * Math.pow(1.5, Math.min(reconnectAttemptsRef.current, 15)), 30000);
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          connectRef.current?.();
        }, delay);
      }
    }
  }, []);

  // Keep connect ref updated for use in closures
  connectRef.current = connect;

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const sendMessage = useCallback((message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('[WebSocket] Cannot send message: not connected');
    }
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    isUnmountedRef.current = false;
    connect();

    // Phase 37: Reconnect when tab becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[WebSocket] Tab became visible — checking connection');
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          console.log('[WebSocket] Connection dead — reconnecting immediately');
          reconnectAttemptsRef.current = 0; // Reset attempts on manual trigger
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
          connect();
        }
      }
    };

    // Phase 37: Also reconnect on window focus (covers more browser scenarios)
    const handleFocus = () => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.log('[WebSocket] Window focused — reconnecting');
        reconnectAttemptsRef.current = 0;
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isConnected,
    lastTick,
    status,
    error,
    sendMessage,
    reconnect: connect,
  };
}
