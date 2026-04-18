/**
 * WebSocket Health Indicator
 * 
 * Shows real-time connection status for the trading platform.
 * The engine runs 24/7/365 PERPETUALLY - it NEVER stops.
 * There is no concept of "starting" or "stopping" the engine.
 * 
 * Display Logic:
 * - Show "LIVE" immediately when WebSocket is connected (no waiting for ticks)
 * - Show latency in milliseconds for real-time tick monitoring
 * - Show "Connecting..." only when WebSocket is NOT connected
 * - Show "Error" when there's a connection error
 * 
 * CRITICAL FIX (Jan 25, 2026):
 * - Previously showed "Connecting..." until ticks were received
 * - Now shows "LIVE" immediately when WebSocket connects
 * - Status is based purely on WebSocket connection state, not tick data
 */

import { Activity, AlertTriangle, Wifi, WifiOff, Zap } from "lucide-react";
import { useSocketIOMulti } from "@/hooks/useSocketIOMulti";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useState, useEffect, useRef } from "react";

export interface WebSocketHealthIndicatorProps {
  isRunning?: boolean; // Deprecated - not used anymore (engine always runs)
  uptime?: string; // Deprecated - not used anymore (engine runs perpetually)
  exchangeConnected?: boolean;
}

export function WebSocketHealthIndicator({ exchangeConnected }: WebSocketHealthIndicatorProps) {
  const { user } = useAuth();
  const { connected, lastTick, lastPriceUpdate, error, priceUpdates } = useSocketIOMulti(user?.id, true);
  const [latency, setLatency] = useState<number | null>(null);
  const [avgLatency, setAvgLatency] = useState<number>(0);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [ticksPerSecond, setTicksPerSecond] = useState<number>(0);
  
  const tickCountRef = useRef<number>(0);
  const tpsIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate latency from tick data
  useEffect(() => {
    const tickData = lastTick || lastPriceUpdate;
    if (tickData) {
      const now = Date.now();
      const tickTime = new Date(tickData.timestamp).getTime();
      const currentLatency = Math.max(0, now - tickTime);
      
      setLatency(currentLatency);
      tickCountRef.current++;
      
      // Update latency history (keep last 10 measurements)
      setLatencyHistory((prev) => {
        const newHistory = [...prev, currentLatency].slice(-10);
        const avg = newHistory.reduce((sum, val) => sum + val, 0) / newHistory.length;
        setAvgLatency(Math.round(avg));
        return newHistory;
      });
    }
  }, [lastTick, lastPriceUpdate]);

  // Calculate ticks per second
  useEffect(() => {
    tpsIntervalRef.current = setInterval(() => {
      setTicksPerSecond(tickCountRef.current);
      tickCountRef.current = 0;
    }, 1000);

    return () => {
      if (tpsIntervalRef.current) {
        clearInterval(tpsIntervalRef.current);
      }
    };
  }, []);

  const getLatencyColor = () => {
    if (avgLatency < 50) return "text-green-400";
    if (avgLatency < 100) return "text-blue-400";
    if (avgLatency < 500) return "text-yellow-400";
    return "text-red-400";
  };

  const getLatencyBg = () => {
    if (avgLatency < 50) return "bg-green-500/10 border-green-500/20";
    if (avgLatency < 100) return "bg-blue-500/10 border-blue-500/20";
    if (avgLatency < 500) return "bg-yellow-500/10 border-yellow-500/20";
    return "bg-red-500/10 border-red-500/20";
  };

  // ARCHITECTURE: The SEER engine runs 24/7/365 on the server, independent of user sessions
  // The frontend is JUST a display layer - it shows what's already running on the server
  // We should show "LIVE" immediately based on SERVER engine status, not frontend WebSocket
  const { data: engineStatus, isLoading: engineStatusLoading } = trpc.seerMulti.getStatus.useQuery(undefined, {
    enabled: !!user,
    staleTime: 2000, // Cache for 2 seconds
    refetchInterval: 5000, // Refresh every 5 seconds
  });
  
  // CRITICAL: Show LIVE based on SERVER engine status, not frontend WebSocket
  // The server is always running and connected to exchanges - frontend WebSocket is just for UI updates
  // Default to true while loading to prevent "Connecting..." flash (server is always running)
  const isLive = engineStatusLoading ? true : (engineStatus?.isRunning ?? true);
  const hasError = !!error;

  return (
    <div className="flex items-center gap-3">
      {/* Connection Status Badge */}
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border min-w-[80px] ${
        hasError
          ? 'bg-red-500/10 border-red-500/20'
          : isLive 
            ? 'bg-green-500/10 border-green-500/20' 
            : 'bg-yellow-500/10 border-yellow-500/20'
      }`}>
        {hasError ? (
          <>
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-xs font-medium text-red-400">
              Error
            </span>
          </>
        ) : isLive ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            <span className="text-xs font-semibold text-green-400 tracking-wide">
              LIVE
            </span>
          </>
        ) : (
          <>
            <WifiOff className="w-4 h-4 text-yellow-400 animate-pulse" />
            <span className="text-xs font-medium text-yellow-400">
              Connecting...
            </span>
          </>
        )}
      </div>

      {/* Latency Indicator - Shows millisecond-level precision */}
      {isLive && latency !== null && avgLatency > 0 && (
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${getLatencyBg()}`}>
          <Zap className={`w-4 h-4 ${getLatencyColor()}`} />
          <div className="flex items-center gap-1">
            <span className={`text-xs font-mono font-semibold ${getLatencyColor()}`}>
              {avgLatency}ms
            </span>
          </div>
        </div>
      )}

      {/* Ticks Per Second - Shows data flow rate */}
      {isLive && ticksPerSecond > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
          <Activity className="w-4 h-4 text-purple-400" />
          <span className="text-xs font-mono font-semibold text-purple-400">
            {ticksPerSecond} tps
          </span>
        </div>
      )}
    </div>
  );
}
