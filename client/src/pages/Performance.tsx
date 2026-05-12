import { useState, useEffect, useMemo } from "react";
import { useSocketIOMulti } from "@/hooks/useSocketIOMulti";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { SeerLoader } from "@/components/SeerLoader";
import { TrendingUp, TrendingDown, Award, Target, Download, Calendar, RefreshCw, Loader2, BarChart2, PieChart as PieChartIcon, Activity, Wallet, Clock, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Area, AreaChart, CartesianGrid } from 'recharts';
import TradeDecisionLog from '@/components/TradeDecisionLog';

export default function Performance() {
  const [timeframe, setTimeframe] = useState<'day' | 'week' | 'month' | 'year'>('month');
  const [filterSymbol, setFilterSymbol] = useState<string>('all');
  const [tradeType, setTradeType] = useState<'all' | 'live' | 'paper'>('all');
  // Phase 93.6 — window selector for win-rate / P&L summary
  const [statsWindow, setStatsWindow] = useState<'today' | '7d' | '30d' | 'all'>('all');
  
  // Get user for WebSocket connection
  const { user } = useAuth();
  
  // Use centralized portfolio context for consistent data across pages
  const portfolio = usePortfolio();
  
  // Use WebSocket for live position data with real-time unrealized P&L
  const { positions: wsPositions } = useSocketIOMulti(user?.id);

  // Fetch real trading data with retry and staleTime to prevent infinite loading
  const { data: tradingStats, isLoading: statsLoading, refetch: refetchStats, isError: statsError } = trpc.trading.getStats.useQuery(undefined, {
    retry: 1,
    retryDelay: 1000,
    staleTime: 30000,
  });
  // Phase 93.6 — time-windowed stats (today/7d/30d/all)
  const { data: windowStats } = trpc.trading.getStatsByWindow.useQuery(
    { window: statsWindow },
    { retry: 1, staleTime: 15000, refetchInterval: 30000 }
  );
  // Phase 93.6 — Binance/SEER reconciliation status
  const { data: reconciliation } = trpc.trading.getReconciliation.useQuery(undefined, {
    retry: 1,
    staleTime: 30000,
    refetchInterval: 60000,
  });
  const { data: paperWallet, isLoading: walletLoading, isError: walletError } = trpc.trading.getPaperWallet.useQuery(undefined, {
    retry: 1,
    retryDelay: 1000,
    staleTime: 30000,
  });
  const { data: allTrades, isLoading: tradesLoading, refetch: refetchTrades, isError: tradesError } = trpc.trading.getPaperTrades.useQuery(undefined, {
    retry: 1,
    retryDelay: 1000,
    staleTime: 30000,
  });
  const { data: positions } = trpc.seerMulti.getPositions.useQuery(undefined, {
    retry: 1,
    staleTime: 30000,
  });
  const { data: engineStatus } = trpc.seerMulti.getStatus.useQuery(undefined, {
    retry: 1,
    staleTime: 30000,
  });
  
  // Fetch portfolio funds (same source as Position page for consistency)
  const { data: portfolioFundsData } = trpc.settings.getPortfolioFunds.useQuery(undefined, {
    retry: 1,
    staleTime: 30000,
  });
  
  // Fetch closed positions (order history) for accurate P&L calculations
  const { data: closedPositions, isLoading: closedLoading, refetch: refetchClosed } = trpc.orderHistory.getClosedPositions.useQuery(
    { isPaper: true },
    {
      retry: 1,
      retryDelay: 1000,
      staleTime: 30000,
    }
  );
  
  // Fetch order analytics for accurate win rate and trade counts
  const { data: orderAnalytics, isLoading: analyticsLoading, refetch: refetchAnalytics } = trpc.orderHistory.getAnalytics.useQuery(
    { isPaper: true },
    {
      retry: 1,
      retryDelay: 1000,
      staleTime: 30000,
    }
  );

  // Phase 91 — Show the page in <2s. Previously waited up to 10 SECONDS for
  // every query to finish before rendering anything — and if any query failed
  // silently (slow trpc batch, transient DB lock during retention sweep), the
  // user saw a blank page until the 10s timeout expired.
  // Now: render immediately as soon as critical (stats) loads, OR after 2s
  // grace period, OR on any error. Individual sections still show their own
  // skeletons via their loading flags.
  const [loadingTimeout, setLoadingTimeout] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      // After 2s, render with whatever we have. Per-section loaders take over.
      setLoadingTimeout(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Show content if data loaded OR if there's an error OR if timeout occurred
  const hasError = statsError || walletError || tradesError;
  // Only gate on STATS — wallet + trades have their own per-section loaders.
  const isLoading = statsLoading && !loadingTimeout && !hasError;

  // Calculate performance metrics from real data
  // Prefer order analytics for closed trade metrics (more accurate)
  // Calculate unrealized P&L from WebSocket positions (live data) or fall back to tRPC positions
  const seerUnrealizedPnL = useMemo(() => {
    // Prefer WebSocket positions as they have live unrealizedPnl values
    const livePositions = wsPositions && wsPositions.length > 0 ? wsPositions : positions;
    if (!livePositions || livePositions.length === 0) return 0;
    
    // If positions have unrealizedPnl field (from WebSocket), use it directly
    if (livePositions[0]?.unrealizedPnl !== undefined && livePositions[0]?.unrealizedPnl !== 0) {
      return livePositions.reduce((total: number, pos: any) => total + (pos.unrealizedPnl || 0), 0);
    }
    
    // Otherwise calculate from entry/current prices
    return livePositions.reduce((total: number, pos: any) => {
      const currentPrice = parseFloat(pos.currentPrice || pos.entryPrice || '0');
      const entryPrice = parseFloat(pos.entryPrice || '0');
      const quantity = parseFloat(pos.quantity || '0');
      const side = pos.side?.toUpperCase();
      if (side === 'LONG' || side === 'BUY') {
        return total + (currentPrice - entryPrice) * quantity;
      } else {
        return total + (entryPrice - currentPrice) * quantity;
      }
    }, 0);
  }, [wsPositions, positions]);
  
  // Use centralized portfolio context values for consistency with other pages
  // Fall back to local calculations only if context not initialized
  const totalPnL = portfolio.isInitialized ? portfolio.totalPnL : (orderAnalytics?.netPnl ?? parseFloat(paperWallet?.totalPnL || '0'));
  const realizedPnL = portfolio.isInitialized ? portfolio.realizedPnL : (orderAnalytics?.netPnl ?? parseFloat(paperWallet?.realizedPnL || '0'));
  // Use SEER Multi positions unrealized P&L if available, otherwise fall back to portfolio context
  const unrealizedPnL = portfolio.isInitialized ? portfolio.unrealizedPnL : (seerUnrealizedPnL !== 0 ? seerUnrealizedPnL : parseFloat(paperWallet?.unrealizedPnL || '0'));
  const winRate = portfolio.isInitialized ? portfolio.winRate : (orderAnalytics?.winRate ?? parseFloat(paperWallet?.winRate || '0'));
  const totalTrades = portfolio.isInitialized ? portfolio.totalTrades : (orderAnalytics?.totalTrades ?? paperWallet?.totalTrades ?? 0);
  const winningTrades = portfolio.isInitialized ? portfolio.winningTrades : (orderAnalytics?.winningTrades ?? paperWallet?.winningTrades ?? 0);
  const losingTrades = portfolio.isInitialized ? portfolio.losingTrades : (orderAnalytics?.losingTrades ?? paperWallet?.losingTrades ?? 0);
  // Use portfolio context for consistent balance display across pages.
  // Phase 58 — three distinct values, each shown in its own card so the
  // "Available Balance" label means what users expect (deployable cash):
  //   balance          → portfolioFunds  (initial deposit)
  //   equity           → portfolioValue  (total worth incl. all PnL)
  //   availableBalance → portfolioFunds + realizedPnL − marginUsed (deployable)
  const balance = portfolio.isInitialized ? portfolio.portfolioFunds : (parseFloat(portfolioFundsData?.funds || '0') || parseFloat(paperWallet?.balance || '10000'));
  const equity = portfolio.isInitialized ? portfolio.portfolioValue : (parseFloat(portfolioFundsData?.funds || '0') || parseFloat(paperWallet?.equity || '10000'));
  const availableBalance = portfolio.isInitialized ? portfolio.availableBalance : balance;
  const marginUsed = portfolio.isInitialized ? portfolio.marginUsed : 0;
  const profitFactor = portfolio.isInitialized ? portfolio.profitFactor : (orderAnalytics?.profitFactor ?? 0);
  const avgWin = portfolio.isInitialized ? portfolio.avgWin : (orderAnalytics?.avgWin ?? 0);
  const avgLoss = portfolio.isInitialized ? portfolio.avgLoss : (orderAnalytics?.avgLoss ?? 0);
  const largestWin = portfolio.isInitialized ? portfolio.largestWin : (orderAnalytics?.largestWin ?? 0);
  const largestLoss = portfolio.isInitialized ? portfolio.largestLoss : (orderAnalytics?.largestLoss ?? 0);

  // Calculate ROI - use portfolio context for consistency
  // PHASE 10B FIX: Use actual wallet balance from DB, not hardcoded 10000
  // The paperWallet.balance reflects the current balance; for starting balance,
  // we derive it from current balance minus total PnL to get the original deposit
  const startingBalance = portfolio.isInitialized 
    ? portfolio.portfolioFunds 
    : (paperWallet?.balance ? Math.max(parseFloat(paperWallet.balance) - totalPnL, 1000) : 10000);
  const roi = portfolio.isInitialized ? portfolio.roi.toFixed(2) : ((totalPnL / startingBalance) * 100).toFixed(2);

  // Calculate Sharpe Ratio from real trade data
  const sharpeRatio = useMemo(() => {
    if (!allTrades || allTrades.length < 2) return '0.00';
    
    const returns = allTrades.map(t => parseFloat(t.pnl || '0'));
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev === 0) return '0.00';
    // Annualized Sharpe (assuming daily returns)
    return ((avgReturn / stdDev) * Math.sqrt(252)).toFixed(2);
  }, [allTrades]);

  // Calculate Max Drawdown
  const maxDrawdown = useMemo(() => {
    if (!allTrades || allTrades.length === 0) return 0;
    
    let peak = startingBalance;
    let maxDD = 0;
    let runningBalance = startingBalance;
    
    allTrades.forEach(trade => {
      runningBalance += parseFloat(trade.pnl || '0');
      if (runningBalance > peak) peak = runningBalance;
      const drawdown = (peak - runningBalance) / peak * 100;
      if (drawdown > maxDD) maxDD = drawdown;
    });
    
    return maxDD;
  }, [allTrades]);

  // Generate P&L data from closed positions grouped by timeframe
  const pnlChartData = useMemo(() => {
    // Prefer closed positions data over paper trades
    const tradeData = closedPositions && closedPositions.length > 0 ? closedPositions : allTrades;
    if (!tradeData || tradeData.length === 0) return [];
    
    const groupedData: { [key: string]: number } = {};
    
    tradeData.forEach((trade: any) => {
      // Handle both closed positions (exitTime) and paper trades (timestamp)
      const dateField = trade.exitTime || trade.timestamp;
      if (!dateField) return;
      
      const date = new Date(dateField);
      let key: string;
      
      switch (timeframe) {
        case 'day':
          key = date.toLocaleTimeString('en-US', { hour: '2-digit' });
          break;
        case 'week':
          key = date.toLocaleDateString('en-US', { weekday: 'short' });
          break;
        case 'month':
          key = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          break;
        case 'year':
          key = date.toLocaleDateString('en-US', { month: 'short' });
          break;
        default:
          key = date.toLocaleDateString();
      }
      
      // Handle both realizedPnl (closed positions) and pnl (paper trades)
      const pnlValue = parseFloat(trade.realizedPnl || trade.pnl || '0');
      groupedData[key] = (groupedData[key] || 0) + pnlValue;
    });
    
    return Object.entries(groupedData).map(([period, pnl]) => ({
      period,
      pnl: parseFloat(pnl.toFixed(2)),
      positive: pnl >= 0,
    }));
  }, [closedPositions, allTrades, timeframe]);

  // Win/Loss ratio data from real trades
  const winLossData = [
    { name: 'Wins', value: winningTrades, color: '#10b981' },
    { name: 'Losses', value: losingTrades, color: '#ef4444' },
  ];

  // Calculate best and worst trades from closed positions (database source of truth)
  const { bestTrades, worstTrades } = useMemo(() => {
    // ALWAYS use closedPositions from database for accurate data
    if (!closedPositions || closedPositions.length === 0) {
      return { bestTrades: [], worstTrades: [] };
    }
    
    // Filter out positions with invalid P&L (NaN)
    const validPositions = closedPositions.filter((p: any) => {
      const pnl = parseFloat(p.realizedPnl || '0');
      return !isNaN(pnl);
    });
    
    // Sort by P&L descending for best trades
    const sortedByPnL = [...validPositions].sort((a: any, b: any) => {
      const aPnl = parseFloat(a.realizedPnl || '0');
      const bPnl = parseFloat(b.realizedPnl || '0');
      return bPnl - aPnl;
    });
    
    // Get winning trades only for best trades
    const winningTrades = sortedByPnL.filter((t: any) => parseFloat(t.realizedPnl || '0') > 0);
    const best = winningTrades.slice(0, 5).map((trade: any) => {
      const pnl = parseFloat(trade.realizedPnl || '0');
      const entryPrice = parseFloat(trade.entryPrice || '1');
      const quantity = parseFloat(trade.quantity || '1');
      const dateField = trade.updatedAt || trade.createdAt;
      return {
        symbol: trade.symbol,
        pnl,
        side: trade.side,
        percentage: entryPrice > 0 && quantity > 0 ? (pnl / (entryPrice * quantity)) * 100 : 0,
        date: dateField ? new Date(dateField).toLocaleDateString() : 'N/A',
        strategy: trade.strategy || 'AI Consensus',
      };
    });
    
    // Get losing trades only for worst trades
    const losingTrades = sortedByPnL.filter((t: any) => parseFloat(t.realizedPnl || '0') < 0);
    const worst = losingTrades.slice(-5).reverse().map((trade: any) => {
      const pnl = parseFloat(trade.realizedPnl || '0');
      const entryPrice = parseFloat(trade.entryPrice || '1');
      const quantity = parseFloat(trade.quantity || '1');
      const dateField = trade.updatedAt || trade.createdAt;
      return {
        symbol: trade.symbol,
        pnl,
        side: trade.side,
        percentage: entryPrice > 0 && quantity > 0 ? (pnl / (entryPrice * quantity)) * 100 : 0,
        date: dateField ? new Date(dateField).toLocaleDateString() : 'N/A',
        strategy: trade.strategy || 'AI Consensus',
      };
    });
    
    return { bestTrades: best, worstTrades: worst };
  }, [closedPositions]);

  // Get unique symbols from trades
  const uniqueSymbols = useMemo(() => {
    if (!allTrades) return [];
    return Array.from(new Set(allTrades.map(t => t.symbol)));
  }, [allTrades]);

  // Filter trades by symbol and type
  const filteredTrades = useMemo(() => {
    if (!allTrades) return [];
    
    return allTrades.filter(trade => {
      if (filterSymbol !== 'all' && trade.symbol !== filterSymbol) return false;
      // Add trade type filter when live trading is implemented
      return true;
    });
  }, [allTrades, filterSymbol, tradeType]);

  // Calculate strategy performance breakdown
  const strategyPerformance = useMemo(() => {
    if (!allTrades || allTrades.length === 0) return [];
    
    const strategyStats: { [key: string]: { pnl: number; trades: number; wins: number } } = {};
    
    allTrades.forEach(trade => {
      const strategy = trade.strategy || 'Unknown';
      if (!strategyStats[strategy]) {
        strategyStats[strategy] = { pnl: 0, trades: 0, wins: 0 };
      }
      strategyStats[strategy].pnl += parseFloat(trade.pnl || '0');
      strategyStats[strategy].trades++;
      if (parseFloat(trade.pnl || '0') > 0) strategyStats[strategy].wins++;
    });
    
    return Object.entries(strategyStats).map(([name, stats]) => ({
      name,
      pnl: stats.pnl,
      trades: stats.trades,
      winRate: stats.trades > 0 ? (stats.wins / stats.trades * 100) : 0,
    }));
  }, [allTrades]);

  const exportToCSV = () => {
    if (!allTrades || allTrades.length === 0) {
      return;
    }

    const headers = ['Date', 'Symbol', 'Side', 'Quantity', 'Price', 'P&L', 'Commission', 'Strategy'];
    const rows = allTrades.map(trade => [
      new Date(trade.timestamp).toLocaleString(),
      trade.symbol,
      trade.side,
      trade.quantity,
      trade.price,
      trade.pnl || '0',
      trade.commission || '0',
      trade.strategy || 'N/A',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seer-trades-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const handleRefresh = () => {
    refetchStats();
    refetchTrades();
    refetchClosed();
    refetchAnalytics();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center space-y-6">
          <SeerLoader size="lg" />
          <p className="text-slate-400">Loading performance data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pt-16 lg:pt-20">
      <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 lg:py-8 space-y-4 lg:space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-white flex items-center gap-2 lg:gap-3">
              <BarChart2 className="w-6 h-6 lg:w-8 lg:h-8 text-purple-400" />
              <span className="hidden sm:inline">Performance Analytics</span>
              <span className="sm:hidden">Performance</span>
            </h1>
            <p className="text-slate-400 mt-1 text-sm lg:text-base hidden sm:block">Real-time trading performance and insights</p>
          </div>
          <div className="flex items-center gap-2 lg:gap-3">
            <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1 lg:gap-2 text-xs lg:text-sm">
              <RefreshCw className="w-3 h-3 lg:w-4 lg:h-4" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button onClick={exportToCSV} size="sm" className="gap-1 lg:gap-2 text-xs lg:text-sm">
              <Download className="w-3 h-3 lg:w-4 lg:h-4" />
              <span className="hidden sm:inline">Export CSV</span>
              <span className="sm:hidden">Export</span>
            </Button>
          </div>
        </div>

        {/* Trade Type Toggle */}
        <div className="flex flex-wrap items-center gap-2 lg:gap-4">
          <span className="text-xs lg:text-sm text-slate-400">View:</span>
          <div className="flex gap-1 lg:gap-2">
            {(['all', 'paper', 'live'] as const).map((type) => (
              <Button
                key={type}
                variant={tradeType === type ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTradeType(type)}
                className="capitalize text-xs lg:text-sm px-2 lg:px-3"
              >
                {type === 'all' ? 'All' : type === 'paper' ? 'Paper' : 'Live'}
              </Button>
            ))}
          </div>
          {tradeType === 'live' && (
            <Badge variant="outline" className="text-yellow-500 border-yellow-500 text-[10px] lg:text-xs">
              <AlertTriangle className="w-3 h-3 mr-1" />
              <span className="hidden sm:inline">Live trading requires exchange connection</span>
              <span className="sm:hidden">Needs exchange</span>
            </Badge>
          )}
        </div>

        {/* Key Metrics Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 lg:gap-4">
          <Card className="glass-card p-4 border-slate-800/50 border-l-4 border-l-emerald-500">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-400">Available Balance</p>
              <Wallet className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-xl font-bold text-emerald-400">${availableBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            <p className="text-xs text-slate-500 mt-1">
              {marginUsed > 0
                ? `Cash free to trade (${marginUsed.toLocaleString(undefined, { maximumFractionDigits: 0 })} locked in positions)`
                : 'Cash free to trade'}
            </p>
          </Card>

          <Card className="glass-card p-4 border-slate-800/50 border-l-4 border-l-cyan-500">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-400">Portfolio Value</p>
              <Activity className="w-4 h-4 text-cyan-400" />
            </div>
            <p className="text-xl font-bold text-cyan-400">${equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            <p className="text-xs text-slate-500 mt-1">Total equity (incl. open P&amp;L)</p>
          </Card>

          <Card className="glass-card p-4 border-slate-800/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-400">Initial Deposit</p>
              <Activity className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-xl font-bold text-slate-300">${balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            <p className="text-xs text-slate-500 mt-1">Starting capital</p>
          </Card>

          <Card className="glass-card p-4 border-slate-800/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-400">Total P&L</p>
              <TrendingUp className={`w-4 h-4 ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`} />
            </div>
            <p className={`text-xl font-bold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
            </p>
          </Card>

          <Card className="glass-card p-4 border-slate-800/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-400">Realized P&L</p>
              <Target className="w-4 h-4 text-green-400" />
            </div>
            <p className={`text-xl font-bold ${realizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {realizedPnL >= 0 ? '+' : ''}${realizedPnL.toFixed(2)}
            </p>
          </Card>

          <Card className="glass-card p-4 border-slate-800/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-400">Unrealized P&L</p>
              <Clock className="w-4 h-4 text-yellow-400" />
            </div>
            <p className={`text-xl font-bold ${unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {unrealizedPnL >= 0 ? '+' : ''}${unrealizedPnL.toFixed(2)}
            </p>
          </Card>

          <Card className="glass-card p-4 border-slate-800/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-400">Open Positions</p>
              <Activity className="w-4 h-4 text-cyan-400" />
            </div>
            <p className="text-xl font-bold text-white">{positions?.length || 0}</p>
          </Card>
        </div>

        {/* Phase 93.6 — Reconciliation banner. Surfaces any drift between
            SEER's view and the actual exchange account. Stays green when
            in sync; shows yellow/red when drift detected. */}
        {reconciliation && (
          <Card className={`glass-card p-4 border-2 ${
            reconciliation.drifts.some(d => d.severity === 'critical') ? 'border-red-500/50 bg-red-500/5' :
            reconciliation.drifts.some(d => d.severity === 'warn') ? 'border-yellow-500/50 bg-yellow-500/5' :
            'border-green-500/30 bg-green-500/5'
          }`}>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${
                  reconciliation.drifts.some(d => d.severity === 'critical') ? 'bg-red-400 animate-pulse' :
                  reconciliation.drifts.some(d => d.severity === 'warn') ? 'bg-yellow-400' :
                  'bg-green-400'
                }`} />
                <div>
                  <p className="text-sm font-semibold text-white">
                    Binance ↔ SEER Reconciliation
                  </p>
                  <p className="text-xs text-slate-400">
                    Checked {new Date(reconciliation.checkedAt).toLocaleTimeString()} ·
                    {' '}{reconciliation.binance ? 'Connected' : 'Cannot reach Binance'}
                  </p>
                </div>
              </div>
              {reconciliation.binance && reconciliation.seer?.wallet && (
                <div className="grid grid-cols-3 gap-4 text-xs font-mono">
                  <div>
                    <p className="text-slate-500">Balance</p>
                    <p className="text-white">Bin ${reconciliation.binance.totalWalletBalance.toFixed(2)}</p>
                    <p className="text-slate-400">SEER ${reconciliation.seer.wallet.balance.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Equity</p>
                    <p className="text-white">Bin ${reconciliation.binance.totalMarginBalance.toFixed(2)}</p>
                    <p className="text-slate-400">SEER ${reconciliation.seer.wallet.equity.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Open positions</p>
                    <p className="text-white">Bin {reconciliation.binance.openPositions.length}</p>
                    <p className="text-slate-400">SEER {reconciliation.seer.openPositions.filter(p => p.exchange === 'binance').length}</p>
                  </div>
                </div>
              )}
            </div>
            {reconciliation.drifts.filter(d => d.severity !== 'ok').length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-1">
                {reconciliation.drifts.filter(d => d.severity !== 'ok').slice(0, 4).map((d, i) => (
                  <p key={i} className={`text-xs ${
                    d.severity === 'critical' ? 'text-red-300' : 'text-yellow-300'
                  }`}>
                    {d.severity === 'critical' ? '⛔' : '⚠️'} {d.message}
                  </p>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Phase 93.6 — Time-window stats strip. Live win-rate / P&L /
            profit-factor across today / 7d / 30d / all-time, switchable. */}
        {windowStats && (
          <Card className="glass-card p-4 border-slate-800/50">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
              <h2 className="text-base font-bold text-white">Performance window</h2>
              <div className="flex gap-1">
                {(['today', '7d', '30d', 'all'] as const).map(w => (
                  <Button
                    key={w}
                    variant={statsWindow === w ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setStatsWindow(w)}
                    className="text-xs px-3"
                  >
                    {w === 'today' ? 'Today' : w === '7d' ? '7 days' : w === '30d' ? '30 days' : 'All time'}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <div>
                <p className="text-xs text-slate-400">Trades</p>
                <p className="text-2xl font-bold text-white">{windowStats.totalTrades}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Win rate</p>
                <p className={`text-2xl font-bold ${
                  windowStats.winRate >= 50 ? 'text-green-400' :
                  windowStats.winRate >= 40 ? 'text-yellow-400' : 'text-red-400'
                }`}>{windowStats.winRate.toFixed(1)}%</p>
                <p className="text-[10px] text-slate-500">{windowStats.wins}W / {windowStats.losses}L</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Net P&L</p>
                <p className={`text-2xl font-bold ${windowStats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {windowStats.totalPnl >= 0 ? '+' : ''}${windowStats.totalPnl.toFixed(2)}
                </p>
                <p className="text-[10px] text-slate-500">avg ${windowStats.avgPnl.toFixed(2)}/trade</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Profit factor</p>
                <p className={`text-2xl font-bold ${
                  (windowStats.profitFactor ?? 0) >= 1.5 ? 'text-green-400' :
                  (windowStats.profitFactor ?? 0) >= 1 ? 'text-yellow-400' : 'text-red-400'
                }`}>{windowStats.profitFactor !== null ? windowStats.profitFactor.toFixed(2) : '—'}</p>
                <p className="text-[10px] text-slate-500">gross win/loss</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Best trade</p>
                <p className="text-2xl font-bold text-green-400">+${windowStats.bestTrade.toFixed(2)}</p>
                <p className="text-[10px] text-slate-500">worst ${windowStats.worstTrade.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Commissions</p>
                <p className="text-2xl font-bold text-orange-300">${windowStats.totalCommission.toFixed(2)}</p>
                <p className="text-[10px] text-slate-500">net ${windowStats.netPnlAfterCommissions.toFixed(2)}</p>
              </div>
            </div>
          </Card>
        )}

        {/* Performance Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="glass-card p-6 border-slate-800/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-slate-400">ROI</p>
              <Target className="w-5 h-5 text-blue-500" />
            </div>
            <p className={`text-3xl font-bold ${parseFloat(roi) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {parseFloat(roi) >= 0 ? '+' : ''}{roi}%
            </p>
            <p className="text-xs text-slate-500 mt-1">Return on investment</p>
          </Card>

          <Card className="glass-card p-6 border-slate-800/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-slate-400">Sharpe Ratio</p>
              <Award className="w-5 h-5 text-purple-500" />
            </div>
            <p className="text-3xl font-bold text-white">{sharpeRatio}</p>
            <p className="text-xs text-slate-500 mt-1">Risk-adjusted returns</p>
          </Card>

          <Card className="glass-card p-6 border-slate-800/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-slate-400">Win Rate</p>
              <Target className="w-5 h-5 text-green-500" />
            </div>
            <p className="text-3xl font-bold text-white">{winRate.toFixed(1)}%</p>
            <p className="text-xs text-slate-500 mt-1">{winningTrades}W / {losingTrades}L</p>
          </Card>

          <Card className="glass-card p-6 border-slate-800/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-slate-400">Max Drawdown</p>
              <TrendingDown className="w-5 h-5 text-red-500" />
            </div>
            <p className="text-3xl font-bold text-red-400">-{maxDrawdown.toFixed(2)}%</p>
            <p className="text-xs text-slate-500 mt-1">Largest peak-to-trough</p>
          </Card>
        </div>

        {/* P&L Chart */}
        <Card className="glass-card p-6 border-slate-800/50">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 lg:mb-6">
            <h2 className="text-lg lg:text-xl font-bold text-white">P&L Performance</h2>
            <div className="flex gap-1 lg:gap-2">
              {(['day', 'week', 'month', 'year'] as const).map((tf) => (
                <Button
                  key={tf}
                  variant={timeframe === tf ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTimeframe(tf)}
                  className="capitalize text-xs lg:text-sm px-2 lg:px-3"
                >
                  {tf}
                </Button>
              ))}
            </div>
          </div>
          {pnlChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={pnlChartData}>
                <defs>
                  <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="period" stroke="#64748b" style={{ fontSize: '12px' }} />
                <YAxis stroke="#64748b" style={{ fontSize: '12px' }} tickFormatter={(value) => `$${value}`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#fff'
                  }}
                  formatter={(value: any) => [`$${value.toFixed(2)}`, 'P&L']}
                />
                <Area 
                  type="monotone" 
                  dataKey="pnl" 
                  stroke="#10b981" 
                  fill="url(#pnlGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-slate-500">
              No trade data available. Start trading to see performance charts.
            </div>
          )}
        </Card>

        {/* Win/Loss and Strategy Performance */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="glass-card p-6 border-slate-800/50">
            <h2 className="text-xl font-bold text-white mb-4">Win/Loss Distribution</h2>
            {totalTrades > 0 ? (
              <div className="flex items-center gap-6">
                {/* Donut Chart */}
                <div className="relative w-40 h-40 flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={winLossData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={65}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {winLossData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Center Stats */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-white">{totalTrades}</span>
                    <span className="text-xs text-slate-400">Total</span>
                  </div>
                </div>
                {/* Legend & Stats */}
                <div className="flex-1 space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                      <span className="text-slate-300">Winning Trades</span>
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-bold text-emerald-400">{winningTrades}</span>
                      <span className="text-xs text-slate-400 ml-2">({winRate.toFixed(1)}%)</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-500"></div>
                      <span className="text-slate-300">Losing Trades</span>
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-bold text-red-400">{losingTrades}</span>
                      <span className="text-xs text-slate-400 ml-2">({(100 - winRate).toFixed(1)}%)</span>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-700">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Avg Win</span>
                      <span className="text-emerald-400">+${winningTrades > 0 ? (realizedPnL > 0 ? (realizedPnL / winningTrades).toFixed(2) : '0.00') : '0.00'}</span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-slate-400">Avg Loss</span>
                      <span className="text-red-400">-${losingTrades > 0 ? Math.abs(realizedPnL < 0 ? realizedPnL / losingTrades : 0).toFixed(2) : '0.00'}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-slate-500">
                No trades yet
              </div>
            )}
          </Card>

          {/* Trading Performance Summary */}
          <Card className="glass-card p-6 border-slate-800/50">
            <h2 className="text-xl font-bold text-white mb-4">Trading Performance</h2>
            <div className="space-y-4">
              {/* Key Metrics Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-800/30">
                  <p className="text-xs text-slate-400 mb-1">Profit Factor</p>
                  <p className={`text-lg font-bold ${profitFactor >= 1 ? 'text-green-400' : 'text-red-400'}`}>
                    {profitFactor.toFixed(2)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/30">
                  <p className="text-xs text-slate-400 mb-1">ROI</p>
                  <p className={`text-lg font-bold ${parseFloat(roi) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {parseFloat(roi) >= 0 ? '+' : ''}{roi}%
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/30">
                  <p className="text-xs text-slate-400 mb-1">Avg Win</p>
                  <p className="text-lg font-bold text-green-400">+${avgWin.toFixed(2)}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/30">
                  <p className="text-xs text-slate-400 mb-1">Avg Loss</p>
                  <p className="text-lg font-bold text-red-400">-${Math.abs(avgLoss).toFixed(2)}</p>
                </div>
              </div>
              {/* Largest Win/Loss */}
              <div className="pt-3 border-t border-slate-700">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-slate-400">Largest Win</span>
                  <span className="text-sm font-semibold text-green-400">+${largestWin.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-400">Largest Loss</span>
                  <span className="text-sm font-semibold text-red-400">-${Math.abs(largestLoss).toFixed(2)}</span>
                </div>
              </div>
              {/* Sharpe Ratio */}
              <div className="pt-3 border-t border-slate-700">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-400">Sharpe Ratio</span>
                  <span className={`text-sm font-semibold ${parseFloat(sharpeRatio) >= 1 ? 'text-green-400' : parseFloat(sharpeRatio) >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {sharpeRatio}
                  </span>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Best/Worst Trades */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="glass-card p-6 border-slate-800/50">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-400" />
              Best Trades
            </h2>
            {bestTrades.length > 0 ? (
              <div className="space-y-2">
                {bestTrades.map((trade, index) => (
                  <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <div>
                      <p className="font-semibold text-white">{trade.symbol}</p>
                      <p className="text-xs text-slate-400">{trade.date} • {trade.strategy}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-green-400">+${trade.pnl.toFixed(2)}</p>
                      <p className="text-xs text-slate-400">+{trade.percentage.toFixed(2)}%</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-slate-500">No winning trades yet</div>
            )}
          </Card>

          <Card className="glass-card p-6 border-slate-800/50">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-red-400" />
              Worst Trades
            </h2>
            {worstTrades.filter(t => t.pnl < 0).length > 0 ? (
              <div className="space-y-2">
                {worstTrades.filter(t => t.pnl < 0).map((trade, index) => (
                  <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <div>
                      <p className="font-semibold text-white">{trade.symbol}</p>
                      <p className="text-xs text-slate-400">{trade.date} • {trade.strategy}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-red-400">${trade.pnl.toFixed(2)}</p>
                      <p className="text-xs text-slate-400">{trade.percentage.toFixed(2)}%</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-slate-500">No losing trades yet</div>
            )}
          </Card>
        </div>

        {/* Position History - Open & Closed */}
        <Card className="glass-card p-6 border-slate-800/50">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 lg:mb-6">
            <h2 className="text-lg lg:text-xl font-bold text-white">Position History</h2>
            <div className="flex flex-wrap gap-2 lg:gap-4">
              {/* Tab buttons for Open/Closed */}
              <div className="flex bg-slate-800/50 rounded-lg p-0.5 lg:p-1">
                <button
                  onClick={() => setTradeType('paper')}
                  className={`px-2 lg:px-4 py-1.5 lg:py-2 text-xs lg:text-sm rounded-md transition-colors ${
                    tradeType === 'paper' 
                      ? 'bg-blue-600 text-white' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Open ({positions?.length || 0})
                </button>
                <button
                  onClick={() => setTradeType('live')}
                  className={`px-2 lg:px-4 py-1.5 lg:py-2 text-xs lg:text-sm rounded-md transition-colors ${
                    tradeType === 'live' 
                      ? 'bg-blue-600 text-white' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Closed ({closedPositions?.length || 0})
                </button>
              </div>
              <select
                value={filterSymbol}
                onChange={(e) => setFilterSymbol(e.target.value)}
                className="bg-slate-800/50 border border-slate-700 text-white rounded-md px-2 lg:px-3 py-1.5 lg:py-2 text-xs lg:text-sm"
              >
                <option value="all">All Symbols</option>
                {uniqueSymbols.map(symbol => (
                  <option key={symbol} value={symbol}>{symbol}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            {tradeType === 'paper' ? (
              /* Open Positions Table */
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-400">Symbol</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-400">Side</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-slate-400">Quantity</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-slate-400">Entry Price</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-slate-400">Current Price</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-slate-400">Unrealized P&L</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-400">Opened At</th>
                  </tr>
                </thead>
                <tbody>
                  {positions && positions.length > 0 ? (
                    positions
                      .filter((pos: any) => filterSymbol === 'all' || pos.symbol === filterSymbol)
                      .map((pos: any, index: number) => {
                        const entryPrice = parseFloat(pos.entryPrice || '0');
                        const currentPrice = parseFloat(pos.currentPrice || pos.entryPrice || '0');
                        const quantity = parseFloat(pos.quantity || '0');
                        const side = pos.side?.toUpperCase();
                        const unrealizedPnl = side === 'LONG' || side === 'BUY'
                          ? (currentPrice - entryPrice) * quantity
                          : (entryPrice - currentPrice) * quantity;
                        return (
                          <tr key={index} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                            <td className="py-3 px-4 text-sm font-semibold text-white">{pos.symbol}</td>
                            <td className="py-3 px-4">
                              <Badge
                                variant="outline"
                                className={side === 'LONG' || side === 'BUY' ? 'text-green-500 border-green-500' : 'text-red-500 border-red-500'}
                              >
                                {side}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-white">{quantity.toFixed(4)}</td>
                            <td className="py-3 px-4 text-sm text-right text-white">${entryPrice.toFixed(2)}</td>
                            <td className="py-3 px-4 text-sm text-right text-white">${currentPrice.toFixed(2)}</td>
                            <td className={`py-3 px-4 text-sm text-right font-semibold ${unrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
                            </td>
                            <td className="py-3 px-4 text-sm text-slate-400">
                              {pos.createdAt ? new Date(pos.createdAt).toLocaleString() : 'N/A'}
                            </td>
                          </tr>
                        );
                      })
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500">
                        No open positions. The system will open positions when signals meet the threshold.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              /* Closed Positions Table */
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-400">Closed At</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-400">Symbol</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-400">Side</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-slate-400">Quantity</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-slate-400">Entry</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-slate-400">Exit</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-slate-400">Realized P&L</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-400">Exit Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {closedPositions && closedPositions.length > 0 ? (
                    [...closedPositions]
                      .filter((pos: any) => filterSymbol === 'all' || pos.symbol === filterSymbol)
                      .sort((a: any, b: any) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
                      .slice(0, 20)
                      .map((pos: any, index: number) => {
                        const pnl = parseFloat(pos.realizedPnl || '0');
                        const entryPrice = parseFloat(pos.entryPrice || '0');
                        const quantity = parseFloat(pos.quantity || '0');
                        const currentPriceVal = parseFloat(pos.currentPrice || '0');
                        const isLong = pos.side === 'long' || pos.side === 'LONG' || pos.side === 'BUY';
                        // Prefer actual exitPrice from DB, fallback to calculated from P&L
                        const dbExitPrice = parseFloat((pos as any).exitPrice || '0');
                        const calculatedExitPrice = quantity > 0
                          ? (isLong ? entryPrice + (pnl / quantity) : entryPrice - (pnl / quantity))
                          : currentPriceVal;
                        const exitPrice = dbExitPrice > 0 ? dbExitPrice : (calculatedExitPrice > 0 ? calculatedExitPrice : (currentPriceVal > 0 ? currentPriceVal : entryPrice));
                        return (
                          <tr key={index} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                            <td className="py-3 px-4 text-sm text-white">
                              {pos.exitTime ? new Date(pos.exitTime).toLocaleString() : (pos.updatedAt ? new Date(pos.updatedAt).toLocaleString() : 'N/A')}
                            </td>
                            <td className="py-3 px-4 text-sm font-semibold text-white">{pos.symbol}</td>
                            <td className="py-3 px-4">
                              <Badge
                                variant="outline"
                                className={isLong ? 'text-green-500 border-green-500' : 'text-red-500 border-red-500'}
                              >
                                {pos.side}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-white">{quantity.toFixed(4)}</td>
                            <td className="py-3 px-4 text-sm text-right text-white">${entryPrice.toFixed(2)}</td>
                            <td className="py-3 px-4 text-sm text-right text-white">${exitPrice.toFixed(2)}</td>
                            <td className={`py-3 px-4 text-sm text-right font-semibold ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                            </td>
                            <td className="py-3 px-4 text-sm text-slate-400 max-w-[200px] truncate" title={pos.exitReason || 'N/A'}>
                              {pos.exitReason || 'N/A'}
                            </td>
                          </tr>
                        );
                      })
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500">
                        No closed positions yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* Trade Decision Log moved to dedicated Signals page for better organization */}
      </div>
    </div>
  );
}
