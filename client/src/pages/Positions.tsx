/**
 * SEER Position Manager — Institutional Grade (Phase 93.12)
 *
 * Real-time monitoring of OPEN positions only. Closed positions belong on
 * the Order History page (single source of truth for trade audit log).
 *
 * Design: Bloomberg/IBKR density. Monospace numerics, tight padding,
 * semantic theme tokens, no decorative blur halos, minimal chrome.
 */

import { useState, useEffect, useMemo, useCallback, memo } from "react";
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  RefreshCw,
  Bot,
  ArrowUpDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";
import { usePositions, Position } from "@/contexts/PositionContext";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { PositionConsensusCard } from "@/components/PositionConsensusCard";
import { useLivePriceStream } from "@/hooks/useLivePriceStream";
import { useWebSocketMulti } from "@/hooks/useWebSocketMulti";
import { trpc } from "@/lib/trpc";

// Sort options — trimmed to the four traders actually use
type SortOption = "pnl_desc" | "pnl_asc" | "holdTime_desc" | "value_desc";

interface LivePosition extends Position {
  livePrice: number;
  livePnl: number;
  livePnlPercent: number;
  priceDirection: "up" | "down" | "neutral";
  previousPrice: number;
  priceFlash?: "up" | "down";
  lastTickTime: number;
}

