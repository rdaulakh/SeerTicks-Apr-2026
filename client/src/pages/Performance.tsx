/**
 * Performance — Phase 93.13
 *
 * Institutional-grade analytics surface. Single source of truth per metric:
 *  - Win-rate, P&L, profit-factor, best/worst, commissions → time-window strip
 *    (trpc.trading.getStatsByWindow, switchable today / 7d / 30d / all-time).
 *  - ROI / Sharpe / Max Drawdown → Risk metrics strip (computed locally).
 *  - Best/Worst trade rows → from closedPositions.
 *  - Closed-position ledger table at the bottom (no open-positions section —
 *    that lives on the Positions page).
 *
 * Removed in this phase:
 *  - "Trade type" knob (paper/live filter) — autonomous platform, paper-only
 *    in the UI today; live is system-wide.
 *  - Duplicated "Trading Performance" card (ROI/Sharpe/AvgWin already shown).
 *  - "Win/Loss Distribution" donut — the time-window strip already shows
 *    wins/losses, win rate, P&L. The donut was decorative duplication.
 *  - Open-positions table — lives on the Positions page.
 *  - Symbol filter on a closed-trades table that already shows full ledger.
 *  - Emoji icons in reconciliation banner.
 */

import { useState, useEffect, useMemo } from "react";
import { useSocketIOMulti } from "@/hooks/useSocketIOMulti";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { SeerLoader } from "@/components/SeerLoader";
import {
  TrendingUp, TrendingDown, Download, RefreshCw, BarChart2, Activity, Wallet, Clock, AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

type StatsWindow = 'today' | '7d' | '30d' | 'all';
type ChartTimeframe = 'day' | 'week' | 'month' | 'year';

export default function Performance() {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('month');
  const [statsWindow, setStatsWindow] = useState<StatsWindow>('all');

  const { user } = useAuth();
  const portfolio = usePortfolio();
  const { positions: wsPositions } = useSocketIOMulti(user?.id);

  const { data: tradingStats, isLoading: statsLoading, refetch: refetchStats, isError: statsError } =
    trpc.trading.getStats.useQuery(undefined, { retry: 1, retryDelay: 1000, staleTime: 30000 });

  // Time-windowed stats (today/7d/30d/all) — primary source of truth for win-rate, P&L, profit factor.
  const { data: windowStats } = trpc.trading.getStatsByWindow.useQuery(
    { window: statsWindow },
    { retry: 1, staleTime: 15000, refetchInterval: 30000 },
  );

  // Reconciliation between SEER's view and the actual exchange.
  const { data: reconciliation } = trpc.trading.getReconciliation.useQuery(undefined, {
    retry: 1, staleTime: 30000, refetchInterval: 60000,
  });

  const { data: paperWallet, isError: walletError } = trpc.trading.getPaperWallet.useQuery(undefined, {
    retry: 1, retryDelay: 1000, staleTime: 30000,
  });

  const { data: allTrades, refetch: refetchTrades, isError: tradesError } =
    trpc.trading.getPaperTrades.useQuery(undefined, { retry: 1, retryDelay: 1000, staleTime: 30000 });

  const { data: positions } = trpc.seerMulti.getPositions.useQuery(undefined, {
    retry: 1, staleTime: 30000,
  });

  const { data: portfolioFundsData } = trpc.settings.getPortfolioFunds.useQuery(undefined, {
    retry: 1, staleTime: 30000,
  });

  const { data: closedPositions, refetch: refetchClosed } = trpc.orderHistory.getClosedPositions.useQuery(
    { isPaper: true },
    { retry: 1, retryDelay: 1000, staleTime: 30000 },
  );

  // Phase 91 grace-period render: show page in <2s even if some queries stall.
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLoadingTimeout(true), 2000);
    return () => clearTimeout(t);
  }, []);

  const hasError = statsError || walletError || tradesError;
  const isLoading = statsLoading && !loadingTimeout && !hasError;

  // ── Derived metrics. Portfolio context is single source of truth across pages.
  const seerUnrealizedPnL = useMemo(() => {
    const live = wsPositions && wsPositions.length > 0 ? wsPositions : positions;
    if (!live || live.length === 0) return 0;
    if (live[0]?.unrealizedPnl !== undefined && live[0]?.unrealizedPnl !== 0) {
      return live.reduce((t: number, p: any) => t + (p.unrealizedPnl || 0), 0);
    }
    return live.reduce((t: number, p: any) => {
      const curr = parseFloat(p.currentPrice || p.entryPrice || '0');
      const ent = parseFloat(p.entryPrice || '0');
      const qty = parseFloat(p.quantity || '0');
      const side = p.side?.toUpperCase();
      return side === 'LONG' || side === 'BUY'
        ? t + (curr - ent) * qty
        : t + (ent - curr) * qty;
    }, 0);
  }, [wsPositions, positions]);

  const totalPnL = portfolio.isInitialized ? portfolio.totalPnL : parseFloat(paperWallet?.totalPnL || '0');
  const realizedPnL = portfolio.isInitialized ? portfolio.realizedPnL : parseFloat(paperWallet?.realizedPnL || '0');
  const unrealizedPnL = portfolio.isInitialized ? portfolio.unrealizedPnL : (seerUnrealizedPnL !== 0 ? seerUnrealizedPnL : parseFloat(paperWallet?.unrealizedPnL || '0'));
  const balance = portfolio.isInitialized ? portfolio.portfolioFunds : (parseFloat(portfolioFundsData?.funds || '0') || parseFloat(paperWallet?.balance || '10000'));
  const equity = portfolio.isInitialized ? portfolio.portfolioValue : (parseFloat(portfolioFundsData?.funds || '0') || parseFloat(paperWallet?.equity || '10000'));
  const availableBalance = portfolio.isInitialized ? portfolio.availableBalance : balance;
  const marginUsed = portfolio.isInitialized ? portfolio.marginUsed : 0;

  const startingBalance = portfolio.isInitialized
    ? portfolio.portfolioFunds
    : (paperWallet?.balance ? Math.max(parseFloat(paperWallet.balance) - totalPnL, 1000) : 10000);
  const roi = portfolio.isInitialized ? portfolio.roi : (totalPnL / startingBalance) * 100;

  const sharpeRatio = useMemo(() => {
    if (!allTrades || allTrades.length < 2) return 0;
    const returns = allTrades.map(t => parseFloat(t.pnl || '0'));
    const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - avg, 2), 0) / returns.length;
    const sd = Math.sqrt(variance);
    if (sd === 0) return 0;
    return (avg / sd) * Math.sqrt(252);
  }, [allTrades]);

  const maxDrawdown = useMemo(() => {
    if (!allTrades || allTrades.length === 0) return 0;
    let peak = startingBalance;
    let maxDD = 0;
    let running = startingBalance;
    for (const t of allTrades) {
      running += parseFloat(t.pnl || '0');
      if (running > peak) peak = running;
      const dd = ((peak - running) / peak) * 100;
      if (dd > maxDD) maxDD = dd;
    }
    return maxDD;
  }, [allTrades, startingBalance]);

  // P&L chart series — grouped by timeframe bucket, signed.
  const pnlChartData = useMemo(() => {
    const trades = closedPositions && closedPositions.length > 0 ? closedPositions : allTrades;
    if (!trades || trades.length === 0) return [];
    const grouped: Record<string, number> = {};
    for (const t of trades) {
      const dateField = (t as any).exitTime || (t as any).timestamp;
      if (!dateField) continue;
      const d = new Date(dateField);
      let key: string;
      switch (timeframe) {
        case 'day': key = d.toLocaleTimeString('en-US', { hour: '2-digit' }); break;
        case 'week': key = d.toLocaleDateString('en-US', { weekday: 'short' }); break;
        case 'month': key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); break;
        case 'year': key = d.toLocaleDateString('en-US', { month: 'short' }); break;
      }
      const pnl = parseFloat((t as any).realizedPnl || (t as any).pnl || '0');
      grouped[key] = (grouped[key] || 0) + pnl;
    }
    return Object.entries(grouped).map(([period, pnl]) => ({ period, pnl: parseFloat(pnl.toFixed(2)) }));
  }, [closedPositions, allTrades, timeframe]);

  // Best / worst trades from closed positions.
  const { bestTrades, worstTrades } = useMemo(() => {
    if (!closedPositions || closedPositions.length === 0) return { bestTrades: [], worstTrades: [] };
    const valid = closedPositions.filter((p: any) => !isNaN(parseFloat(p.realizedPnl || '0')));
    const sorted = [...valid].sort((a: any, b: any) =>
      parseFloat(b.realizedPnl || '0') - parseFloat(a.realizedPnl || '0'),
    );
    const mapTrade = (t: any) => {
      const pnl = parseFloat(t.realizedPnl || '0');
      const ent = parseFloat(t.entryPrice || '1');
      const qty = parseFloat(t.quantity || '1');
      return {
        symbol: t.symbol,
        pnl,
        side: t.side,
        percentage: ent > 0 && qty > 0 ? (pnl / (ent * qty)) * 100 : 0,
        date: (t.updatedAt || t.createdAt) ? new Date(t.updatedAt || t.createdAt).toLocaleDateString() : 'N/A',
      };
    };
    return {
      bestTrades: sorted.filter((t: any) => parseFloat(t.realizedPnl || '0') > 0).slice(0, 5).map(mapTrade),
      worstTrades: sorted.filter((t: any) => parseFloat(t.realizedPnl || '0') < 0).slice(-5).reverse().map(mapTrade),
    };
  }, [closedPositions]);

  const exportToCSV = () => {
    if (!allTrades || allTrades.length === 0) return;
    const headers = ['Date', 'Symbol', 'Side', 'Quantity', 'Price', 'P&L', 'Commission', 'Strategy'];
    const rows = allTrades.map(t => [
      new Date(t.timestamp).toLocaleString(),
      t.symbol, t.side, t.quantity, t.price, t.pnl || '0', t.commission || '0', t.strategy || 'N/A',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seer-trades-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const handleRefresh = () => { refetchStats(); refetchTrades(); refetchClosed(); };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-6">
          <SeerLoader size="lg" />
          <p className="text-muted-foreground text-sm">Loading performance data...</p>
        </div>
      </div>
    );
  }

  const reconSeverity = reconciliation?.drifts.some(d => d.severity === 'critical')
    ? 'critical'
    : reconciliation?.drifts.some(d => d.severity === 'warn')
    ? 'warn'
    : 'ok';

  return (
    <div className="min-h-screen bg-background text-foreground pt-16 lg:pt-20">
      <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 lg:py-6 space-y-4">

        {/* ─── HEADER ───────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
              <BarChart2 className="w-5 h-5 lg:w-6 lg:h-6 text-purple-400" />
              Performance
            </h1>
            <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">
              Live P&amp;L, risk, and trade ledger.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} className="h-8 text-xs gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button onClick={exportToCSV} size="sm" className="h-8 text-xs gap-1.5">
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export CSV</span>
            </Button>
          </div>
        </div>

        {/* ─── BALANCE / P&L STRIP ──────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          <Card className="border-slate-800/60 bg-slate-900/40 p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Available</p>
              <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <p className="text-base lg:text-lg font-bold text-emerald-400 font-mono tabular-nums">
              ${availableBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5 truncate">
              {marginUsed > 0 ? `$${marginUsed.toFixed(0)} locked` : 'free to trade'}
            </p>
          </Card>

          <Card className="border-slate-800/60 bg-slate-900/40 p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Equity</p>
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <p className="text-base lg:text-lg font-bold text-cyan-400 font-mono tabular-nums">
              ${equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">incl. open P&amp;L</p>
          </Card>

          <Card className="border-slate-800/60 bg-slate-900/40 p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Deposit</p>
              <Activity className="w-3.5 h-3.5 text-slate-500" />
            </div>
            <p className="text-base lg:text-lg font-bold text-foreground font-mono tabular-nums">
              ${balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">starting capital</p>
          </Card>

          <Card className="border-slate-800/60 bg-slate-900/40 p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Total P&amp;L</p>
              <TrendingUp className={`w-3.5 h-3.5 ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`} />
            </div>
            <p className={`text-base lg:text-lg font-bold font-mono tabular-nums ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">realized + open</p>
          </Card>

          <Card className="border-slate-800/60 bg-slate-900/40 p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Realized</p>
              <TrendingUp className={`w-3.5 h-3.5 ${realizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`} />
            </div>
            <p className={`text-base lg:text-lg font-bold font-mono tabular-nums ${realizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {realizedPnL >= 0 ? '+' : ''}${realizedPnL.toFixed(2)}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">closed trades</p>
          </Card>

          <Card className="border-slate-800/60 bg-slate-900/40 p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Unrealized</p>
              <Clock className={`w-3.5 h-3.5 ${unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`} />
            </div>
            <p className={`text-base lg:text-lg font-bold font-mono tabular-nums ${unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {unrealizedPnL >= 0 ? '+' : ''}${unrealizedPnL.toFixed(2)}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {positions?.length || 0} open
            </p>
          </Card>
        </div>

        {/* ─── RECONCILIATION BANNER ────────────────────────────── */}
        {reconciliation && (
          <Card className={`p-3 border ${
            reconSeverity === 'critical' ? 'border-red-500/40 bg-red-500/5' :
            reconSeverity === 'warn' ? 'border-yellow-500/40 bg-yellow-500/5' :
            'border-slate-800/60 bg-slate-900/40'
          }`}>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  reconSeverity === 'critical' ? 'bg-red-400 animate-pulse' :
                  reconSeverity === 'warn' ? 'bg-yellow-400' :
                  'bg-green-400'
                }`} />
                <div>
                  <p className="text-xs font-semibold text-foreground">Binance &harr; SEER</p>
                  <p className="text-[10px] text-slate-400 font-mono">
                    {new Date(reconciliation.checkedAt).toLocaleTimeString()} ·{' '}
                    {reconciliation.binance ? 'connected' : 'unreachable'}
                  </p>
                </div>
              </div>
              {reconciliation.binance && reconciliation.seer?.wallet && (
                <div className="grid grid-cols-3 gap-3 text-[10px] font-mono tabular-nums">
                  <div>
                    <p className="text-slate-500 uppercase tracking-wider">Balance</p>
                    <p className="text-slate-200">Bin ${reconciliation.binance.totalWalletBalance.toFixed(2)}</p>
                    <p className="text-slate-400">SEER ${reconciliation.seer.wallet.balance.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 uppercase tracking-wider">Equity</p>
                    <p className="text-slate-200">Bin ${reconciliation.binance.totalMarginBalance.toFixed(2)}</p>
                    <p className="text-slate-400">SEER ${reconciliation.seer.wallet.equity.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 uppercase tracking-wider">Positions</p>
                    <p className="text-slate-200">Bin {reconciliation.binance.openPositions.length}</p>
                    <p className="text-slate-400">SEER {reconciliation.seer.openPositions.filter(p => p.exchange === 'binance').length}</p>
                  </div>
                </div>
              )}
            </div>
            {reconciliation.drifts.filter(d => d.severity !== 'ok').length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-700/40 space-y-0.5">
                {reconciliation.drifts.filter(d => d.severity !== 'ok').slice(0, 4).map((d, i) => (
                  <p key={i} className={`text-[11px] flex items-center gap-1.5 ${
                    d.severity === 'critical' ? 'text-red-300' : 'text-yellow-300'
                  }`}>
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    {d.message}
                  </p>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* ─── TIME-WINDOW STATS (single source of truth) ──────── */}
        {windowStats && (
          <Card className="border-slate-800/60 bg-slate-900/40 p-3 lg:p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <h2 className="text-xs font-bold text-foreground uppercase tracking-wider">Performance window</h2>
              <div className="flex gap-1">
                {(['today', '7d', '30d', 'all'] as const).map(w => (
                  <Button
                    key={w}
                    variant={statsWindow === w ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setStatsWindow(w)}
                    className="h-7 text-[11px] px-2.5"
                  >
                    {w === 'today' ? 'Today' : w === '7d' ? '7d' : w === '30d' ? '30d' : 'All'}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Trades</p>
                <p className="text-lg lg:text-xl font-bold text-foreground font-mono tabular-nums">{windowStats.totalTrades}</p>
                <p className="text-[10px] text-slate-500">closed</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Win rate</p>
                <p className={`text-lg lg:text-xl font-bold font-mono tabular-nums ${
                  windowStats.winRate >= 50 ? 'text-green-400' :
                  windowStats.winRate >= 40 ? 'text-yellow-400' : 'text-red-400'
                }`}>{windowStats.winRate.toFixed(1)}%</p>
                <p className="text-[10px] text-slate-500 font-mono">{windowStats.wins}W / {windowStats.losses}L</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Net P&amp;L</p>
                <p className={`text-lg lg:text-xl font-bold font-mono tabular-nums ${windowStats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {windowStats.totalPnl >= 0 ? '+' : ''}${windowStats.totalPnl.toFixed(2)}
                </p>
                <p className="text-[10px] text-slate-500 font-mono">avg ${windowStats.avgPnl.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Profit factor</p>
                <p className={`text-lg lg:text-xl font-bold font-mono tabular-nums ${
                  (windowStats.profitFactor ?? 0) >= 1.5 ? 'text-green-400' :
                  (windowStats.profitFactor ?? 0) >= 1 ? 'text-yellow-400' : 'text-red-400'
                }`}>{windowStats.profitFactor !== null ? windowStats.profitFactor.toFixed(2) : '—'}</p>
                <p className="text-[10px] text-slate-500">gross W / L</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Best / worst</p>
                <p className="text-base lg:text-lg font-bold font-mono tabular-nums text-green-400">
                  +${windowStats.bestTrade.toFixed(2)}
                </p>
                <p className="text-[11px] font-mono tabular-nums text-red-400">${windowStats.worstTrade.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Fees</p>
                <p className="text-lg lg:text-xl font-bold font-mono tabular-nums text-yellow-400">
                  ${windowStats.totalCommission.toFixed(2)}
                </p>
                <p className="text-[10px] text-slate-500 font-mono">net ${windowStats.netPnlAfterCommissions.toFixed(2)}</p>
              </div>
            </div>
          </Card>
        )}

        {/* ─── RISK METRICS STRIP ──────────────────────────────── */}
        <Card className="border-slate-800/60 bg-slate-900/40 p-3 lg:p-4">
          <h2 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3">Risk metrics</h2>
          <div className="grid grid-cols-3 gap-3 lg:gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">ROI</p>
              <p className={`text-xl lg:text-2xl font-bold font-mono tabular-nums ${roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {roi >= 0 ? '+' : ''}{roi.toFixed(2)}%
              </p>
              <p className="text-[10px] text-slate-500">on starting capital</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Sharpe</p>
              <p className={`text-xl lg:text-2xl font-bold font-mono tabular-nums ${
                sharpeRatio >= 1 ? 'text-green-400' :
                sharpeRatio >= 0 ? 'text-yellow-400' : 'text-red-400'
              }`}>{sharpeRatio.toFixed(2)}</p>
              <p className="text-[10px] text-slate-500">risk-adj returns</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Max drawdown</p>
              <p className="text-xl lg:text-2xl font-bold font-mono tabular-nums text-red-400">
                -{maxDrawdown.toFixed(2)}%
              </p>
              <p className="text-[10px] text-slate-500">peak to trough</p>
            </div>
          </div>
        </Card>

        {/* ─── P&L CHART ───────────────────────────────────────── */}
        <Card className="border-slate-800/60 bg-slate-900/40 p-3 lg:p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider">P&amp;L trajectory</h2>
            <div className="flex gap-1">
              {(['day', 'week', 'month', 'year'] as const).map(tf => (
                <Button
                  key={tf}
                  variant={timeframe === tf ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTimeframe(tf)}
                  className="h-7 text-[11px] px-2.5 capitalize"
                >
                  {tf === 'day' ? '24h' : tf === 'week' ? '7d' : tf === 'month' ? '30d' : '1y'}
                </Button>
              ))}
            </div>
          </div>
          {pnlChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={pnlChartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="period" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 6, fontSize: 12 }}
                  formatter={(v: any) => [`$${Number(v).toFixed(2)}`, 'P&L']}
                />
                <Area type="monotone" dataKey="pnl" stroke="#10b981" fill="url(#pnlGradient)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-xs text-slate-500">
              No trade data yet. Performance plots populate as positions close.
            </div>
          )}
        </Card>

        {/* ─── BEST / WORST TRADES ─────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card className="border-slate-800/60 bg-slate-900/40 p-3 lg:p-4">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-green-400" />
              Top winners
            </h2>
            {bestTrades.length > 0 ? (
              <div className="space-y-1">
                {bestTrades.map((t, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded border border-green-500/15 bg-green-500/5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white font-mono">{t.symbol}</p>
                      <p className="text-[10px] text-slate-500 font-mono">{t.date}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-green-400 font-mono tabular-nums">+${t.pnl.toFixed(2)}</p>
                      <p className="text-[10px] text-slate-400 font-mono tabular-nums">+{t.percentage.toFixed(2)}%</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-500">No winning trades yet</div>
            )}
          </Card>

          <Card className="border-slate-800/60 bg-slate-900/40 p-3 lg:p-4">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <TrendingDown className="w-3.5 h-3.5 text-red-400" />
              Top losers
            </h2>
            {worstTrades.length > 0 ? (
              <div className="space-y-1">
                {worstTrades.map((t, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded border border-red-500/15 bg-red-500/5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white font-mono">{t.symbol}</p>
                      <p className="text-[10px] text-slate-500 font-mono">{t.date}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-red-400 font-mono tabular-nums">${t.pnl.toFixed(2)}</p>
                      <p className="text-[10px] text-slate-400 font-mono tabular-nums">{t.percentage.toFixed(2)}%</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-500">No losing trades yet</div>
            )}
          </Card>
        </div>

        {/* ─── CLOSED-POSITION LEDGER ──────────────────────────── */}
        <Card className="border-slate-800/60 bg-slate-900/40 p-3 lg:p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider">Recent closed positions</h2>
            <Badge variant="outline" className="text-[10px] font-mono border-slate-700 text-slate-400">
              {closedPositions?.length ?? 0} total
            </Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-left">
                  <th className="py-2 pr-3 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Closed at</th>
                  <th className="py-2 pr-3 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Symbol</th>
                  <th className="py-2 pr-3 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Side</th>
                  <th className="py-2 pr-3 text-[10px] uppercase tracking-wider text-slate-400 font-semibold text-right">Qty</th>
                  <th className="py-2 pr-3 text-[10px] uppercase tracking-wider text-slate-400 font-semibold text-right">Entry</th>
                  <th className="py-2 pr-3 text-[10px] uppercase tracking-wider text-slate-400 font-semibold text-right">Exit</th>
                  <th className="py-2 pr-3 text-[10px] uppercase tracking-wider text-slate-400 font-semibold text-right">P&amp;L</th>
                  <th className="py-2 pl-3 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody>
                {closedPositions && closedPositions.length > 0 ? (
                  [...closedPositions]
                    .sort((a: any, b: any) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
                    .slice(0, 20)
                    .map((pos: any, idx: number) => {
                      const pnl = parseFloat(pos.realizedPnl || '0');
                      const ent = parseFloat(pos.entryPrice || '0');
                      const qty = parseFloat(pos.quantity || '0');
                      const cur = parseFloat(pos.currentPrice || '0');
                      const isLong = ['long', 'LONG', 'BUY'].includes(pos.side);
                      const dbExit = parseFloat(pos.exitPrice || '0');
                      const calcExit = qty > 0 ? (isLong ? ent + pnl / qty : ent - pnl / qty) : cur;
                      const exit = dbExit > 0 ? dbExit : (calcExit > 0 ? calcExit : (cur > 0 ? cur : ent));
                      return (
                        <tr key={idx} className="border-b border-slate-800/40 hover:bg-slate-800/30">
                          <td className="py-2 pr-3 text-slate-300 font-mono whitespace-nowrap">
                            {pos.exitTime
                              ? new Date(pos.exitTime).toLocaleString([], { hour12: false })
                              : (pos.updatedAt ? new Date(pos.updatedAt).toLocaleString([], { hour12: false }) : 'N/A')}
                          </td>
                          <td className="py-2 pr-3 font-semibold text-white font-mono">{pos.symbol}</td>
                          <td className="py-2 pr-3">
                            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                              isLong
                                ? 'text-green-400 border-green-500/40 bg-green-500/10'
                                : 'text-red-400 border-red-500/40 bg-red-500/10'
                            }`}>
                              {isLong ? 'LONG' : 'SHORT'}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-right text-slate-300 font-mono tabular-nums">{qty.toFixed(4)}</td>
                          <td className="py-2 pr-3 text-right text-slate-300 font-mono tabular-nums">${ent.toFixed(2)}</td>
                          <td className="py-2 pr-3 text-right text-slate-300 font-mono tabular-nums">${exit.toFixed(2)}</td>
                          <td className={`py-2 pr-3 text-right font-semibold font-mono tabular-nums ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                          </td>
                          <td className="py-2 pl-3 text-slate-400 max-w-[200px] truncate" title={pos.exitReason || 'N/A'}>
                            {pos.exitReason || 'N/A'}
                          </td>
                        </tr>
                      );
                    })
                ) : (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-xs text-slate-500">
                      No closed positions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
