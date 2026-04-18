/**
 * Real-Time Price Context
 * 
 * Centralized price feed management for institutional-grade trading platform.
 * Provides tick-by-tick price updates to all components via WebSocket.
 * Calculates live P&L for all open positions on every price tick.
 */

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';

export interface PriceTick {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
  bid?: number;
  ask?: number;
  spread?: number;
}

export interface PositionWithLiveData {
  id: string;
  symbol: string;
  exchange: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  previousPrice: number;
  priceDirection: 'up' | 'down' | 'neutral';
  quantity: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  stopLoss: number;
  takeProfit: number;
  trailingStop?: number;
  entryTime: string;
  strategy?: string;
  status: 'open' | 'partial' | 'closing';
  lastTickTime: number;
}

export interface PortfolioMetrics {
  totalEquity: number;
  totalUnrealizedPnl: number;
  totalUnrealizedPnlPercent: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  openPositions: number;
  winningPositions: number;
  losingPositions: number;
  largestWin: number;
  largestLoss: number;
  avgPositionSize: number;
  lastUpdateTime: number;
}

interface RealTimePriceContextType {
  prices: Map<string, PriceTick>;
  positions: PositionWithLiveData[];
  portfolioMetrics: PortfolioMetrics;
  isConnected: boolean;
  lastTickTime: number;
  tickCount: number;
  getPrice: (symbol: string) => PriceTick | undefined;
  subscribeToSymbol: (symbol: string) => void;
  unsubscribeFromSymbol: (symbol: string) => void;
}

const defaultPortfolioMetrics: PortfolioMetrics = {
  totalEquity: 0,
  totalUnrealizedPnl: 0,
  totalUnrealizedPnlPercent: 0,
  dailyPnl: 0,
  dailyPnlPercent: 0,
  openPositions: 0,
  winningPositions: 0,
  losingPositions: 0,
  largestWin: 0,
  largestLoss: 0,
  avgPositionSize: 0,
  lastUpdateTime: Date.now(),
};

const RealTimePriceContext = createContext<RealTimePriceContextType>({
  prices: new Map(),
  positions: [],
  portfolioMetrics: defaultPortfolioMetrics,
  isConnected: false,
  lastTickTime: 0,
  tickCount: 0,
  getPrice: () => undefined,
  subscribeToSymbol: () => {},
  unsubscribeFromSymbol: () => {},
});

export function useRealTimePrices() {
  return useContext(RealTimePriceContext);
}

interface Props {
  children: ReactNode;
  userId?: number;
}

