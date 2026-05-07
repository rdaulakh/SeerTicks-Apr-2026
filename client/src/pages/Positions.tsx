/**
 * SEER Position Manager - Institutional Grade
 * 
 * Real-time position monitoring with tick-by-tick P&L updates.
 * Premium design matching top-tier crypto hedge fund platforms.
 * Fully autonomous - no manual intervention buttons.
 * 
 * Uses centralized PositionContext for consistent data across the app.
 * Enhanced with live price streaming for real-time P&L movements.
 */

import { useState, useEffect, useMemo, useCallback, memo } from "react";
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Target, 
  Shield, 
  Clock, 
  BarChart3, 
  Filter,
  Activity,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  RefreshCw,
  ChevronDown,
  Bot,
  ArrowUpDown,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
import { useLivePriceStream, LivePriceData } from "@/hooks/useLivePriceStream";
import { useWebSocketMulti } from "@/hooks/useWebSocketMulti";
import { trpc } from "@/lib/trpc";

// Sort options type
type SortOption = 'pnl_desc' | 'pnl_asc' | 'symbol_asc' | 'symbol_desc' | 'holdTime_desc' | 'holdTime_asc' | 'value_desc' | 'value_asc';

// Extended position with live price data
interface LivePosition extends Position {
  livePrice: number;
  livePnl: number;
  livePnlPercent: number;
  priceDirection: 'up' | 'down' | 'neutral';
  previousPrice: number;
  priceFlash?: 'up' | 'down';
  lastTickTime: number;
}