export default function Positions() {
  const [sortBy, setSortBy] = useState<SortOption>("pnl_desc");
  const [, setUpdateCounter] = useState(0);

  const { user } = useAuth();

  const {
    positions: contextPositions,
    isLoading,
    lastUpdateTime,
    refetch,
  } = usePositions();

  const {
    portfolioFunds: paperTradingBalance,
    portfolioValue: contextPortfolioValue,
    availableBalance: contextAvailableBalance,
    isPaperTrading,
    isLoading: portfolioLoading,
    isInitialized: portfolioInitialized,
  } = usePortfolio();

  // Normalize symbol to match price feed (BTCUSDT -> BTC-USD)
  const normalizeSymbol = useCallback((symbol: string): string => {
    if (symbol.endsWith("USDT")) return `${symbol.slice(0, -4)}-USD`;
    if (symbol.endsWith("USD") && !symbol.includes("-")) return `${symbol.slice(0, -3)}-USD`;
    return symbol;
  }, []);

  const positionSymbols = useMemo(
    () => [...new Set(contextPositions.map((p) => normalizeSymbol(p.symbol)))],
    [contextPositions, normalizeSymbol]
  );

  useWebSocketMulti(user?.id, true);

  // Server engine status drives the "Live" indicator — server is the source of truth
  const { data: engineStatus, isLoading: engineStatusLoading } = trpc.seerMulti.getStatus.useQuery(
    undefined,
    {
      enabled: !!user,
      staleTime: 2000,
      refetchInterval: 5000,
    }
  );

  const {
    prices: livePrices,
    connected: priceStreamConnected,
    priceFlashes,
    lastUpdate: priceLastUpdate,
  } = useLivePriceStream({
    symbols: positionSymbols,
    updateThrottleMs: 50,
    onPriceUpdate: useCallback(() => {
      setUpdateCounter((c) => c + 1);
    }, []),
  });

  const livePositions: LivePosition[] = useMemo(() => {
    return contextPositions.map((pos) => {
      const normalizedSymbol = normalizeSymbol(pos.symbol);
      const priceData = livePrices.get(normalizedSymbol);
      const flash = priceFlashes.get(normalizedSymbol);

      const livePrice = priceData?.price || pos.currentPrice || pos.entryPrice;
      const previousPrice = priceData?.previousPrice || pos.currentPrice || pos.entryPrice;

      const direction = pos.side === "long" ? 1 : -1;
      const priceDiff = (livePrice - pos.entryPrice) * direction;
      const livePnl = priceDiff * pos.quantity;
      const livePnlPercent = pos.entryPrice > 0 ? (priceDiff / pos.entryPrice) * 100 : 0;

      return {
        ...pos,
        livePrice,
        livePnl,
        livePnlPercent,
        priceDirection: priceData?.direction || "neutral",
        previousPrice,
        priceFlash: flash?.direction,
        lastTickTime: priceData?.timestamp || Date.now(),
      };
    });
  }, [contextPositions, livePrices, priceFlashes, normalizeSymbol]);

  // Portfolio rollup
  const portfolioMetrics = useMemo(() => {
    let positionValue = 0;
    let totalPnL = 0;
    let winningCount = 0;
    let losingCount = 0;
    let totalHoldTime = 0;

    livePositions.forEach((pos) => {
      positionValue += pos.livePrice * pos.quantity;
      totalPnL += pos.livePnl;
      if (pos.livePnl > 0) winningCount++;
      else if (pos.livePnl < 0) losingCount++;
      totalHoldTime += Date.now() - new Date(pos.entryTime).getTime();
    });

    // Phase 58: Portfolio Value comes from PortfolioContext so it matches Performance page.
    const totalValue = portfolioInitialized
      ? contextPortfolioValue
      : isPaperTrading
      ? paperTradingBalance + totalPnL
      : positionValue;

    const baseForPercent =
      paperTradingBalance > 0 ? paperTradingBalance : isPaperTrading ? 1 : positionValue;
    const totalPnLPercent = baseForPercent > 0 ? (totalPnL / baseForPercent) * 100 : 0;

    return {
      totalValue,
      positionValue,
      totalPnL,
      totalPnLPercent,
      winningCount,
      losingCount,
      avgHoldTime: livePositions.length > 0 ? totalHoldTime / livePositions.length : 0,
      paperBalance: paperTradingBalance,
      availableBalance: contextAvailableBalance,
      isPaperTrading,
    };
  }, [
    livePositions,
    paperTradingBalance,
    isPaperTrading,
    contextPortfolioValue,
    contextAvailableBalance,
    portfolioInitialized,
  ]);

  // Sort only — no filter clutter. Autonomous platform; users observe, they don't tune.
  const sortedPositions = useMemo(() => {
    const copy = [...livePositions];
    return copy.sort((a, b) => {
      switch (sortBy) {
        case "pnl_desc":
          return b.livePnl - a.livePnl;
        case "pnl_asc":
          return a.livePnl - b.livePnl;
        case "holdTime_desc":
          return new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime();
        case "value_desc":
          return b.livePrice * b.quantity - a.livePrice * a.quantity;
        default:
          return 0;
      }
    });
  }, [livePositions, sortBy]);

  const formatCurrency = useCallback((value: number, decimals?: number) => {
    const d = decimals ?? (Math.abs(value) < 1 ? 6 : Math.abs(value) < 100 ? 4 : 2);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: d,
    }).format(value);
  }, []);

  const formatHoldDuration = useCallback((timestamp: string) => {
    const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }, []);

  const formatTimeSinceUpdate = useCallback(() => {
    const lastUpdate = Math.max(lastUpdateTime, priceLastUpdate);
    const seconds = Math.floor((Date.now() - lastUpdate) / 1000);
    if (seconds < 1) return "Live";
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.floor(seconds / 60)}m ago`;
  }, [lastUpdateTime, priceLastUpdate]);

  const isConnected = engineStatusLoading ? true : engineStatus?.isRunning ?? true;
  const winRatePct =
    livePositions.length > 0
      ? (portfolioMetrics.winningCount / livePositions.length) * 100
      : 0;

  return (
    <div className="min-h-screen bg-background text-foreground p-3 sm:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-3 lg:space-y-4">
        {/* Header — tight, single connection indicator */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-foreground">Positions</h1>
            <div className="flex items-center gap-2 text-[11px]">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-medium border",
                  isConnected
                    ? "bg-green-500/10 text-green-400 border-green-500/20"
                    : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                )}
                title={
                  priceStreamConnected
                    ? "Real-time price stream active"
                    : "Server engine running; price stream syncing"
                }
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    isConnected
                      ? "bg-green-400 connection-pulse"
                      : "bg-yellow-400 animate-pulse"
                  )}
                />
                {isConnected ? "LIVE" : "CONNECTING"}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium">
                <Bot className="w-3 h-3" />
                AUTONOMOUS
              </span>
              <span className="text-slate-500 font-mono hidden sm:inline">
                {formatTimeSinceUpdate()}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Select value={sortBy} onValueChange={(v: SortOption) => setSortBy(v)}>
              <SelectTrigger className="h-8 w-[150px] text-xs border-slate-700 bg-slate-900/60 hover:bg-slate-800">
                <ArrowUpDown className="w-3 h-3 mr-1.5 text-slate-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                <SelectItem value="pnl_desc">P&L (High → Low)</SelectItem>
                <SelectItem value="pnl_asc">P&L (Low → High)</SelectItem>
                <SelectItem value="holdTime_desc">Oldest first</SelectItem>
                <SelectItem value="value_desc">Largest value</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              className="h-8 w-8 border-slate-700 bg-slate-900/60 hover:bg-slate-800"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Portfolio Strip — single row of dense KPI tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 lg:gap-3">
          <KpiTile
            label="Portfolio Value"
            value={formatCurrency(portfolioMetrics.totalValue)}
            subtext={`${livePositions.length} pos${
              portfolioMetrics.isPaperTrading ? " · paper" : " · live"
            }`}
            isLoading={portfolioLoading && !portfolioInitialized}
          />
          <KpiTile
            label="Unrealized P&L"
            value={`${portfolioMetrics.totalPnL >= 0 ? "+" : ""}${formatCurrency(
              portfolioMetrics.totalPnL
            )}`}
            subtext={`${
              portfolioMetrics.totalPnLPercent >= 0 ? "+" : ""
            }${portfolioMetrics.totalPnLPercent.toFixed(2)}%`}
            tone={portfolioMetrics.totalPnL >= 0 ? "pos" : "neg"}
            isLoading={isLoading && !portfolioInitialized}
          />
          <KpiTile
            label="Win / Loss"
            value={
              <span className="font-mono">
                <span className="text-green-400">{portfolioMetrics.winningCount}</span>
                <span className="text-slate-500 mx-1">/</span>
                <span className="text-red-400">{portfolioMetrics.losingCount}</span>
              </span>
            }
            subtext={
              livePositions.length > 0 ? `${winRatePct.toFixed(0)}% winning` : "No positions"
            }
          />
          <KpiTile
            label="Avg Hold"
            value={
              livePositions.length > 0
                ? formatHoldDuration(
                    new Date(Date.now() - portfolioMetrics.avgHoldTime).toISOString()
                  )
                : "—"
            }
            subtext="Per position"
          />
        </div>

        {/* Positions list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48 rounded-lg bg-slate-800/40" />
            ))}
          </div>
        ) : sortedPositions.length === 0 ? (
          <div className="rounded-lg bg-card border border-border p-10 lg:p-12">
            <div className="text-center space-y-3 max-w-md mx-auto">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
                <Activity className="w-5 h-5 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold text-foreground">No Open Positions</h3>
              <p className="text-sm text-muted-foreground">
                Agents are monitoring the market. New positions will appear here when
                consensus and risk gates pass.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedPositions.map((position, index) => (
              <LivePositionCard
                key={position.id}
                position={position}
                formatCurrency={formatCurrency}
                formatHoldDuration={formatHoldDuration}
                index={index}
                onPositionClosed={() => refetch()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// KPI tile — dense, no halo, single-row label/value/subtext
// =============================================================================
interface KpiTileProps {
  label: string;
  value: React.ReactNode;
  subtext?: string;
  tone?: "pos" | "neg" | "neutral";
  isLoading?: boolean;
}

const KpiTile = memo(function KpiTile({
  label,
  value,
  subtext,
  tone = "neutral",
  isLoading = false,
}: KpiTileProps) {
  const valueColor =
    tone === "pos" ? "text-green-500 dark:text-green-400" : tone === "neg" ? "text-red-500 dark:text-red-400" : "text-foreground";

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 lg:px-4 lg:py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </div>
      {isLoading ? (
        <>
          <Skeleton className="h-6 w-24 mt-1 bg-slate-700/40" />
          <Skeleton className="h-3 w-16 mt-1 bg-slate-700/30" />
        </>
      ) : (
        <>
          <div className={cn("text-lg lg:text-xl font-bold font-mono mt-0.5", valueColor)}>
            {value}
          </div>
          {subtext && (
            <div className="text-[10px] text-slate-500 mt-0.5 font-mono">{subtext}</div>
          )}
        </>
      )}
    </div>
  );
});

// =============================================================================
// Live Position Card
// =============================================================================
interface LivePositionCardProps {
  position: LivePosition;
  formatCurrency: (value: number, decimals?: number) => string;
  formatHoldDuration: (timestamp: string) => string;
  index: number;
  onPositionClosed?: () => void;
}

const LivePositionCard = memo(function LivePositionCard({
  position,
  formatCurrency,
  formatHoldDuration,
  onPositionClosed,
}: LivePositionCardProps) {
  const isProfit = position.livePnl >= 0;
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashDir, setFlashDir] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (position.priceFlash) {
      setIsFlashing(true);
      setFlashDir(position.priceFlash);
      const timer = setTimeout(() => {
        setIsFlashing(false);
        setFlashDir(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [position.priceFlash, position.livePrice]);

  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-colors duration-200",
        isProfit
          ? "border-green-500/20 hover:border-green-500/40"
          : "border-red-500/20 hover:border-red-500/40",
        isFlashing && flashDir === "up" && "value-glow-green",
        isFlashing && flashDir === "down" && "value-glow-red"
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 lg:px-4 lg:py-3 border-b border-border">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <h3 className="text-base lg:text-lg font-bold font-mono tracking-tight truncate text-foreground">
            {position.symbol}
          </h3>
          <Badge
            className={cn(
              "text-[10px] font-semibold px-1.5 py-0",
              position.side === "long"
                ? "bg-green-500/15 text-green-400 border-green-500/30"
                : "bg-red-500/15 text-red-400 border-red-500/30"
            )}
          >
            {position.side.toUpperCase()}
          </Badge>
          {position.exchange && (
            <span className="text-[10px] uppercase tracking-wide text-slate-500 font-mono">
              {position.exchange}
            </span>
          )}
          {position.strategy && (
            <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[10px] px-1.5 py-0">
              {position.strategy.replace(/_/g, " ").toUpperCase()}
            </Badge>
          )}
          <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-mono">
            <Clock className="w-3 h-3" />
            {formatHoldDuration(position.entryTime)}
          </span>
        </div>

        {/* Live P&L */}
        <div className="text-right shrink-0">
          <div className="flex items-center justify-end gap-1.5">
            {isProfit ? (
              <TrendingUp
                className={cn(
                  "w-4 h-4 text-green-400",
                  isFlashing && "animate-bounce"
                )}
              />
            ) : (
              <TrendingDown
                className={cn(
                  "w-4 h-4 text-red-400",
                  isFlashing && "animate-bounce"
                )}
              />
            )}
            <span
              className={cn(
                "text-lg lg:text-xl font-bold font-mono pnl-transition",
                isProfit ? "text-green-400" : "text-red-400"
              )}
              title={`Unrealized P&L in USD. ${isProfit ? "In profit" : "In loss"}.`}
            >
              {isProfit ? "+" : ""}
              {formatCurrency(position.livePnl)}
            </span>
          </div>
          <div
            className={cn(
              "text-[11px] font-mono",
              isProfit ? "text-green-500/70" : "text-red-500/70"
            )}
            title="Return % on position notional"
          >
            {isProfit ? "+" : ""}
            {position.livePnlPercent.toFixed(2)}% return
          </div>
        </div>
      </div>

      {/* Price grid — table-like cells */}
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border border-b border-border">
        <PriceCell label="Entry" value={formatCurrency(position.entryPrice)} />
        <PriceCell
          label="Current"
          value={formatCurrency(position.livePrice)}
          live
          flashDir={isFlashing ? flashDir : null}
          direction={position.priceDirection}
        />
        <PriceCell label="Qty" value={position.quantity.toFixed(6)} />
        <PriceCell
          label="Value"
          value={formatCurrency(position.livePrice * position.quantity)}
          live
        />
      </div>

      {/* Consensus (component owns its own polish) */}
      <div className="p-3 lg:p-4">
        <PositionConsensusCard
          positionId={position.id}
          symbol={position.symbol}
          side={position.side}
          isProfit={isProfit}
          pnlPercent={position.livePnlPercent}
          onPositionClosed={onPositionClosed}
        />
      </div>
    </div>
  );
});

// Single dense price cell
interface PriceCellProps {
  label: string;
  value: string;
  live?: boolean;
  flashDir?: "up" | "down" | null;
  direction?: "up" | "down" | "neutral";
}

function PriceCell({ label, value, live, flashDir, direction }: PriceCellProps) {
  return (
    <div
      className={cn(
        "px-3 py-2 lg:px-4 lg:py-2.5 transition-colors duration-150",
        flashDir === "up" && "bg-green-500/5",
        flashDir === "down" && "bg-red-500/5"
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
        {live && (
          <span className="inline-flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-green-400 connection-pulse" />
            <span className="text-[9px] text-green-400 font-semibold">LIVE</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <span
          className={cn(
            "text-sm lg:text-base font-mono font-semibold tabular-nums",
            flashDir === "up" && "text-green-400",
            flashDir === "down" && "text-red-400"
          )}
        >
          {value}
        </span>
        {direction === "up" && <ArrowUpRight className="w-3 h-3 text-green-400" />}
        {direction === "down" && <ArrowDownRight className="w-3 h-3 text-red-400" />}
        {direction === "neutral" && <Minus className="w-3 h-3 text-slate-500" />}
      </div>
    </div>
  );
}