export function RealTimePriceProvider({ children, userId }: Props) {
  const [prices, setPrices] = useState<Map<string, PriceTick>>(new Map());
  const [positions, setPositions] = useState<PositionWithLiveData[]>([]);
  const [portfolioMetrics, setPortfolioMetrics] = useState<PortfolioMetrics>(defaultPortfolioMetrics);
  const [isConnected, setIsConnected] = useState(false);
  const [lastTickTime, setLastTickTime] = useState(0);
  const [tickCount, setTickCount] = useState(0);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const positionsRef = useRef<PositionWithLiveData[]>([]);
  const subscribedSymbols = useRef<Set<string>>(new Set());

  // Calculate P&L for a position given current price
  const calculatePositionPnL = useCallback((
    position: PositionWithLiveData,
    currentPrice: number
  ): { pnl: number; pnlPercent: number } => {
    const direction = position.side === 'long' ? 1 : -1;
    const priceDiff = currentPrice - position.entryPrice;
    const pnl = priceDiff * position.quantity * direction;
    const pnlPercent = (priceDiff / position.entryPrice) * 100 * direction;
    return { pnl, pnlPercent };
  }, []);

  // Update positions with new price tick
  const updatePositionsWithPrice = useCallback((symbol: string, newPrice: number, timestamp: number) => {
    setPositions(prevPositions => {
      const updatedPositions = prevPositions.map(pos => {
        if (pos.symbol === symbol || pos.symbol.replace('-', '') === symbol || pos.symbol.replace('/', '') === symbol) {
          const { pnl, pnlPercent } = calculatePositionPnL(pos, newPrice);
          const priceDirection: 'up' | 'down' | 'neutral' = newPrice > pos.currentPrice ? 'up' : newPrice < pos.currentPrice ? 'down' : 'neutral';
          
          return {
            ...pos,
            previousPrice: pos.currentPrice,
            currentPrice: newPrice,
            priceDirection,
            unrealizedPnl: pnl,
            unrealizedPnlPercent: pnlPercent,
            lastTickTime: timestamp,
          };
        }
        return pos;
      });
      
      positionsRef.current = updatedPositions;
      return updatedPositions;
    });
  }, [calculatePositionPnL]);

  // Calculate portfolio metrics from positions
  const calculatePortfolioMetrics = useCallback((positions: PositionWithLiveData[]): PortfolioMetrics => {
    if (positions.length === 0) {
      return { ...defaultPortfolioMetrics, lastUpdateTime: Date.now() };
    }

    let totalUnrealizedPnl = 0;
    let totalPositionValue = 0;
    let winningCount = 0;
    let losingCount = 0;
    let largestWin = 0;
    let largestLoss = 0;

    positions.forEach(pos => {
      totalUnrealizedPnl += pos.unrealizedPnl;
      totalPositionValue += pos.currentPrice * pos.quantity;
      
      if (pos.unrealizedPnl > 0) {
        winningCount++;
        if (pos.unrealizedPnl > largestWin) largestWin = pos.unrealizedPnl;
      } else if (pos.unrealizedPnl < 0) {
        losingCount++;
        if (pos.unrealizedPnl < largestLoss) largestLoss = pos.unrealizedPnl;
      }
    });

    const avgPositionSize = totalPositionValue / positions.length;
    const totalUnrealizedPnlPercent = totalPositionValue > 0 
      ? (totalUnrealizedPnl / totalPositionValue) * 100 
      : 0;

    return {
      totalEquity: totalPositionValue + totalUnrealizedPnl,
      totalUnrealizedPnl,
      totalUnrealizedPnlPercent,
      dailyPnl: totalUnrealizedPnl, // Simplified - would need historical data for accurate daily P&L
      dailyPnlPercent: totalUnrealizedPnlPercent,
      openPositions: positions.length,
      winningPositions: winningCount,
      losingPositions: losingCount,
      largestWin,
      largestLoss,
      avgPositionSize,
      lastUpdateTime: Date.now(),
    };
  }, []);

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data);
      const now = Date.now();

      switch (message.type) {
        case 'price_tick':
        case 'ticker': {
          const data = message.data;
          const symbol = data.symbol || data.s;
          const price = parseFloat(data.price || data.c || data.lastPrice);
          
          if (symbol && !isNaN(price)) {
            const tick: PriceTick = {
              symbol,
              price,
              change24h: parseFloat(data.change24h || data.p || '0'),
              changePercent24h: parseFloat(data.changePercent24h || data.P || '0'),
              high24h: parseFloat(data.high24h || data.h || '0'),
              low24h: parseFloat(data.low24h || data.l || '0'),
              volume24h: parseFloat(data.volume24h || data.v || '0'),
              timestamp: now,
              bid: data.bid ? parseFloat(data.bid) : undefined,
              ask: data.ask ? parseFloat(data.ask) : undefined,
              spread: data.bid && data.ask ? parseFloat(data.ask) - parseFloat(data.bid) : undefined,
            };

            setPrices(prev => new Map(prev).set(symbol, tick));
            updatePositionsWithPrice(symbol, price, now);
            setLastTickTime(now);
            setTickCount(prev => prev + 1);
          }
          break;
        }

        case 'multi_tick': {
          const results = message.data?.results || [];
          results.forEach((result: any) => {
            if (result.state?.currentPrice) {
              const symbol = result.symbol;
              const price = result.state.currentPrice;
              
              const tick: PriceTick = {
                symbol,
                price,
                change24h: result.state.priceChange24h || 0,
                changePercent24h: result.state.priceChangePercent24h || 0,
                high24h: result.state.high24h || 0,
                low24h: result.state.low24h || 0,
                volume24h: result.state.volume24h || 0,
                timestamp: now,
              };

              setPrices(prev => new Map(prev).set(symbol, tick));
              updatePositionsWithPrice(symbol, price, now);
            }
          });
          setLastTickTime(now);
          setTickCount(prev => prev + 1);
          break;
        }

        case 'position':
        case 'positions': {
          const positionData = Array.isArray(message.data) ? message.data : [message.data];
          const newPositions: PositionWithLiveData[] = positionData.map((pos: any) => ({
            id: pos.id || pos.positionId,
            symbol: pos.symbol,
            exchange: pos.exchange || 'unknown',
            side: pos.side,
            entryPrice: parseFloat(pos.entryPrice),
            currentPrice: parseFloat(pos.currentPrice || pos.entryPrice),
            previousPrice: parseFloat(pos.currentPrice || pos.entryPrice),
            priceDirection: 'neutral' as const,
            quantity: parseFloat(pos.quantity),
            unrealizedPnl: parseFloat(pos.unrealizedPnl || '0'),
            unrealizedPnlPercent: parseFloat(pos.unrealizedPnlPercent || '0'),
            stopLoss: parseFloat(pos.stopLoss || '0'),
            takeProfit: parseFloat(pos.takeProfit || '0'),
            trailingStop: pos.trailingStop ? parseFloat(pos.trailingStop) : undefined,
            entryTime: pos.entryTime || pos.openedAt || new Date().toISOString(),
            strategy: pos.strategy,
            status: pos.status || 'open',
            lastTickTime: now,
          }));
          
          setPositions(newPositions);
          positionsRef.current = newPositions;
          break;
        }

        case 'position_prices': {
          // Update positions with live price data
          const priceUpdates = message.data || [];
          setPositions(prev => {
            const updated = prev.map(pos => {
              const update = priceUpdates.find((u: any) => u.positionId === pos.id);
              if (update) {
                const priceDirection: 'up' | 'down' | 'neutral' = update.currentPrice > pos.currentPrice ? 'up' : 
                                       update.currentPrice < pos.currentPrice ? 'down' : 'neutral';
                return {
                  ...pos,
                  previousPrice: pos.currentPrice,
                  currentPrice: update.currentPrice,
                  priceDirection,
                  unrealizedPnl: update.unrealizedPnl,
                  unrealizedPnlPercent: update.unrealizedPnlPercent,
                  lastTickTime: now,
                };
              }
              return pos;
            });
            positionsRef.current = updated;
            return updated;
          });
          setLastTickTime(now);
          break;
        }
      }
    } catch (error) {
      console.error('[RealTimePriceContext] Failed to parse message:', error);
    }
  }, [updatePositionsWithPrice]);

  // Update portfolio metrics when positions change
  useEffect(() => {
    const metrics = calculatePortfolioMetrics(positions);
    setPortfolioMetrics(metrics);
  }, [positions, calculatePortfolioMetrics]);

  // WebSocket connection management
  useEffect(() => {
    const connect = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const url = `${protocol}//${host}/ws/seer-multi`;

        const ws = new WebSocket(url);

        ws.onopen = () => {
          console.log('[RealTimePriceContext] Connected');
          setIsConnected(true);
          
          // Authenticate if userId provided
          if (userId) {
            ws.send(JSON.stringify({ type: 'auth', userId }));
          }
          
          // Subscribe to all tracked symbols
          subscribedSymbols.current.forEach(symbol => {
            ws.send(JSON.stringify({ type: 'subscribe', symbol }));
          });
        };

        ws.onmessage = handleMessage;

        ws.onerror = () => {
          console.warn('[RealTimePriceContext] Connection error');
        };

        ws.onclose = () => {
          setIsConnected(false);
          wsRef.current = null;
          
          // Reconnect after delay
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 3000);
        };

        wsRef.current = ws;
      } catch (error) {
        console.error('[RealTimePriceContext] Failed to connect:', error);
      }
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [userId, handleMessage]);

  const getPrice = useCallback((symbol: string): PriceTick | undefined => {
    return prices.get(symbol) || prices.get(symbol.replace('-', '')) || prices.get(symbol.replace('/', ''));
  }, [prices]);

  const subscribeToSymbol = useCallback((symbol: string) => {
    subscribedSymbols.current.add(symbol);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', symbol }));
    }
  }, []);

  const unsubscribeFromSymbol = useCallback((symbol: string) => {
    subscribedSymbols.current.delete(symbol);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', symbol }));
    }
  }, []);

  return (
    <RealTimePriceContext.Provider
      value={{
        prices,
        positions,
        portfolioMetrics,
        isConnected,
        lastTickTime,
        tickCount,
        getPrice,
        subscribeToSymbol,
        unsubscribeFromSymbol,
      }}
    >
      {children}
    </RealTimePriceContext.Provider>
  );
}
