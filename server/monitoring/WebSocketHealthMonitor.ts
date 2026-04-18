/**
 * WebSocketHealthMonitor - P0 CRITICAL
 * 
 * Monitors WebSocket connection health and message flow.
 * Alert if: minutes_since_last_message > 5, reconnection_attempts > 5
 * 
 * Usage:
 *   wsHealthMonitor.registerWebSocket("CoinbaseWS");
 *   wsHealthMonitor.recordMessage("CoinbaseWS");
 *   wsHealthMonitor.recordReconnect("CoinbaseWS");
 */

import { getDb } from "../db";
import { websocketHealthLog } from "../../drizzle/schema";

interface WebSocketState {
  name: string;
  connectionStatus: string;
  lastMessageTime: Date | null;
  messagesThisMinute: number;
  totalMessages: number;
  messagesMissed: number;
  reconnectionAttempts: number;
  lastReconnectTime: Date | null;
  registeredAt: Date;
}

class WebSocketHealthMonitorService {
  private static instance: WebSocketHealthMonitorService | null = null;
  private webSockets: Map<string, WebSocketState> = new Map();
  private recordInterval: NodeJS.Timeout | null = null;
  private readonly RECORD_INTERVAL_MS = 60_000; // Record every minute

  private constructor() {}

  static getInstance(): WebSocketHealthMonitorService {
    if (!WebSocketHealthMonitorService.instance) {
      WebSocketHealthMonitorService.instance = new WebSocketHealthMonitorService();
    }
    return WebSocketHealthMonitorService.instance;
  }

  /**
   * Start periodic health recording.
   */
  start(): void {
    if (this.recordInterval) return;

    console.log("[WebSocketHealthMonitor] Started monitoring WebSocket connections");
    
    this.recordInterval = setInterval(() => {
      this.recordAllHealth().catch((err) => {
        console.error("[WebSocketHealthMonitor] Record failed:", err.message);
      });
    }, this.RECORD_INTERVAL_MS);

    if (this.recordInterval.unref) {
      this.recordInterval.unref();
    }
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (this.recordInterval) {
      clearInterval(this.recordInterval);
      this.recordInterval = null;
    }
    console.log("[WebSocketHealthMonitor] Stopped monitoring");
  }

  /**
   * Register a WebSocket connection for monitoring.
   */
  registerWebSocket(name: string): void {
    if (!this.webSockets.has(name)) {
      this.webSockets.set(name, {
        name,
        connectionStatus: "disconnected",
        lastMessageTime: null,
        messagesThisMinute: 0,
        totalMessages: 0,
        messagesMissed: 0,
        reconnectionAttempts: 0,
        lastReconnectTime: null,
        registeredAt: new Date(),
      });
    }
  }

  /**
   * Record that a message was received from a WebSocket.
   */
  recordMessage(name: string): void {
    const ws = this.webSockets.get(name);
    if (ws) {
      ws.lastMessageTime = new Date();
      ws.messagesThisMinute++;
      ws.totalMessages++;
      ws.connectionStatus = "connected";
    }
  }

  /**
   * Record a connection status change.
   */
  updateStatus(name: string, status: string): void {
    const ws = this.webSockets.get(name);
    if (ws) {
      ws.connectionStatus = status;
    }
  }

  /**
   * Record a reconnection attempt.
   */
  recordReconnect(name: string): void {
    const ws = this.webSockets.get(name);
    if (ws) {
      ws.reconnectionAttempts++;
      ws.lastReconnectTime = new Date();
      ws.connectionStatus = "reconnecting";
    }
  }

  /**
   * Record missed messages (detected by sequence gaps).
   */
  recordMissedMessages(name: string, count: number): void {
    const ws = this.webSockets.get(name);
    if (ws) {
      ws.messagesMissed += count;
    }
  }

  /**
   * Get current status for all WebSockets (for health dashboard).
   */
  getStatus(): Record<string, {
    connectionStatus: string;
    lastMessageTime: Date | null;
    messagesThisMinute: number;
    totalMessages: number;
    reconnectionAttempts: number;
    minutesSinceLastMessage: number | null;
  }> {
    const result: Record<string, any> = {};
    const now = Date.now();
    
    for (const [name, ws] of this.webSockets) {
      result[name] = {
        connectionStatus: ws.connectionStatus,
        lastMessageTime: ws.lastMessageTime,
        messagesThisMinute: ws.messagesThisMinute,
        totalMessages: ws.totalMessages,
        reconnectionAttempts: ws.reconnectionAttempts,
        minutesSinceLastMessage: ws.lastMessageTime
          ? Math.round((now - ws.lastMessageTime.getTime()) / 60_000)
          : null,
      };
    }
    return result;
  }

  /**
   * Internal: Record health for all registered WebSockets.
   */
  private async recordAllHealth(): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const entries: any[] = [];
    const now = new Date();

    for (const [, ws] of this.webSockets) {
      // Detect stale connections
      let status = ws.connectionStatus;
      if (ws.lastMessageTime) {
        const minutesSinceLastMsg = (now.getTime() - ws.lastMessageTime.getTime()) / 60_000;
        if (minutesSinceLastMsg > 5 && status === "connected") {
          status = "disconnected"; // Likely stale
          ws.connectionStatus = "disconnected";
        }
      }

      entries.push({
        timestamp: now,
        websocketName: ws.name,
        connectionStatus: status,
        lastMessageTime: ws.lastMessageTime,
        messagesReceivedLastMinute: ws.messagesThisMinute,
        messagesMissed: ws.messagesMissed,
        pingMs: null, // Would need actual ping measurement
        avgMessageDelayMs: null,
        reconnectionAttempts: ws.reconnectionAttempts,
        lastReconnectTime: ws.lastReconnectTime,
      });

      // Reset per-minute counter
      ws.messagesThisMinute = 0;
    }

    if (entries.length === 0) return;

    try {
      await db.insert(websocketHealthLog).values(entries);
    } catch (err: any) {
      console.error("[WebSocketHealthMonitor] DB write failed:", err.message);
    }
  }
}

export const wsHealthMonitor = WebSocketHealthMonitorService.getInstance();
export { WebSocketHealthMonitorService };