export default function Positions() {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterSymbol, setFilterSymbol] = useState<string>('all');
  const [filterPnL, setFilterPnL] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortOption>('pnl_desc');
  const [showFilters, setShowFilters] = useState(false);
  const [updateCounter, setUpdateCounter] = useState(0);

  const { user } = useAuth();

  // Use centralized position context - SINGLE SOURCE OF TRUTH
  const { 
    positions: contextPositions, 
    isLoading, 
    lastUpdateTime, 
    refetch 
  } = usePositions();

  // Use centralized portfolio context for consistent data across pages
  const {
    portfolioFunds: paperTradingBalance,
    portfolioValue: contextPortfolioValue,
    availableBalance: contextAvailableBalance,
    isPaperTrading,
    isLoading: portfolioLoading,
    isInitialized: portfolioInitialized,
  } = usePortfolio();

  // Normalize symbol to match price feed format (BTCUSDT -> BTC-USD)
  const normalizeSymbol = useCallback((symbol: string): string => {
    if (symbol.endsWith('USDT')) {
      return `${symbol.slice(0, -4)}-USD`;
    }
    if (symbol.endsWith('USD') && !symbol.includes('-')) {
      return `${symbol.slice(0, -3)}-USD`;
    }
    return symbol;
  }, []);

  // Get unique symbols from positions for price streaming (normalized)
  const positionSymbols = useMemo(() => 
    [...new Set(contextPositions.map(p => normalizeSymbol(p.symbol)))],
    [contextPositions, normalizeSymbol]
  );

  // Use main WebSocket connection for real-time UI updates (not for system status)
  const { connected: wsConnected, lastTick } = useWebSocketMulti(user?.id, true);
  
  // ARCHITECTURE: The SEER engine runs 24/7/365 on the server, independent of user sessions
  // The frontend is JUST a display layer - it shows what's already running on the server
  // We should show "Live" immediately based on SERVER engine status, not frontend WebSocket
  const { data: engineStatus, isLoading: engineStatusLoading } = trpc.seerMulti.getStatus.useQuery(undefined, {
    enabled: !!user,
    staleTime: 2000, // Cache for 2 seconds
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Real-time price streaming with enhanced hook
  const { 
    prices: livePrices, 
    connected: priceStreamConnected, 
    priceFlashes,
    lastUpdate: priceLastUpdate,
  } = useLivePriceStream({
    symbols: positionSymbols,
    updateThrottleMs: 50, // 50ms throttle for smooth updates
    onPriceUpdate: useCallback(() => {
      // Trigger re-render on price updates
      setUpdateCounter(c => c + 1);
    }, []),
  });

  // Enhance positions with live prices and calculate P&L in real-time
  const livePositions: LivePosition[] = useMemo(() => {
    return contextPositions.map(pos => {
      const normalizedSymbol = normalizeSymbol(pos.symbol);
      const priceData = livePrices.get(normalizedSymbol);
      const flash = priceFlashes.get(normalizedSymbol);
      
      // Use live price if available, otherwise fall back to stored price
      const livePrice = priceData?.price || pos.currentPrice || pos.entryPrice;
      const previousPrice = priceData?.previousPrice || pos.currentPrice || pos.entryPrice;
      
      // Calculate real-time P&L
      const direction = pos.side === 'long' ? 1 : -1;
      const priceDiff = (livePrice - pos.entryPrice) * direction;
      const livePnl = priceDiff * pos.quantity;
      const livePnlPercent = pos.entryPrice > 0 ? (priceDiff / pos.entryPrice) * 100 : 0;
      
      return {
        ...pos,
        livePrice,
        livePnl,
        livePnlPercent,
        priceDirection: priceData?.direction || 'neutral',
        previousPrice,
        priceFlash: flash?.direction,
        lastTickTime: priceData?.timestamp || Date.now(),
      };
    });
  }, [contextPositions, livePrices, priceFlashes, normalizeSymbol, updateCounter]);

  // Calculate portfolio metrics with live prices
  // Portfolio Value = Paper Trading Balance + Unrealized P&L (for paper trading mode)
  // Portfolio Value = Position Values (for live trading mode)
  const portfolioMetrics = useMemo(() => {
    let positionValue = 0;
    let totalPnL = 0;
    let winningCount = 0;
    let losingCount = 0;
    let totalHoldTime = 0;

    livePositions.forEach(pos => {
      const posValue = pos.livePrice * pos.quantity;
      positionValue += posValue;
      totalPnL += pos.livePnl;
      
      if (pos.livePnl > 0) winningCount++;
      else if (pos.livePnl < 0) losingCount++;

      const holdMs = Date.now() - new Date(pos.entryTime).getTime();
      totalHoldTime += holdMs;
    });

    // Phase 58 — Portfolio Value = total equity (initial funds + realized + unrealized).
    // Use the value computed by PortfolioContext so this card matches the
    // "Portfolio Value" card on the Performance page exactly. Pre-Phase-58 this
    // page recomputed locally as `paperBalance + unrealizedPnl_only`, which
    // diverged from Performance once realized PnL accumulated.
    const totalValue = portfolioInitialized
      ? contextPortfolioValue
      : (isPaperTrading ? paperTradingBalance + totalPnL : positionValue);

    // Calculate P&L percentage based on the base (initial funds when known)
    const baseForPercent = paperTradingBalance > 0 ? paperTradingBalance : (isPaperTrading ? 1 : positionValue);
    const totalPnLPercent = baseForPercent > 0 ? (totalPnL / baseForPercent) * 100 : 0;

    return {
      totalValue,
      positionValue, // Keep track of actual position value separately
      totalPnL,
      totalPnLPercent,
      winningCount,
      losingCount,
      avgHoldTime: livePositions.length > 0 ? totalHoldTime / livePositions.length : 0,
      paperBalance: paperTradingBalance,
      availableBalance: contextAvailableBalance,
      isPaperTrading,
    };
  }, [livePositions, paperTradingBalance, isPaperTrading, contextPortfolioValue, contextAvailableBalance, portfolioInitialized]);

  // Unique values for filters
  const uniqueSymbols = useMemo(() => 
    [...new Set(livePositions.map(p => p.symbol))].sort(), 
    [livePositions]
  );

  // Filtered and sorted positions
  const filteredPositions = useMemo(() => {
    let filtered = livePositions.filter(pos => {
      if (filterStatus !== 'all' && pos.status !== filterStatus) return false;
      if (filterSymbol !== 'all' && pos.symbol !== filterSymbol) return false;
      if (filterPnL === 'winning' && pos.livePnl <= 0) return false;
      if (filterPnL === 'losing' && pos.livePnl >= 0) return false;
      return true;
    });
    
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'pnl_desc': return b.livePnl - a.livePnl;
        case 'pnl_asc': return a.livePnl - b.livePnl;
        case 'symbol_asc': return a.symbol.localeCompare(b.symbol);
        case 'symbol_desc': return b.symbol.localeCompare(a.symbol);
        case 'holdTime_desc': return new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime();
        case 'holdTime_asc': return new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime();
        case 'value_desc': return (b.livePrice * b.quantity) - (a.livePrice * a.quantity);
        case 'value_asc': return (a.livePrice * a.quantity) - (b.livePrice * b.quantity);
        default: return 0;
      }
    });
  }, [livePositions, filterStatus, filterSymbol, filterPnL, sortBy]);

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
    const now = Date.now();
    const lastUpdate = Math.max(lastUpdateTime, priceLastUpdate);
    const seconds = Math.floor((now - lastUpdate) / 1000);
    if (seconds < 1) return 'Live';
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.floor(seconds / 60)}m ago`;
  }, [lastUpdateTime, priceLastUpdate]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-3 sm:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-4 lg:space-y-6">
        
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-white flex items-center gap-2 lg:gap-3">
              <div className="p-1.5 lg:p-2 rounded-lg lg:rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/20">
                <BarChart3 className="w-5 h-5 lg:w-7 lg:h-7 text-blue-400" />
              </div>
              Position Manager
            </h1>
            <div className="flex flex-wrap items-center gap-2 lg:gap-3 mt-2">
              {/* Live Connection Status - Use price stream when positions exist, WebSocket otherwise */}
              {(() => {
                // Show connected if either price stream is connected (for positions) or main WebSocket is connected
                // CRITICAL: Show Live based on SERVER engine status, not frontend WebSocket
                // The server is always running - default to true while loading
                const isConnected = engineStatusLoading ? true : (engineStatus?.isRunning ?? true);
                return (
                  <div className={cn(
                    "flex items-center gap-1.5 lg:gap-2 px-2 lg:px-3 py-1 rounded-full text-[10px] lg:text-xs font-medium",
                    isConnected 
                      ? "bg-green-500/10 text-green-400 border border-green-500/20" 
                      : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                  )}>
                    {isConnected ? (
                      <>
                        <div className="w-1.5 h-1.5 lg:w-2 lg:h-2 rounded-full bg-green-400 connection-pulse" />
                        <Wifi className="w-3 h-3 hidden sm:block" />
                        <span className="hidden sm:inline">{priceStreamConnected ? 'Real-time Stream Active' : 'Live'}</span>
                        <span className="sm:hidden">Live</span>
                      </>
                    ) : (
                      <>
                        <div className="w-1.5 h-1.5 lg:w-2 lg:h-2 rounded-full bg-yellow-400 animate-pulse" />
                        <WifiOff className="w-3 h-3 hidden sm:block" />
                        <span>Connecting...</span>
                      </>
                    )}
                  </div>
                );
              })()}
              <span className="text-[10px] lg:text-xs text-gray-500 hidden sm:inline">Updated {formatTimeSinceUpdate()}</span>
              <div className="flex items-center gap-1 lg:gap-1.5 px-1.5 lg:px-2 py-1 rounded-full bg-purple-500/10 border border-purple-500/20">
                <Bot className="w-3 h-3 text-purple-400" />
                <span className="text-[10px] lg:text-xs text-purple-400 font-medium hidden sm:inline">Autonomous</span>
              </div>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 lg:gap-3">
            {/* Sort Dropdown */}
            <Select value={sortBy} onValueChange={(value: SortOption) => setSortBy(value)}>
              <SelectTrigger className="w-[140px] lg:w-[180px] text-xs lg:text-sm border-gray-700 bg-gray-900/50 hover:bg-gray-800">
                <ArrowUpDown className="w-4 h-4 mr-2 text-gray-400" />
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700">
                <SelectItem value="pnl_desc">P&L (High to Low)</SelectItem>
                <SelectItem value="pnl_asc">P&L (Low to High)</SelectItem>
                <SelectItem value="symbol_asc">Symbol (A-Z)</SelectItem>
                <SelectItem value="symbol_desc">Symbol (Z-A)</SelectItem>
                <SelectItem value="holdTime_desc">Hold Time (Longest)</SelectItem>
                <SelectItem value="holdTime_asc">Hold Time (Shortest)</SelectItem>
                <SelectItem value="value_desc">Value (High to Low)</SelectItem>
                <SelectItem value="value_asc">Value (Low to High)</SelectItem>
              </SelectContent>
            </Select>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="border-gray-700 hover:bg-gray-800"
            >
              <Filter className="w-4 h-4 mr-2" />
              Filters
              {(filterStatus !== 'all' || filterSymbol !== 'all' || filterPnL !== 'all') && (
                <Badge className="ml-2 bg-blue-500/20 text-blue-400">Active</Badge>
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              className="border-gray-700 hover:bg-gray-800"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Portfolio Summary Cards - Live Updating */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
          {/* Total Portfolio Value */}
          <LiveMetricCard
            label="Portfolio Value"
            value={portfolioMetrics.totalValue}
            formatValue={formatCurrency}
            icon={<DollarSign className="w-4 h-4 text-gray-400" />}
            subtext={portfolioMetrics.isPaperTrading 
              ? `${livePositions.length} positions • Paper` 
              : `${livePositions.length} positions`
            }
            accentColor="blue"
            isLoading={portfolioLoading && !portfolioInitialized}
          />

          {/* Unrealized P&L */}
          <LiveMetricCard
            label="Unrealized P&L"
            value={portfolioMetrics.totalPnL}
            formatValue={formatCurrency}
            icon={portfolioMetrics.totalPnL >= 0 
              ? <TrendingUp className="w-4 h-4 text-green-400" />
              : <TrendingDown className="w-4 h-4 text-red-400" />
            }
            subtext={`${portfolioMetrics.totalPnLPercent >= 0 ? '+' : ''}${portfolioMetrics.totalPnLPercent.toFixed(2)}%`}
            colorByValue
            accentColor={portfolioMetrics.totalPnL >= 0 ? "green" : "red"}
            isLoading={isLoading && !portfolioInitialized}
          />

          {/* Win/Loss Count */}
          <div className="relative overflow-hidden rounded-xl lg:rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700/50 p-3 sm:p-4 lg:p-5">
            <div className="absolute top-0 right-0 w-20 lg:w-32 h-20 lg:h-32 bg-green-500/5 rounded-full blur-2xl" />
            <div className="relative">
              <div className="flex items-center gap-1.5 lg:gap-2 mb-1 lg:mb-2">
                <Activity className="w-3 h-3 lg:w-4 lg:h-4 text-gray-400" />
                <span className="text-[10px] lg:text-xs text-gray-400 uppercase tracking-wider">Win/Loss</span>
              </div>
              <div className="flex items-baseline gap-1 lg:gap-2">
                <span className="text-xl lg:text-2xl font-bold text-green-400 font-mono pnl-transition">
                  {portfolioMetrics.winningCount}
                </span>
                <span className="text-gray-500">/</span>
                <span className="text-xl lg:text-2xl font-bold text-red-400 font-mono pnl-transition">
                  {portfolioMetrics.losingCount}
                </span>
              </div>
              <p className="text-[10px] lg:text-xs text-gray-500 mt-0.5 lg:mt-1">
                {livePositions.length > 0 
                  ? `${((portfolioMetrics.winningCount / livePositions.length) * 100).toFixed(0)}% winning`
                  : 'No positions'
                }
              </p>
            </div>
          </div>

          {/* Avg Hold Time */}
          <div className="relative overflow-hidden rounded-xl lg:rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700/50 p-3 sm:p-4 lg:p-5">
            <div className="absolute top-0 right-0 w-20 lg:w-32 h-20 lg:h-32 bg-purple-500/5 rounded-full blur-2xl" />
            <div className="relative">
              <div className="flex items-center gap-1.5 lg:gap-2 mb-1 lg:mb-2">
                <Clock className="w-3 h-3 lg:w-4 lg:h-4 text-gray-400" />
                <span className="text-[10px] lg:text-xs text-gray-400 uppercase tracking-wider">Avg Hold Time</span>
              </div>
              <p className="text-xl lg:text-2xl font-bold text-white font-mono">
                {livePositions.length > 0 
                  ? formatHoldDuration(new Date(Date.now() - portfolioMetrics.avgHoldTime).toISOString())
                  : '--'
                }
              </p>
              <p className="text-[10px] lg:text-xs text-gray-500 mt-0.5 lg:mt-1">Per position</p>
            </div>
          </div>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="rounded-2xl bg-gray-900/50 border border-gray-700/50 p-4">
            <div className="flex flex-wrap items-center gap-4">
              {/* Status Filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Status:</span>
                <div className="flex gap-1">
                  {['all', 'open', 'partial', 'closing'].map(status => (
                    <Button
                      key={status}
                      variant={filterStatus === status ? "default" : "outline"}
                      size="sm"
                      onClick={() => setFilterStatus(status)}
                      className={cn(
                        "text-xs h-7",
                        filterStatus === status 
                          ? "bg-blue-500 hover:bg-blue-600" 
                          : "border-gray-700 hover:bg-gray-800"
                      )}
                    >
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Symbol Filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Symbol:</span>
                <Select value={filterSymbol} onValueChange={setFilterSymbol}>
                  <SelectTrigger className="w-[120px] h-7 text-xs border-gray-700 bg-gray-900/50">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700">
                    <SelectItem value="all">All</SelectItem>
                    {uniqueSymbols.map(symbol => (
                      <SelectItem key={symbol} value={symbol}>{symbol}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* P&L Filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">P&L:</span>
                <div className="flex gap-1">
                  {['all', 'winning', 'losing'].map(pnl => (
                    <Button
                      key={pnl}
                      variant={filterPnL === pnl ? "default" : "outline"}
                      size="sm"
                      onClick={() => setFilterPnL(pnl)}
                      className={cn(
                        "text-xs h-7",
                        filterPnL === pnl 
                          ? "bg-blue-500 hover:bg-blue-600" 
                          : "border-gray-700 hover:bg-gray-800"
                      )}
                    >
                      {pnl.charAt(0).toUpperCase() + pnl.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Positions Grid */}
        {isLoading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-64 rounded-2xl bg-gray-800/50" />
            ))}
          </div>
        ) : filteredPositions.length === 0 ? (
          <div className="rounded-2xl bg-gray-900/50 border border-gray-700/50 p-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mx-auto">
                <BarChart3 className="w-8 h-8 text-gray-500" />
              </div>
              <h3 className="text-xl font-semibold text-white">No Open Positions</h3>
              <p className="text-gray-400 max-w-md mx-auto">
                The AI agents are monitoring the market for optimal entry opportunities. 
                Positions will appear here when signals meet the confidence threshold.
              </p>
              <div className="flex items-center justify-center gap-2 text-purple-400">
                <Bot className="w-4 h-4" />
                <span className="text-sm">Autonomous trading active</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredPositions.map((position, index) => (
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

// Live Metric Card Component
interface LiveMetricCardProps {
  label: string;
  value: number;
  formatValue: (value: number) => string;
  icon: React.ReactNode;
  subtext?: string;
  colorByValue?: boolean;
  accentColor?: 'blue' | 'green' | 'red' | 'purple';
  isLoading?: boolean;
}

const LiveMetricCard = memo(function LiveMetricCard({
  label,
  value,
  formatValue,
  icon,
  subtext,
  colorByValue = false,
  accentColor = 'blue',
  isLoading = false,
}: LiveMetricCardProps) {
  const isPositive = value >= 0;
  
  const accentColors = {
    blue: 'bg-blue-500/5',
    green: 'bg-green-500/5',
    red: 'bg-red-500/5',
    purple: 'bg-purple-500/5',
  };

  const borderColors = {
    blue: 'border-gray-700/50',
    green: 'border-green-500/20',
    red: 'border-red-500/20',
    purple: 'border-purple-500/20',
  };

  return (
    <div className={cn(
      "relative overflow-hidden rounded-2xl border p-5 transition-all duration-300",
      colorByValue 
        ? (isPositive 
            ? "bg-gradient-to-br from-green-950/50 to-gray-900 border-green-500/20"
            : "bg-gradient-to-br from-red-950/50 to-gray-900 border-red-500/20")
        : `bg-gradient-to-br from-gray-900 to-gray-800 ${borderColors[accentColor]}`
    )}>
      <div className={cn(
        "absolute top-0 right-0 w-32 h-32 rounded-full blur-2xl",
        colorByValue ? (isPositive ? 'bg-green-500/5' : 'bg-red-500/5') : accentColors[accentColor]
      )} />
      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs text-gray-400 uppercase tracking-wider">{label}</span>
          {!isLoading && <div className="w-1.5 h-1.5 rounded-full bg-green-400 live-pulse" />}
        </div>
        {isLoading ? (
          <>
            <Skeleton className="h-8 w-32 bg-gray-700/50" />
            <Skeleton className="h-4 w-20 mt-2 bg-gray-700/30" />
          </>
        ) : (
          <>
            <p className={cn(
              "text-2xl font-bold font-mono pnl-transition",
              colorByValue 
                ? (isPositive ? "text-green-400" : "text-red-400")
                : "text-white"
            )}>
              {colorByValue && isPositive && value !== 0 ? '+' : ''}
              {formatValue(value)}
            </p>
            {subtext && (
              <p className={cn(
                "text-xs mt-1",
                colorByValue 
                  ? (isPositive ? "text-green-500/70" : "text-red-500/70")
                  : "text-gray-500"
              )}>
                {subtext}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
});

// Live Position Card Component
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
  index,
  onPositionClosed,
}: LivePositionCardProps) {
  const isProfit = position.livePnl >= 0;
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashDir, setFlashDir] = useState<'up' | 'down' | null>(null);

  // Handle price flash animation
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

  // Calculate distance to SL/TP
  const stopLoss = position.stopLoss ? Number(position.stopLoss) : null;
  const takeProfit = position.takeProfit ? Number(position.takeProfit) : null;

  return (
    <div 
      className={cn(
        "relative overflow-hidden rounded-2xl border transition-all duration-300",
        "bg-gradient-to-br from-gray-900 to-gray-800/50",
        isProfit ? "border-green-500/20 hover:border-green-500/40" : "border-red-500/20 hover:border-red-500/40",
        isFlashing && flashDir === 'up' && "value-glow-green",
        isFlashing && flashDir === 'down' && "value-glow-red"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Gradient accent bar */}
      <div className={cn(
        "absolute top-0 left-0 right-0 h-1",
        isProfit 
          ? "bg-gradient-to-r from-green-500 via-emerald-500 to-green-500" 
          : "bg-gradient-to-r from-red-500 via-rose-500 to-red-500"
      )} />

      <div className="p-6">
        {/* Header Row */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-xl font-bold text-white">{position.symbol}</h3>
                <Badge className={cn(
                  "text-xs font-semibold",
                  position.side === 'long' 
                    ? "bg-green-500/20 text-green-400 border-green-500/30" 
                    : "bg-red-500/20 text-red-400 border-red-500/30"
                )}>
                  {position.side.toUpperCase()}
                </Badge>
                <Badge className="bg-gray-700/50 text-gray-300 border-gray-600/50 text-xs">
                  {position.exchange}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatHoldDuration(position.entryTime)}
                </span>
                {position.strategy && (
                  <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-xs">
                    {position.strategy.replace(/_/g, ' ').toUpperCase()}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Live P&L Display */}
          <div className="text-right">
            <div className="flex items-center justify-end gap-2 mb-1">
              {isProfit ? (
                <TrendingUp className={cn("w-5 h-5 text-green-400", isFlashing && "animate-bounce")} />
              ) : (
                <TrendingDown className={cn("w-5 h-5 text-red-400", isFlashing && "animate-bounce")} />
              )}
              <span className={cn(
                "text-2xl font-bold font-mono pnl-transition",
                isProfit ? "text-green-400" : "text-red-400",
                isFlashing && flashDir === 'up' && "scale-105",
                isFlashing && flashDir === 'down' && "scale-105"
              )}>
                {isProfit ? '+' : ''}{formatCurrency(position.livePnl)}
              </span>
            </div>
            <span className={cn(
              "text-sm font-mono",
              isProfit ? "text-green-500/70" : "text-red-500/70"
            )}>
              {isProfit ? '+' : ''}{position.livePnlPercent.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Price Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {/* Entry Price */}
          <div className="bg-gray-800/50 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Entry Price</p>
            <p className="text-lg font-mono font-semibold text-white">
              {formatCurrency(position.entryPrice)}
            </p>
          </div>

          {/* Current Price - LIVE */}
          <div className={cn(
            "bg-gray-800/50 rounded-xl p-4 relative transition-all duration-150",
            isFlashing && flashDir === 'up' && "ring-1 ring-green-500/50 bg-green-500/5",
            isFlashing && flashDir === 'down' && "ring-1 ring-red-500/50 bg-red-500/5"
          )}>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs text-gray-500">Current Price</p>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 connection-pulse" />
                <span className="text-[10px] text-green-400 font-semibold">LIVE</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <p className={cn(
                "text-lg font-mono font-semibold text-white transition-colors duration-150",
                isFlashing && flashDir === 'up' && "text-green-400",
                isFlashing && flashDir === 'down' && "text-red-400"
              )}>
                {formatCurrency(position.livePrice)}
              </p>
              {position.priceDirection === 'up' && (
                <ArrowUpRight className="w-4 h-4 text-green-400 animate-bounce" />
              )}
              {position.priceDirection === 'down' && (
                <ArrowDownRight className="w-4 h-4 text-red-400 animate-bounce" />
              )}
              {position.priceDirection === 'neutral' && (
                <Minus className="w-3 h-3 text-gray-500" />
              )}
            </div>
          </div>

          {/* Quantity */}
          <div className="bg-gray-800/50 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Quantity</p>
            <p className="text-lg font-mono font-semibold text-white">
              {position.quantity.toFixed(6)}
            </p>
          </div>

          {/* Position Value - Live */}
          <div className="bg-gray-800/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs text-gray-500">Position Value</p>
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 live-pulse" />
            </div>
            <p className="text-lg font-mono font-semibold text-white">
              {formatCurrency(position.livePrice * position.quantity)}
            </p>
          </div>
        </div>

        {/* Real-Time Consensus Visualization */}
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
