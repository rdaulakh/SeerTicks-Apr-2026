/**
 * PersistentStatusBar — Always-visible thin bar at the bottom of all authenticated pages.
 * Shows: Engine uptime | Current regime | Last trade time | WebSocket connection state
 * 
 * Data sources:
 * - seerMulti.getStatus → engine running state, startedAt (uptime)
 * - pipeline.getRegimeDashboard → current regime, confidence
 * - automatedTrading.getTradeHistory → last trade timestamp
 * - useSocketIOMulti → WebSocket connection state
 */
import { useEffect, useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useSocketIOMulti } from "@/hooks/useSocketIOMulti";
import {
  Activity, Wifi, WifiOff, Clock, TrendingUp, TrendingDown,
  Minus, Zap, AlertTriangle, Radio
} from "lucide-react";
import { cn } from "@/lib/utils";

// Regime display config
const REGIME_CONFIG: Record<string, { label: string; color: string; icon: typeof TrendingUp }> = {
  trending_up: { label: "Trending Up", color: "text-green-400", icon: TrendingUp },
  trending_down: { label: "Trending Down", color: "text-red-400", icon: TrendingDown },
  high_volatility: { label: "High Volatility", color: "text-orange-400", icon: Zap },
  mean_reverting: { label: "Mean Reverting", color: "text-blue-400", icon: Activity },
  range_bound: { label: "Range Bound", color: "text-yellow-400", icon: Minus },
  breakout: { label: "Breakout", color: "text-purple-400", icon: Radio },
  normal: { label: "Normal", color: "text-gray-400", icon: Activity },
};

function formatUptime(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - start);
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatLastTradeTime(timestamp: string | Date): string {
  const tradeTime = new Date(timestamp).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - tradeTime);
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 24) return `${Math.floor(hours / 24)}d ago`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds > 0) return `${seconds}s ago`;
  return "just now";
}

export function PersistentStatusBar() {
  const { user } = useAuth();
  const { connected } = useSocketIOMulti(user?.id, true);
  const [uptimeStr, setUptimeStr] = useState<string>("--");
  const [lastTradeStr, setLastTradeStr] = useState<string>("--");

  // Fetch engine status (lightweight, refetch every 30s)
  const { data: engineStatus } = trpc.seerMulti.getStatus.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 30000,
    retry: 1,
  });

  // Fetch regime data (refetch every 15s)
  const { data: regimeData } = trpc.pipeline.getRegimeDashboard.useQuery(
    { symbol: "BTC-USD" },
    {
      enabled: !!user,
      refetchInterval: 15000,
      retry: 1,
    }
  );

  // Fetch last trade (lightweight, refetch every 30s)
  const { data: tradeHistory } = trpc.automatedTrading.getTradeHistory.useQuery(
    { limit: 1 },
    {
      enabled: !!user,
      refetchInterval: 30000,
      retry: 1,
    }
  );

  // Update uptime every second
  useEffect(() => {
    if (!engineStatus?.startedAt) return;
    const update = () => setUptimeStr(formatUptime(engineStatus.startedAt!));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [engineStatus?.startedAt]);

  // Update last trade time every 10s
  useEffect(() => {
    const lastTrade = tradeHistory?.[0];
    if (!lastTrade?.createdAt) {
      setLastTradeStr("No trades yet");
      return;
    }
    const update = () => setLastTradeStr(formatLastTradeTime(lastTrade.createdAt));
    update();
    const interval = setInterval(update, 10000);
    return () => clearInterval(interval);
  }, [tradeHistory]);

  // Regime display
  const regime = regimeData?.regime || "normal";
  const regimeConf = REGIME_CONFIG[regime] || REGIME_CONFIG.normal;
  const RegimeIcon = regimeConf.icon;
  const confidence = regimeData?.regimeConfidence
    ? `${Math.round(regimeData.regimeConfidence * 100)}%`
    : "--";

  // Engine state
  const isRunning = engineStatus?.isRunning ?? false;
  const tradingMode = engineStatus?.autoTradingEnabled ? "AUTO" : "MANUAL";

  // Memoize to prevent unnecessary re-renders
  const connectionStatus = useMemo(() => {
    if (!user) return { label: "Not authenticated", color: "text-gray-500", dot: "bg-gray-500" };
    if (connected) return { label: "Connected", color: "text-emerald-400", dot: "bg-emerald-400" };
    return { label: "Reconnecting...", color: "text-yellow-400", dot: "bg-yellow-400" };
  }, [user, connected]);

  if (!user) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 h-7 bg-[#08080d]/95 backdrop-blur-md border-t border-gray-800/40 select-none">
      <div className="h-full flex items-center justify-between px-3 text-[10px] font-mono tracking-wide">
        {/* Left section: Engine + Connection */}
        <div className="flex items-center gap-4">
          {/* Connection dot */}
          <div className="flex items-center gap-1.5">
            <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", connectionStatus.dot)} />
            <span className={cn(connectionStatus.color)}>{connectionStatus.label}</span>
          </div>

          {/* Divider */}
          <div className="w-px h-3 bg-gray-700/50" />

          {/* Engine status */}
          <div className="flex items-center gap-1.5">
            {isRunning ? (
              <Activity className="w-3 h-3 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-3 h-3 text-red-400" />
            )}
            <span className={isRunning ? "text-emerald-400" : "text-red-400"}>
              {isRunning ? "Engine Running" : "Engine Stopped"}
            </span>
          </div>

          {/* Divider */}
          <div className="w-px h-3 bg-gray-700/50" />

          {/* Trading mode */}
          <span className={cn(
            "px-1.5 py-0.5 rounded text-[9px] font-bold",
            tradingMode === "AUTO"
              ? "bg-green-500/15 text-green-400"
              : "bg-orange-500/15 text-orange-400"
          )}>
            {tradingMode}
          </span>
        </div>

        {/* Center section: Uptime */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-gray-500" />
            <span className="text-gray-400">Uptime:</span>
            <span className="text-cyan-400 font-semibold">{uptimeStr}</span>
          </div>
        </div>

        {/* Right section: Regime + Last Trade */}
        <div className="flex items-center gap-4">
          {/* Current regime */}
          <div className="flex items-center gap-1.5">
            <RegimeIcon className={cn("w-3 h-3", regimeConf.color)} />
            <span className="text-gray-400">Regime:</span>
            <span className={cn("font-semibold", regimeConf.color)}>{regimeConf.label}</span>
            <span className="text-gray-600">({confidence})</span>
          </div>

          {/* Divider */}
          <div className="w-px h-3 bg-gray-700/50" />

          {/* Last trade */}
          <div className="flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-gray-500" />
            <span className="text-gray-400">Last Trade:</span>
            <span className="text-gray-300">{lastTradeStr}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
