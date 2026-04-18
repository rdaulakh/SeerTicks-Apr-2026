/**
 * SEER Dashboard
 * Autonomous AI Trading Engine - Automatic Background Processing
 * No manual start/stop - engine runs automatically when exchanges are configured
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Activity, Settings, TrendingUp, TrendingDown, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSocketIOMulti } from "@/hooks/useSocketIOMulti";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { SymbolSelector, ViewToggle, type TradingPair } from "@/components/SymbolSelector";
import { MultiPairGrid, type PairData } from "@/components/MultiPairGrid";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WebSocketHealthIndicator } from "@/components/WebSocketHealthIndicator";
// Health indicators moved to System Health page — Dashboard keeps only minimal status
import { StrategyOrchestratorViz } from "@/components/StrategyOrchestratorViz";
import { SignalHistoryChart } from "@/components/SignalHistoryChart";
import { AgentPerformanceLeaderboard } from "@/components/AgentPerformanceLeaderboard";
import { ActivityFeedStream } from "@/components/ActivityFeedStream";
import { NewsImpactScoring } from "@/components/NewsImpactScoring";
import { SignalBiasMonitor } from "@/components/SignalBiasMonitor";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { user } = useAuth();
  
  // Use ref to track user.id without causing re-renders
  const userIdRef = useRef<number | undefined>(user?.id);
  const hasMounted = useRef(false);
  
  // Update ref when user changes
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);
  
  // Only show toast on first mount, not on re-renders
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      console.log('[Dashboard] Component mounted');
    }
  }, []);
  
  const [view, setView] = useState<'single' | 'grid'>('grid');
  const [selectedPair, setSelectedPair] = useState<TradingPair | null>(null);

  // Get trading mode configuration
  const { data: tradingModeConfig, isLoading: tradingModeLoading } = trpc.settings.getTradingMode.useQuery(undefined, {
    enabled: !!user,
    staleTime: 30000,
  });

  // Get auto trading status - refetch every 10 seconds to match engine sync interval
  const { data: autoTradingConfig, isLoading: autoTradingLoading, error: autoTradingError } = trpc.settings.getAutoTrading.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 10000,
    staleTime: 5000,
  });
  

  
  // Use tradingModeConfig.autoTradeEnabled as fallback when autoTradingConfig is not yet loaded
  // This ensures the correct state is shown immediately on page load
  // When loading, assume auto trading is enabled (default for paper trading users)
  const isAutoTradingEnabled = autoTradingLoading || tradingModeLoading 
    ? true // Show AUTO while loading to prevent flash of MANUAL
    : (autoTradingConfig?.enabled ?? tradingModeConfig?.autoTradeEnabled ?? false);

  // Socket.IO for real-time multi-symbol updates (better proxy compatibility)
  const { connected, lastTick, symbolStates, positions, engineStatus: wsEngineStatus, error: wsError, priceUpdates } = useSocketIOMulti(user?.id, true);

  // tRPC queries - only fetch when authenticated
  const { data: engineStatus, refetch: refetchStatus } = trpc.seerMulti.getStatus.useQuery(undefined, {
    refetchInterval: 10000,
    enabled: !!user,
  });

  const { data: allPositions } = trpc.seerMulti.getPositions.useQuery(undefined, {
    refetchInterval: 30000,
    staleTime: 15000,
    enabled: !!user,
  });

  // Get configured exchanges and symbols from settings
  const { data: exchanges, isLoading: exchangesLoading, error: exchangesError } = trpc.settings.getExchanges.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60000,
  });
  const { data: symbols, isLoading: symbolsLoading, error: symbolsError } = trpc.settings.getSymbols.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60000,
  });
  


  // Prefer WebSocket engineStatus (real-time) over tRPC (cached)
  const currentEngineStatus = wsEngineStatus || engineStatus;
  const isRunning = currentEngineStatus?.isRunning || false;

  // Symbol states with signals, consensus, and prices — embedded in getStatus response
  // No separate query needed, reducing proxy rate limit pressure
  const trpcSymbolStates = currentEngineStatus?.symbolStates;
  const tickCount = currentEngineStatus?.tickCount || 0;
  const totalPnL = currentEngineStatus?.totalPnL || 0;

  
  // When engine is running, use engine status; when stopped, use configured counts from database
  const configuredExchanges = exchanges?.filter((e: any) => e.isActive)?.length || 0;
  const configuredSymbols = symbols?.filter((s: any) => s.isActive)?.length || 0;
  
  // For paper trading users, show default values (1 exchange, 2 symbols) while loading
  // This prevents the "0 exchanges, 0 pairs" flash on page refresh
  const paperTradingDefaults = {
    exchanges: 1,
    symbols: 2,
  };
  
  // Check if any exchange is connected (not just configured)
  const hasConnectedExchange = exchanges?.some((e: any) => e.isActive && e.connectionStatus === 'connected') || false;
  
  // Count unique exchanges from WebSocket symbolStates as fallback
  const wsExchangeCount = new Set(Array.from(symbolStates.values()).map(s => s.exchangeId)).size;
  const wsSymbolCount = symbolStates.size;
  
  // Use tRPC data if available, otherwise fall back to WebSocket data or paper trading defaults
  // When tradingModeConfig is loading, assume paper mode (default) to prevent flash of 0 values
  const isPaperMode = tradingModeLoading || tradingModeConfig?.mode === 'paper';
  const fallbackExchanges = configuredExchanges > 0 ? configuredExchanges : 
    (wsExchangeCount > 0 ? wsExchangeCount : (isPaperMode ? paperTradingDefaults.exchanges : 0));
  const fallbackSymbols = configuredSymbols > 0 ? configuredSymbols : 
    (wsSymbolCount > 0 ? wsSymbolCount : (isPaperMode ? paperTradingDefaults.symbols : 0));
  
  const activeExchanges = isRunning ? (currentEngineStatus?.activeExchanges || fallbackExchanges) : fallbackExchanges;
  const activeSymbols = isRunning ? (currentEngineStatus?.activeSymbols || fallbackSymbols) : fallbackSymbols;
  const startedAt = currentEngineStatus?.startedAt;

  // Calculate uptime
  const [uptime, setUptime] = useState<string>('');
  useEffect(() => {
    if (!isRunning) {
      setUptime('');
      return;
    }

    const updateUptime = () => {
      if (!startedAt) {
        setUptime('0s');
        return;
      }
      
      const now = Date.now();
      const start = new Date(startedAt).getTime();
      const diff = now - start;
      
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      if (hours > 0) {
        setUptime(`${hours}h ${minutes}m`);
      } else if (minutes > 0) {
        setUptime(`${minutes}m ${seconds}s`);
      } else {
        setUptime(`${seconds}s`);
      }
    };

    updateUptime();
    const interval = setInterval(updateUptime, 1000);
    return () => clearInterval(interval);
  }, [isRunning, startedAt]);

  // Convert symbol states to trading pairs (from WebSocket when running)
  const wsTradinPairs: TradingPair[] = Array.from(symbolStates.entries()).map(([key, state]) => ({
    exchangeId: state.exchangeId,
    exchangeName: state.exchangeName,
    symbol: state.symbol,
    isActive: true,
  }));
  
  // Fallback: Get configured trading pairs from database when engine is stopped
  const dbTradingPairs: TradingPair[] = (symbols || []).map((s: any) => {
    const exchange = (exchanges || []).find((e: any) => e.exchangeName === s.exchangeName);
    return {
      exchangeId: exchange?.id || s.id,
      exchangeName: s.exchangeName || 'Unknown',
      symbol: s.symbol,
      isActive: s.isActive,
    };
  }).filter((p: TradingPair) => p.isActive);
  
  // tRPC-based trading pairs (fallback when Socket.IO is unavailable)
  // getSymbolStates tRPC procedure already returns Object.values() (array of SymbolState)
  const trpcSymbolStatesArray = trpcSymbolStates || [];
  const trpcTradingPairs: TradingPair[] = trpcSymbolStatesArray.map((state: any) => ({
    exchangeId: state.exchangeId || 1,
    exchangeName: state.exchangeName || 'coinbase',
    symbol: state.symbol,
    isActive: true,
  }));

  // Priority: WebSocket > tRPC > database
  const tradingPairs = wsTradinPairs.length > 0 ? wsTradinPairs : (trpcTradingPairs.length > 0 ? trpcTradingPairs : dbTradingPairs);

  /**
   * Compute aggregate signal from all agent signals.
   * Uses weighted voting: each agent's signal contributes based on its confidence.
   * Returns the dominant direction and the average confidence of agents voting that way.
   */
  const computeAggregateSignal = (signals: any[], recommendation: any) => {
    // If recommendation exists with meaningful confidence (>1%), use it directly
    if (recommendation?.action && recommendation?.confidence > 0.01) {
      const action = recommendation.action;
      return {
        signal: (action === 'BUY' ? 'bullish' : action === 'SELL' ? 'bearish' : 'neutral') as 'bullish' | 'bearish' | 'neutral',
        confidence: Math.round(recommendation.confidence * 100),
        recommendation: action as 'BUY' | 'SELL' | 'HOLD',
      };
    }

    // Otherwise compute from individual agent signals
    if (!signals || signals.length === 0) {
      return { signal: 'neutral' as const, confidence: 0, recommendation: 'HOLD' as const };
    }

    let bullishScore = 0;
    let bearishScore = 0;
    let totalConfidence = 0;
    let agentCount = 0;

    for (const s of signals) {
      const conf = s.confidence || 0;
      if (conf <= 0) continue; // Skip agents with 0 confidence
      agentCount++;
      totalConfidence += conf;
      if (s.signal === 'bullish' || s.signal === 'buy') bullishScore += conf;
      else if (s.signal === 'bearish' || s.signal === 'sell') bearishScore += conf;
    }

    if (agentCount === 0) {
      return { signal: 'neutral' as const, confidence: 0, recommendation: 'HOLD' as const };
    }

    const avgConfidence = totalConfidence / agentCount;
    const netScore = bullishScore - bearishScore;
    const threshold = 0.1; // Minimum net score to declare a direction

    let signal: 'bullish' | 'bearish' | 'neutral';
    let rec: 'BUY' | 'SELL' | 'HOLD';

    if (netScore > threshold) {
      signal = 'bullish';
      rec = avgConfidence >= 0.5 ? 'BUY' : 'HOLD';
    } else if (netScore < -threshold) {
      signal = 'bearish';
      rec = avgConfidence >= 0.5 ? 'SELL' : 'HOLD';
    } else {
      signal = 'neutral';
      rec = 'HOLD';
    }

    // Express confidence as percentage (0-100)
    const confidencePct = Math.round(avgConfidence * 100);

    return { signal, confidence: confidencePct, recommendation: rec };
  };

  // Convert symbol states to pair data for grid (from Socket.IO when running)
  const wsPairData: PairData[] = Array.from(symbolStates.entries()).map(([key, state]: [string, any]) => {
    const positionsForPair = (allPositions || []).filter(
      (p: any) => p.exchangeId === state.exchangeId && p.symbol === state.symbol
    );

    const pnl = positionsForPair.reduce((sum: number, p: any) => sum + (p.unrealizedPnL || 0), 0);
    const { signal, confidence, recommendation } = computeAggregateSignal(state.signals, state.recommendation);

    return {
      exchangeId: state.exchangeId,
      exchangeName: state.exchangeName,
      symbol: state.symbol,
      status: 'active' as const,
      currentPrice: state.currentPrice || state.state?.currentPrice,
      priceChange24h: state.priceChange24h || state.state?.priceChange24h,
      signal,
      confidence,
      activePositions: positionsForPair.length,
      pnl,
      recommendation,
      lastUpdate: Date.now(),
      agentSignals: state.signals, // Pass raw signals for detailed view
    };
  });
  
  // tRPC-based pair data (fallback when Socket.IO is unavailable)
  const trpcPairData: PairData[] = trpcSymbolStatesArray.map((state: any) => {
    const positionsForPair = (allPositions || []).filter(
      (p: any) => p.symbol === state.symbol
    );
    const pnl = positionsForPair.reduce((sum: number, p: any) => sum + (p.unrealizedPnL || 0), 0);
    const { signal, confidence, recommendation } = computeAggregateSignal(state.signals, state.recommendation);
    return {
      exchangeId: state.exchangeId || 1,
      exchangeName: state.exchangeName || 'coinbase',
      symbol: state.symbol,
      status: 'active' as const,
      currentPrice: state.currentPrice || state.state?.currentPrice,
      priceChange24h: state.priceChange24h || state.state?.priceChange24h,
      signal,
      confidence,
      activePositions: positionsForPair.length,
      pnl,
      recommendation,
      lastUpdate: Date.now(),
      agentSignals: state.signals, // Pass raw signals for detailed view
    };
  });

  // Fallback: Show configured pairs from database when engine is stopped
  const dbPairData: PairData[] = dbTradingPairs.map((pair) => {
    const positionsForPair = (allPositions || []).filter(
      (p: any) => p.exchangeId === pair.exchangeId && p.symbol === pair.symbol
    );
    const pnl = positionsForPair.reduce((sum: number, p: any) => sum + (p.unrealizedPnL || 0), 0);
    
    return {
      exchangeId: pair.exchangeId,
      exchangeName: pair.exchangeName,
      symbol: pair.symbol,
      status: 'idle' as const,
      currentPrice: undefined,
      priceChange24h: undefined,
      signal: 'neutral' as const,
      confidence: 0,
      activePositions: positionsForPair.length,
      pnl,
      recommendation: 'HOLD' as const,
      lastUpdate: Date.now(),
    };
  });
  
  // Priority: WebSocket data > tRPC symbol states > database fallback
  const pairData = wsPairData.length > 0 ? wsPairData : (trpcPairData.length > 0 ? trpcPairData : dbPairData);


  const handleSelectPair = (exchangeId: number, symbol: string) => {
    const pair = tradingPairs.find(p => p.exchangeId === exchangeId && p.symbol === symbol);
    if (pair) {
      setSelectedPair(pair);
      setView('single');
    }
  };

  // Check if user needs to configure exchanges
  // For paper trading users, don't show configuration required if engine is running or starting
  const isPaperTrading = tradingModeConfig?.mode === 'paper';
  const isEngineStarting = !isRunning && (exchangesLoading || symbolsLoading || autoTradingLoading);
  const needsConfiguration = !isPaperTrading && !exchangesLoading && (!exchanges || exchanges.length === 0);

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-3 sm:p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-white flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/20">
              <Activity className="w-6 h-6 lg:w-7 lg:h-7 text-blue-400" />
            </div>
            SEER Dashboard
          </h1>
          <p className="text-gray-400 mt-1 text-sm lg:text-base">Autonomous AI Trading Engine</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:gap-4">
          {/* Trading Mode & Auto-Trade Status */}
          <div className="flex items-center gap-2 lg:gap-3 px-2 lg:px-4 py-1.5 lg:py-2 rounded-xl bg-gray-900/50 border border-gray-700/50">
            <div className="flex flex-col items-center">
              <span className={cn(
                "text-[10px] lg:text-xs font-semibold px-1.5 lg:px-2 py-0.5 rounded",
                tradingModeConfig?.mode === 'real'
                  ? "bg-red-500/20 text-red-400"
                  : "bg-blue-500/20 text-blue-400"
              )}>
                {tradingModeConfig?.mode === 'real' ? 'LIVE' : 'PAPER'}
              </span>
              <span className="text-[8px] lg:text-[10px] text-gray-500 mt-0.5">Mode</span>
            </div>
            <div className="w-px h-6 lg:h-8 bg-gray-700/50" />
            <div className="flex flex-col items-center">
              <span className={cn(
                "text-[10px] lg:text-xs font-semibold px-1.5 lg:px-2 py-0.5 rounded",
                isAutoTradingEnabled
                  ? "bg-green-500/20 text-green-400"
                  : "bg-orange-500/20 text-orange-400"
              )}>
                {isAutoTradingEnabled ? 'AUTO' : 'MANUAL'}
              </span>
              <span className="text-[8px] lg:text-[10px] text-gray-500 mt-0.5">Trading</span>
            </div>
          </div>

          <WebSocketHealthIndicator isRunning={isRunning} uptime={uptime} exchangeConnected={hasConnectedExchange} />

          <Link href="/system">
            <Button variant="outline" size="sm" className="gap-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10">
              <Activity className="w-4 h-4" />
              System Health
            </Button>
          </Link>

          <Link href="/settings">
            <Button variant="outline" size="sm" className="gap-2">
              <Settings className="w-4 h-4" />
              Settings
            </Button>
          </Link>
        </div>
      </div>

      {/* Configuration Required Banner */}
      {needsConfiguration && (
        <Card className="p-6 border-yellow-500/30 bg-yellow-500/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-yellow-500/20">
                <Zap className="w-6 h-6 text-yellow-400" />
              </div>
              <div>
                <h3 className="font-semibold text-yellow-400">Configuration Required</h3>
                <p className="text-sm text-gray-400">
                  Configure your exchange credentials and trading symbols to start autonomous trading
                </p>
              </div>
            </div>
            <Link href="/settings">
              <Button className="gap-2">
                <Settings className="w-4 h-4" />
                Configure Now
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
        <div className="relative overflow-hidden rounded-xl lg:rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700/50 p-3 sm:p-4 lg:p-5">
          <div className="absolute top-0 right-0 w-20 lg:w-32 h-20 lg:h-32 bg-blue-500/5 rounded-full blur-2xl" />
          <div className="relative">
            <div className="text-[10px] lg:text-xs text-gray-400 uppercase tracking-wider mb-1 lg:mb-2">Exchanges</div>
            <div className="text-xl lg:text-2xl font-bold text-white font-mono">{activeExchanges}</div>
            <p className="text-[10px] lg:text-xs text-gray-500 mt-0.5 lg:mt-1">{isRunning ? 'Connected' : 'Configured'}</p>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl lg:rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700/50 p-3 sm:p-4 lg:p-5">
          <div className="absolute top-0 right-0 w-20 lg:w-32 h-20 lg:h-32 bg-purple-500/5 rounded-full blur-2xl" />
          <div className="relative">
            <div className="text-[10px] lg:text-xs text-gray-400 uppercase tracking-wider mb-1 lg:mb-2">Trading Pairs</div>
            <div className="text-xl lg:text-2xl font-bold text-white font-mono">{activeSymbols}</div>
            <p className="text-[10px] lg:text-xs text-gray-500 mt-0.5 lg:mt-1">{isRunning ? 'Active' : 'Configured'}</p>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl lg:rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700/50 p-3 sm:p-4 lg:p-5">
          <div className="absolute top-0 right-0 w-20 lg:w-32 h-20 lg:h-32 bg-green-500/5 rounded-full blur-2xl" />
          <div className="relative">
            <div className="text-[10px] lg:text-xs text-gray-400 uppercase tracking-wider mb-1 lg:mb-2">Active Positions</div>
            <div className="text-xl lg:text-2xl font-bold text-white font-mono">{allPositions?.length || 0}</div>
            <p className="text-[10px] lg:text-xs text-gray-500 mt-0.5 lg:mt-1">Open</p>
          </div>
        </div>

        <div className={`relative overflow-hidden rounded-xl lg:rounded-2xl border p-3 sm:p-4 lg:p-5 ${
          totalPnL >= 0 
            ? "bg-gradient-to-br from-green-950/50 to-gray-900 border-green-500/20"
            : "bg-gradient-to-br from-red-950/50 to-gray-900 border-red-500/20"
        }`}>
          <div className={`absolute top-0 right-0 w-20 lg:w-32 h-20 lg:h-32 rounded-full blur-2xl ${
            totalPnL >= 0 ? "bg-green-500/5" : "bg-red-500/5"
          }`} />
          <div className="relative">
            <div className="text-[10px] lg:text-xs text-gray-400 uppercase tracking-wider mb-1 lg:mb-2">Total P&L</div>
            <div className={`text-xl lg:text-2xl font-bold font-mono ${
              totalPnL >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
            </div>
            <p className="text-[10px] lg:text-xs text-gray-500 mt-0.5 lg:mt-1">Unrealized</p>
          </div>
        </div>
      </div>

      {/* Enhanced Dashboard with Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="bg-gray-900/50 border border-gray-700/50 p-1 grid w-full grid-cols-3 sm:grid-cols-6 gap-1 mb-4 lg:mb-6 h-auto">
          <TabsTrigger value="overview" className="text-xs sm:text-sm py-1.5 sm:py-2">Overview</TabsTrigger>
          <TabsTrigger value="orchestrator" className="text-xs sm:text-sm py-1.5 sm:py-2">Strategy</TabsTrigger>
          <TabsTrigger value="signals" className="text-xs sm:text-sm py-1.5 sm:py-2">Signals</TabsTrigger>
          <TabsTrigger value="performance" className="text-xs sm:text-sm py-1.5 sm:py-2">Performance</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs sm:text-sm py-1.5 sm:py-2">Activity</TabsTrigger>
          <TabsTrigger value="news" className="text-xs sm:text-sm py-1.5 sm:py-2">News</TabsTrigger>
          <TabsTrigger value="bias" className="text-xs sm:text-sm py-1.5 sm:py-2">Bias</TabsTrigger>
        </TabsList>

        {/* Overview Tab - Original Dashboard Content */}
        <TabsContent value="overview" className="space-y-6">
          {tradingPairs.length > 0 && (
            <div className="flex items-center justify-between">
              <SymbolSelector
                tradingPairs={tradingPairs}
                selectedPair={selectedPair}
                onSelectPair={setSelectedPair}
              />
              <ViewToggle
                view={view}
                onViewChange={setView}
              />
            </div>
          )}

          {view === 'grid' ? (
            <div>
              <h2 className="text-xl font-semibold mb-4">All Trading Pairs</h2>
              <MultiPairGrid
                pairs={pairData}
                onSelectPair={handleSelectPair}
              />
            </div>
          ) : selectedPair ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">
                  {selectedPair.exchangeName} • {selectedPair.symbol}
                </h2>
                <Button variant="outline" size="sm" onClick={() => setView('grid')}>
                  Back to Grid
                </Button>
              </div>
              
              {/* Single Pair Detailed View */}
              {(() => {
                const pairKey = `${selectedPair.exchangeId}-${selectedPair.symbol}`;
                // Priority: Socket.IO symbolStates > tRPC symbolStates
                const wsPairState = symbolStates.get(pairKey);
                const trpcPairState = trpcSymbolStatesArray.find((s: any) => s.symbol === selectedPair.symbol);
                const pairState = wsPairState || trpcPairState;
                // Get real-time price from priceUpdates (updated via price_tick events)
                const realtimePrice = priceUpdates.get(selectedPair.symbol);
                // Also get price from pairData as final fallback
                const pairDataEntry = pairData.find(p => p.symbol === selectedPair.symbol);
                const pairPositions = (allPositions || []).filter(
                  (p: any) => p.exchangeId === selectedPair.exchangeId && p.symbol === selectedPair.symbol
                );
                
                return (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Price & Signal Card */}
                    <Card className="p-6 col-span-1">
                      <h3 className="text-lg font-semibold mb-4">Current Status</h3>
                      <div className="space-y-4">
                        <div>
                          <p className="text-sm text-muted-foreground">Current Price</p>
                          <p className="text-3xl font-bold font-mono">
                            ${realtimePrice?.price?.toLocaleString() || pairState?.currentPrice?.toLocaleString() || pairState?.state?.currentPrice?.toLocaleString() || pairDataEntry?.currentPrice?.toLocaleString() || '- - -'}
                          </p>
                          {(realtimePrice?.change24h || pairState?.priceChange24h || pairState?.state?.priceChange24h) && (
                            <p className={`text-sm ${(realtimePrice?.change24h || pairState?.priceChange24h || pairState?.state?.priceChange24h || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {(realtimePrice?.change24h || pairState?.priceChange24h || pairState?.state?.priceChange24h || 0) >= 0 ? '+' : ''}{(realtimePrice?.change24h || pairState?.priceChange24h || pairState?.state?.priceChange24h || 0).toFixed(2)}% (24h)
                            </p>
                          )}
                        </div>
                        <div className="border-t pt-4">
                          <p className="text-sm text-muted-foreground">AI Signal</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-xl font-bold ${pairState?.recommendation?.action === 'BUY' ? 'text-green-500' : pairState?.recommendation?.action === 'SELL' ? 'text-red-500' : 'text-muted-foreground'}`}>
                              {pairState?.recommendation?.action || 'HOLD'}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              ({((pairState?.signals?.[0]?.confidence || 0) * 100).toFixed(0)}% confidence)
                            </span>
                          </div>
                        </div>
                      </div>
                    </Card>
                    
                    {/* Positions Card */}
                    <Card className="p-6 col-span-1">
                      <h3 className="text-lg font-semibold mb-4">Open Positions ({pairPositions.length})</h3>
                      {pairPositions.length > 0 ? (
                        <div className="space-y-3">
                          {pairPositions.slice(0, 3).map((pos: any, idx: number) => (
                            <div key={idx} className="p-3 rounded-lg bg-muted/50">
                              <div className="flex justify-between items-center">
                                <span className={`font-medium ${pos.side === 'long' ? 'text-green-500' : 'text-red-500'}`}>
                                  {pos.side?.toUpperCase()}
                                </span>
                                <span className={`font-mono ${(pos.unrealizedPnL || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                  {(pos.unrealizedPnL || 0) >= 0 ? '+' : ''}${(pos.unrealizedPnL || 0).toFixed(2)}
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                Entry: ${pos.entryPrice} • Qty: {pos.quantity}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-sm">No open positions for this pair</p>
                      )}
                    </Card>
                    
                    {/* Agent Signals Card */}
                    <Card className="p-6 col-span-1">
                      <h3 className="text-lg font-semibold mb-4">Agent Signals</h3>
                      {pairState?.signals && pairState.signals.length > 0 ? (
                        <div className="space-y-2">
                          {pairState.signals.slice(0, 5).map((signal: any, idx: number) => (
                            <div key={idx} className="flex justify-between items-center p-2 rounded bg-muted/30">
                              <span className="text-sm">{signal.agentName || 'Agent'}</span>
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-medium ${signal.signal === 'bullish' ? 'text-green-500' : signal.signal === 'bearish' ? 'text-red-500' : 'text-muted-foreground'}`}>
                                  {signal.signal?.toUpperCase()}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {((signal.confidence || 0) * 100).toFixed(0)}%
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-sm">Waiting for agent signals...</p>
                      )}
                    </Card>
                  </div>
                );
              })()}
            </div>
          ) : (
            <Card className="p-12 text-center">
              <Activity className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-semibold mb-2">No Trading Pairs Active</h3>
              <p className="text-muted-foreground mb-4">
                Configure exchanges and symbols in Settings to begin trading
              </p>
              <Link href="/settings">
                <Button>Go to Settings</Button>
              </Link>
            </Card>
          )}
        </TabsContent>

        {/* Strategy Orchestrator Tab */}
        <TabsContent value="orchestrator">
          <StrategyOrchestratorViz />
        </TabsContent>

        {/* Signal History Tab */}
        <TabsContent value="signals">
          <SignalHistoryChart />
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance">
          <AgentPerformanceLeaderboard />
        </TabsContent>

        {/* Activity Feed Tab */}
        <TabsContent value="activity">
          <ActivityFeedStream />
        </TabsContent>

        {/* News Impact Tab */}
        <TabsContent value="news">
          <NewsImpactScoring />
        </TabsContent>

        {/* Signal Bias Tab */}
        <TabsContent value="bias">
          <SignalBiasMonitor />
        </TabsContent>
      </Tabs>

      {/* WebSocket Error */}
      {wsError && (
        <Card className="p-4 border-red-500/50 bg-red-500/10">
          <p className="text-sm text-red-500">{wsError}</p>
        </Card>
      )}
    </div>
  );
}
