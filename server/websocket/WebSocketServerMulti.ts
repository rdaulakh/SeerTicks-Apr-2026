/**
 * Multi-Exchange WebSocket Server — Phase 14D
 * 
 * Enhanced WebSocket server for broadcasting multi-exchange, multi-symbol data.
 * Phase 14D: Uses EngineAdapter instead of legacy SEERMultiEngine.
 */

import { Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { getEngineAdapter, getExistingAdapter } from '../services/EngineAdapter';
import { priceFeedService, PriceData } from '../services/priceFeedService';
import { AgentSignal } from '../agents/AgentBase';
import { TradeRecommendation } from '../orchestrator/StrategyOrchestrator';
import { ExecutionDecision } from '../orchestrator/TieredDecisionMaking';
import { wsLogger } from '../utils/logger';

export interface MultiWebSocketMessage {
  type: 'multi_tick' | 'symbol_tick' | 'position' | 'health' | 'error' | 'status' | 'rebalance' | 'trading_stats' | 'activity' | 'latency' | 'market_data' | 'agent_signals' | 'consensus' | 'position_prices' | 'price_tick';
  timestamp: number;
  data: any;
}

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

export class SEERMultiWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, number> = new Map(); // Map of WebSocket to userId
  private engineListenersSetupForUsers: Set<number> = new Set();
  private userListenerRefs: Map<number, Array<{ event: string; fn: (...args: any[]) => void }>> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;
  private priceFeedListenerSetup: boolean = false;
  private priceFeedHandler: ((data: PriceData) => void) | null = null;

  /**
   * Initialize WebSocket server in noServer mode
   */
  initializeNoServer(): void {
    wsLogger.info('Initializing WebSocket server');
    this.wss = new WebSocketServer({ noServer: true });
    wsLogger.info('WebSocketServer created successfully');

    this.wss.on('connection', (ws: WebSocket) => {
      wsLogger.info('Client connected');
      
      (ws as any).isAlive = true;
      ws.on('pong', () => {
        (ws as any).isAlive = true;
      });

      ws.on('message', (message: string) => {
        wsLogger.debug('Raw message received', { message: message.toString() });
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(ws, data);
        } catch (error) {
          wsLogger.error('Failed to parse message', { error: (error as Error)?.message });
        }
      });

      ws.on('close', () => {
        const userId = this.clients.get(ws);
        wsLogger.info('Client disconnected', { userId });
        this.clients.delete(ws);
        if (userId != null) {
          this.cleanupUserListenersIfOrphaned(userId);
        }
      });

      ws.on('error', (error: any) => {
        if (error.code !== 'ECONNRESET' && error.code !== 'EPIPE') {
          wsLogger.error('Client error', { error: error.message || String(error) });
        }
        this.clients.delete(ws);
      });
    });

    this.pingInterval = setInterval(() => {
      if (!this.wss) return;
      
      this.wss.clients.forEach((ws: WebSocket) => {
        if ((ws as any).isAlive === false) {
          wsLogger.debug('Terminating dead connection');
          return ws.terminate();
        }
        
        (ws as any).isAlive = false;
        ws.ping();
      });
    }, 30000);

    wsLogger.info('Server initialized on /ws/seer-multi');
  }

  /**
   * Handle WebSocket upgrade request
   */
  handleUpgrade(request: any, socket: any, head: any): void {
    if (!this.wss) {
      socket.destroy();
      return;
    }
    
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss!.emit('connection', ws, request);
    });
  }

  /**
   * Setup global price feed listener (only once for all users)
   */
  private setupPriceFeedListener(): void {
    if (this.priceFeedListenerSetup) return;
    this.priceFeedListenerSetup = true;
    
    this.priceFeedHandler = (priceData: PriceData) => {
      this.broadcast({
        type: 'price_tick',
        timestamp: Date.now(),
        data: {
          symbol: priceData.symbol,
          price: priceData.price,
          timestamp: priceData.timestamp,
          source: priceData.source,
          volume24h: priceData.volume24h,
          change24h: priceData.change24h,
        },
      });
    };
    priceFeedService.on('price_update', this.priceFeedHandler);
    wsLogger.info('Global price feed listener setup complete');
  }

  /**
   * Setup listeners for EngineAdapter events (per-user)
   * Phase 14D: Uses EngineAdapter instead of legacy SEERMultiEngine.
   */
  private async setupEngineListeners(userId: number): Promise<void> {
    if (this.engineListenersSetupForUsers.has(userId)) {
      return;
    }

    this.setupPriceFeedListener();

    try {
      const adapter = await getEngineAdapter(userId);
      this.engineListenersSetupForUsers.add(userId);

      const refs: Array<{ event: string; fn: (...args: any[]) => void }> = [];

      const listen = (event: string, fn: (...args: any[]) => void) => {
        adapter.on(event, fn);
        refs.push({ event, fn });
      };

      listen('trade_executed', (data: any) => {
        this.broadcast({
          type: 'position',
          timestamp: Date.now(),
          data: { action: 'opened', exchangeId: data.exchangeId, exchangeName: data.exchangeName, symbol: data.symbol, side: data.side, quantity: data.quantity, price: data.price },
        });
      });

      listen('exit_executed', (data: any) => {
        this.broadcast({
          type: 'position',
          timestamp: Date.now(),
          data: { action: 'closed', exchangeId: data.exchangeId, symbol: data.symbol, positionId: data.positionId, reason: data.reason },
        });
      });

      listen('signal_approved', (data: any) => {
        this.broadcast({ type: 'agent_signals', timestamp: Date.now(), data });
      });

      listen('signal_rejected', (data: any) => {
        this.broadcast({ type: 'agent_signals', timestamp: Date.now(), data: { ...data, rejected: true } });
      });

      this.userListenerRefs.set(userId, refs);
      wsLogger.info('Engine adapter listeners registered', { userId, eventCount: refs.length });
    } catch (error) {
      wsLogger.error('Failed to setup engine adapter listeners', { error: (error as Error)?.message });
    }
  }

  /**
   * Remove engine listeners for a user if no more clients are connected for them.
   */
  private async cleanupUserListenersIfOrphaned(userId: number): Promise<void> {
    for (const [, uid] of this.clients) {
      if (uid === userId) return;
    }

    const refs = this.userListenerRefs.get(userId);
    if (refs) {
      try {
        const adapter = getExistingAdapter(userId);
        if (adapter) {
          for (const { event, fn } of refs) {
            adapter.off(event, fn);
          }
        }
        wsLogger.info('Cleaned up engine adapter listeners', { userId, count: refs.length });
      } catch {
        // Adapter may not exist anymore — that's fine
      }
      this.userListenerRefs.delete(userId);
    }
    this.engineListenersSetupForUsers.delete(userId);
  }

  /**
   * Handle client messages
   */
  private async handleClientMessage(ws: WebSocket, data: any): Promise<void> {
    wsLogger.debug('Received message', { type: data.type });
    switch (data.type) {
      case 'auth':
        const userId = data.userId;
        wsLogger.info('Auth message received', { userId });
        if (userId) {
          this.clients.set(ws, userId);
          wsLogger.info('Setting up engine adapter listeners', { userId });
          await this.setupEngineListeners(userId);
          const fullStatus = await this.getFullStatus(userId);
          this.sendToClient(ws, {
            type: 'status',
            timestamp: Date.now(),
            data: fullStatus,
          });
          wsLogger.info('Auth complete, sent initial status');
        } else {
          wsLogger.warn('Auth message missing userId');
        }
        break;

      case 'request_status':
        const userIdForStatus = this.clients.get(ws);
        if (userIdForStatus) {
          const fullStatus = await this.getFullStatus(userIdForStatus);
          this.sendToClient(ws, {
            type: 'status',
            timestamp: Date.now(),
            data: fullStatus,
          });
        }
        break;

      case 'request_symbol_tick':
        const userIdForSymbol = this.clients.get(ws);
        if (!userIdForSymbol) break;
        
        const { exchange, symbol } = data;
        (async () => { try {
          const adapter = await getEngineAdapter(userIdForSymbol);
          const states = adapter.getSymbolStates();
          const state = Object.values(states).find(
            (s: any) => s.symbol === symbol
          );
          this.sendToClient(ws, {
            type: 'symbol_tick',
            timestamp: Date.now(),
            data: state || null,
          });
        } catch (error) {
          wsLogger.error('Error getting symbol tick', { error: (error as Error)?.message });
        } })();
        break;

      case 'request_positions':
        const userIdForPositions = this.clients.get(ws);
        if (userIdForPositions) {
          (async () => { try {
            const adapter = await getEngineAdapter(userIdForPositions);
            const positions = await adapter.getAllPositions();
            this.sendToClient(ws, {
              type: 'position',
              timestamp: Date.now(),
              data: {
                positions,
              },
            });
          } catch (error) {
            wsLogger.error('Error getting positions', { error: (error as Error)?.message });
          } })();
        }
        break;

      default:
        wsLogger.warn('Unknown message type', { type: data.type });
    }
  }

  /**
   * Get full status with all symbol states
   */
  private async getFullStatus(userId: number) {
    try {
      const adapter = await getEngineAdapter(userId);
      const positions = await adapter.getAllPositions();
      return {
        engine: adapter.getStatus(),
        symbols: Object.values(adapter.getSymbolStates()),
        positions,
      };
    } catch (error) {
      wsLogger.error('Error getting full status', { error: (error as Error)?.message });
      return {
        engine: { running: false, exchanges: 0, tradingPairs: 0, pairs: [] },
        symbols: [],
        positions: [],
      };
    }
  }

  /**
   * Format symbol tick data
   */
  private formatSymbolTick(result: any): SymbolTickData {
    const signals = result.agentsWithSignals || result.signals || [];
    
    return {
      exchangeId: result.exchangeId,
      exchangeName: result.exchangeName,
      symbol: result.symbol,
      signals: (signals && Array.isArray(signals)) ? signals.map((s: AgentSignal) => ({
        agentName: s.agentName,
        signal: s.signal,
        confidence: s.confidence,
        strength: s.strength,
        reasoning: s.reasoning,
      })) : [],
      recommendation: result.recommendation ? {
        action: result.recommendation.action,
        confidence: result.recommendation.confidence,
        reasoning: result.recommendation.reasoning,
        positionSize: result.recommendation.positionSize,
        stopLoss: result.recommendation.stopLoss,
        takeProfit: result.recommendation.takeProfit,
      } : null,
      decision: result.decision ? {
        shouldTrade: result.decision.shouldTrade,
        side: result.decision.side,
        positionSize: result.decision.positionSize,
        stopLoss: result.decision.stopLoss,
        takeProfit: result.decision.takeProfit,
        confidence: result.decision.confidence,
        reasoning: result.decision.reasoning,
      } : null,
      state: result.state || {
        currentPrice: result.currentPrice,
        priceChange24h: result.priceChange24h,
        running: result.running,
        lastUpdate: result.lastUpdate,
      },
      currentPrice: result.currentPrice,
      priceChange24h: result.priceChange24h,
    };
  }

  /**
   * Broadcast message to all clients
   */
  private broadcast(message: MultiWebSocketMessage): void {
    try {
      const payload = JSON.stringify(message);
      
      const maxSize = 1024 * 1024; // 1MB limit
      let messageToSend = message;
      
      if (payload.length > maxSize) {
        wsLogger.warn('Message too large, truncating', { bytes: payload.length });
        if (message.type === 'status' && message.data) {
          messageToSend = {
            ...message,
            data: {
              ...message.data,
              symbols: message.data.symbols ? message.data.symbols.slice(0, 10) : [],
              positions: message.data.positions ? message.data.positions.slice(0, 20) : [],
              _truncated: true,
            },
          };
        }
      }
      
      const finalPayload = JSON.stringify(messageToSend);
      
      this.clients.forEach((userId, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(finalPayload);
        }
      });
      
      // Also broadcast via Socket.IO for production compatibility
      try {
        priceFeedService.broadcastMultiEvent(message.type, message.data);
      } catch (socketIOError) {
        wsLogger.warn('Socket.IO broadcast failed', { error: (socketIOError as Error)?.message });
      }
    } catch (error) {
      wsLogger.error('Error broadcasting message', { error: (error as Error)?.message });
    }
  }

  /**
   * Send message to specific client
   */
  private sendToClient(client: WebSocket, message: MultiWebSocketMessage): void {
    try {
      if (client.readyState === WebSocket.OPEN) {
        const payload = JSON.stringify(message);
        
        const maxSize = 1024 * 1024;
        if (payload.length > maxSize) {
          wsLogger.warn('Message too large for client, truncating', { bytes: payload.length });
          if (message.type === 'status' && message.data) {
            const truncatedMessage = {
              ...message,
              data: {
                ...message.data,
                symbols: message.data.symbols ? message.data.symbols.slice(0, 10) : [],
                positions: message.data.positions ? message.data.positions.slice(0, 20) : [],
                _truncated: true,
              },
            };
            client.send(JSON.stringify(truncatedMessage));
            return;
          }
        }
        
        client.send(payload);
      }
    } catch (error) {
      wsLogger.error('Error sending message to client', { error: (error as Error)?.message });
    }
  }

  /**
   * Phase 14C: Send message to a specific user's WebSocket clients.
   */
  sendToUser(userId: number, message: MultiWebSocketMessage): void {
    try {
      const payload = JSON.stringify(message);
      let sentCount = 0;

      this.clients.forEach((clientUserId, ws) => {
        if (clientUserId === userId && ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
          sentCount++;
        }
      });

      try {
        priceFeedService.broadcastMultiEvent(message.type, message.data);
      } catch { /* best-effort */ }
    } catch (error) {
      wsLogger.error('Error sending message to user', { userId, error: (error as Error)?.message });
    }
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Close all connections and clean up ALL listeners
   */
  close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Remove all engine adapter listeners for every user
    for (const userId of this.engineListenersSetupForUsers) {
      const refs = this.userListenerRefs.get(userId);
      if (refs) {
        const adapter = getExistingAdapter(userId);
        if (adapter) {
          for (const { event, fn } of refs) {
            adapter.off(event, fn);
          }
        }
      }
    }
    this.userListenerRefs.clear();
    this.engineListenersSetupForUsers.clear();

    // Remove price feed listener
    if (this.priceFeedHandler) {
      priceFeedService.off('price_update', this.priceFeedHandler);
      this.priceFeedHandler = null;
      this.priceFeedListenerSetup = false;
    }

    // Close all client connections
    this.clients.forEach((userId, ws) => {
      ws.close();
    });
    this.clients.clear();
    this.wss?.close();
    wsLogger.info('Server closed, all listeners cleaned up');
  }

  /**
   * Shutdown server (alias for close)
   */
  shutdown(): void {
    this.close();
  }
}

// Singleton instance
let wsMultiInstance: SEERMultiWebSocketServer | null = null;

export function getMultiWebSocketServer(): SEERMultiWebSocketServer {
  if (!wsMultiInstance) {
    wsMultiInstance = new SEERMultiWebSocketServer();
  }
  return wsMultiInstance;
}
