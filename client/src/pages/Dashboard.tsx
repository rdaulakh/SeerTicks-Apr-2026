/**
 * SEER Dashboard — War Room (Phase 93.11)
 *
 * Phase 93.11 expanded the war room from a status-only view into the
 * primary institutional surface — equivalent in density to Bloomberg /
 * IBKR / Coinbase Pro. The previous build (93.7) had the right idea but
 * was almost chart-free; this one keeps the proven status bar + position
 * strip and layers on the data the operator actually needs:
 *
 *   Row 1: Status bar — engine, brain tick, equity, today P&L, open count, sync
 *   Row 2: Open positions strip (live WS prices)
 *   Row 3: Equity curve (2/3) + Symbol ticker w/ sparklines (1/3)
 *   Row 4: Agent heatmap (1/2) + Daily P&L bars (1/2)
 *   Row 5: Brain activity stream (2/3) + Recent closed trades (1/3)
 *   Row 6: WS / brain-mode / engine-ticks chips + perf summary card
 *
 * Layout collapses to a single column on mobile, two on tablet (md), full
 * grid from lg up. All numerical content uses tabular-style monospace so
 * digits line up. Polling intervals are intentionally varied — sub-second
 * channels (WS) stay on WS; semi-stale channels (closed trades, daily
 * P&L) refresh once a minute; the equity curve refreshes once a minute.
 *
 * Heavy queries: pnlChart.getDateWisePnl is reused by EquityCurvePanel
 * (90d window) and DailyPnLBars (14d window). tRPC dedups identical
 * inputs, but the two callers use different startDate values so they
 * issue separate requests — acceptable since pnlChart aggregates with
 * SQL GROUP BY (one fast scan per request).
 */

import { useEffect, useRef } from "react";
import {
  Activity, TrendingUp, TrendingDown, Zap, Brain,
  CheckCircle2, XCircle, ChevronRight, Cpu, Target, DollarSign,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useSocketIOMulti } from "@/hooks/useSocketIOMulti";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

import EquityCurvePanel from "@/components/dashboard/EquityCurvePanel";
import SymbolTickerStrip from "@/components/dashboard/SymbolTickerStrip";
import AgentHeatmap from "@/components/dashboard/AgentHeatmap";
import DailyPnLBars from "@/components/dashboard/DailyPnLBars";
import RecentTradesFeed from "@/components/dashboard/RecentTradesFeed";

// ─── Helpers ────────────────────────────────────────────────────────
function formatUSD(n: number, opts: { sign?: boolean; compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = opts.sign && n > 0 ? "+" : "";
  if (opts.compact && abs >= 1000) return `${sign}$${(n / 1000).toFixed(1)}k`;
  return `${sign}$${n.toFixed(2)}`;
}
function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function relTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s ago`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3600_000)}h ago`;
}
function decisionKindColor(kind: string): string {
  if (kind === "enter_long" || kind === "enter_short") return "text-cyan-300 bg-cyan-500/10 border-cyan-500/30";
  if (kind === "exit_full") return "text-orange-300 bg-orange-500/10 border-orange-500/30";
  if (kind === "take_partial") return "text-yellow-300 bg-yellow-500/10 border-yellow-500/30";
  if (kind === "tighten_stop") return "text-purple-300 bg-purple-500/10 border-purple-500/30";
  if (kind === "abstain") return "text-slate-500 bg-slate-500/5 border-slate-500/20";
  return "text-slate-400 bg-slate-700/30 border-slate-700/40"; // hold
}

// ─── Component ──────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const mountedRef = useRef(false);
  useEffect(() => { if (!mountedRef.current) { mountedRef.current = true; console.log("[Dashboard] War Room mounted"); } }, []);

  // ─── Data: Live WebSocket ─────────────────────────────────────────
  const { connected, engineStatus: wsEngineStatus, positions: wsPositions } = useSocketIOMulti(user?.id, true);

  // ─── Data: tRPC ───────────────────────────────────────────────────
  const { data: engineStatus } = trpc.seerMulti.getStatus.useQuery(undefined, {
    refetchInterval: 5000, enabled: !!user, staleTime: 2000,
  });
  const { data: openPositions } = trpc.seerMulti.getPositions.useQuery(undefined, {
    refetchInterval: 10000, enabled: !!user, staleTime: 5000,
  });
  const { data: windowStatsToday } = trpc.trading.getStatsByWindow.useQuery(
    { window: "today" }, { enabled: !!user, refetchInterval: 30000, staleTime: 15000 }
  );
  const { data: windowStats7d } = trpc.trading.getStatsByWindow.useQuery(
    { window: "7d" }, { enabled: !!user, refetchInterval: 60000, staleTime: 30000 }
  );
  const { data: reconciliation } = trpc.trading.getReconciliation.useQuery(undefined, {
    enabled: !!user, refetchInterval: 60000, staleTime: 30000,
  });
  const { data: brainActivity } = trpc.agentScorecard.getBrainActivity.useQuery(
    { windowMinutes: 10, limit: 25 },
    { enabled: !!user, refetchInterval: 5000, staleTime: 2000 }
  );

  // Prefer WS engine status when present (zero-latency); fall back to tRPC.
  const eng = wsEngineStatus || engineStatus;
  const isRunning = (eng as any)?.isRunning ?? (eng as any)?.running ?? false;
  const symbolStates: any[] = ((eng as any)?.symbolStates as any[]) || [];

  // ─── Derived ──────────────────────────────────────────────────────
  const livePositionsMap = new Map((wsPositions || []).map((p: any) => [String(p.id ?? p.positionId), p]));
  const positionsList = openPositions || [];
  const todayPnl = windowStatsToday?.totalPnl ?? 0;
  const todayWinRate = windowStatsToday?.winRate ?? 0;
  const todayTrades = windowStatsToday?.totalTrades ?? 0;
  const week7Pnl = windowStats7d?.totalPnl ?? 0;
  const week7WinRate = windowStats7d?.winRate ?? 0;
  const driftCritical = (reconciliation?.drifts ?? []).some((d: any) => d.severity === "critical");
  const driftWarn = (reconciliation?.drifts ?? []).some((d: any) => d.severity === "warn");
  const driftCount = (reconciliation?.drifts ?? []).filter((d: any) => d.severity !== "ok").length;
  const equityDisplay = Number(reconciliation?.binance?.totalMarginBalance ??
    reconciliation?.seer?.wallet?.equity ?? 0);

  const brainStatus = (brainActivity as any)?.status;
  const lastTickAgeMs = brainStatus?.ageMs;
  const tickHealthy = Number.isFinite(lastTickAgeMs) && lastTickAgeMs < 1000;

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="space-y-3 p-3 md:p-4 max-w-[1800px] mx-auto">
      {/* ════════════════════ ROW 1: STATUS BAR ════════════════════ */}
      <Card className="glass-card border-slate-800/50 p-3">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-center">
          {/* Engine status */}
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-2.5 h-2.5 rounded-full",
              isRunning ? "bg-green-400 animate-pulse" : "bg-red-500",
            )} />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Engine</p>
              <p className={cn("text-sm font-bold", isRunning ? "text-green-400" : "text-red-400")}>
                {isRunning ? "LIVE" : "STOPPED"}
              </p>
            </div>
          </div>

          {/* Brain heartbeat */}
          <div className="flex items-center gap-2">
            <Brain className={cn("w-4 h-4", tickHealthy ? "text-cyan-400" : "text-yellow-400")} />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Brain tick</p>
              <p className={cn("text-sm font-bold font-mono", tickHealthy ? "text-cyan-400" : "text-yellow-400")}
                title={brainStatus?.dryRun ? "DRY-RUN observing only" : "LIVE — execution authority"}>
                {brainStatus ? relTime(lastTickAgeMs ?? 0) : "—"}
              </p>
            </div>
          </div>

          {/* Equity */}
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Equity</p>
              <p className="text-sm font-bold font-mono text-white">
                {formatUSD(equityDisplay)}
              </p>
            </div>
          </div>

          {/* Today P&L */}
          <div className="flex items-center gap-2">
            {todayPnl >= 0 ? <TrendingUp className="w-4 h-4 text-green-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Today P&L</p>
              <p className={cn("text-sm font-bold font-mono", todayPnl >= 0 ? "text-green-400" : "text-red-400")}>
                {formatUSD(todayPnl, { sign: true })} <span className="text-[10px] text-slate-500">{todayTrades}t</span>
              </p>
            </div>
          </div>

          {/* Open positions */}
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-blue-400" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Open positions</p>
              <p className="text-sm font-bold text-white">{positionsList.length}</p>
            </div>
          </div>

          {/* Reconciliation */}
          <Link href="/performance" className="flex items-center gap-2 cursor-pointer hover:bg-slate-800/30 rounded p-1 -m-1 transition-colors">
            <div className={cn(
              "w-2.5 h-2.5 rounded-full",
              driftCritical ? "bg-red-400 animate-pulse" :
              driftWarn ? "bg-yellow-400" : "bg-green-400",
            )} />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Sync</p>
              <p className={cn("text-sm font-bold",
                driftCritical ? "text-red-400" :
                driftWarn ? "text-yellow-400" : "text-green-400"
              )}>
                {driftCount === 0 ? "IN SYNC" : `${driftCount} DRIFT`}
              </p>
            </div>
          </Link>
        </div>
      </Card>

      {/* ════════════════════ ROW 2: POSITION STRIP ════════════════════ */}
      <Card className="glass-card border-slate-800/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            Open Positions
            <span className="text-xs text-slate-500 normal-case">({positionsList.length})</span>
          </h2>
          <Link href="/positions">
            <Button variant="ghost" size="sm" className="text-xs text-slate-400">
              Details <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </div>
        {positionsList.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">No open positions — brain is hunting</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {positionsList.map((p: any) => {
              const live = livePositionsMap.get(String(p.id));
              const livePrice = live?.currentPrice ?? p.currentPrice ?? p.entryPrice ?? 0;
              const livePnL = live?.unrealizedPnL ?? p.unrealizedPnL ?? 0;
              const livePnLPct = live?.unrealizedPnLPercent ?? p.unrealizedPnLPercent ?? 0;
              const isLong = p.side === "long";
              const profit = livePnL > 0;
              return (
                <div key={p.id} className={cn(
                  "rounded-lg border p-3",
                  profit ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"
                )}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{p.symbol}</span>
                      <span className={cn(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                        isLong ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"
                      )}>{p.side}</span>
                    </div>
                    <span className={cn(
                      "text-sm font-bold font-mono",
                      profit ? "text-green-400" : "text-red-400"
                    )}>
                      {formatUSD(livePnL, { sign: true })} <span className="text-[10px]">{formatPct(livePnLPct)}</span>
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                    <div>
                      <p className="text-[10px] text-slate-500">Entry</p>
                      <p className="text-slate-200">{Number(p.entryPrice).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">Live</p>
                      <p className="text-cyan-300">{Number(livePrice).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">Qty</p>
                      <p className="text-slate-200">{Number(p.quantity).toFixed(4)}</p>
                    </div>
                  </div>
                  {(p.stopLoss || p.takeProfit) && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700/40 text-[10px] font-mono">
                      {p.stopLoss && (
                        <span className="text-red-400/80" title="Stop loss">SL {Number(p.stopLoss).toFixed(2)}</span>
                      )}
                      {p.takeProfit && (
                        <span className="text-green-400/80" title="Take profit">TP {Number(p.takeProfit).toFixed(2)}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ════════════════════ ROW 3: EQUITY CURVE + MARKETS ════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <EquityCurvePanel />
        </div>
        <div>
          <SymbolTickerStrip symbolStates={symbolStates} />
        </div>
      </div>

      {/* ════════════════════ ROW 4: AGENT HEATMAP + DAILY BARS ════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <AgentHeatmap symbolStates={symbolStates} />
        <DailyPnLBars />
      </div>

      {/* ════════════════════ ROW 5: BRAIN ACTIVITY + RECENT TRADES ════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Brain activity stream */}
        <Card className="lg:col-span-2 glass-card border-slate-800/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Brain className="w-4 h-4 text-cyan-400" />
              Brain Activity Stream
              <span className="text-xs text-slate-500 normal-case">(decisions · last 10 min)</span>
            </h2>
            <div className="flex items-center gap-3 text-[11px] text-slate-400">
              <span title="Live decisions">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 mr-1" />
                {brainActivity?.totals?.live ?? 0} live
              </span>
              <span title="Dry-run decisions">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-500 mr-1" />
                {brainActivity?.totals?.dry ?? 0} dry
              </span>
            </div>
          </div>
          {(!brainActivity || brainActivity.recent.length === 0) ? (
            <p className="text-sm text-slate-500 py-4 text-center">No brain decisions in window</p>
          ) : (
            <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
              {brainActivity.recent.slice(0, 25).map((d: any) => (
                <div key={d.id} className={cn(
                  "flex items-start gap-2 text-xs font-mono px-2 py-1.5 rounded border",
                  decisionKindColor(d.kind)
                )}>
                  <span className="text-[10px] text-slate-500 shrink-0 w-12">
                    {new Date(d.timestamp).toLocaleTimeString([], { hour12: false }).slice(0, 8)}
                  </span>
                  <span className="font-bold w-20 shrink-0 truncate">{d.symbol}</span>
                  <span className="uppercase text-[10px] font-bold w-20 shrink-0 truncate">{d.kind}</span>
                  <span className="text-slate-400 truncate flex-1" title={d.reason}>{d.reason}</span>
                  {Number(d.latencyUs) > 0 && (
                    <span className="text-[10px] text-slate-500 shrink-0">{Number(d.latencyUs)}µs</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent closed trades feed (different from brain decisions — these are outcomes) */}
        <RecentTradesFeed />
      </div>

      {/* ════════════════════ ROW 6: PERFORMANCE + CONNECTION CHIPS ════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Performance summary card */}
        <Card className="glass-card border-slate-800/50 p-3 md:col-span-2 lg:col-span-1">
          <h2 className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3 text-emerald-400" />
            Performance
          </h2>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Today</p>
              <p className={cn("font-bold font-mono", todayPnl >= 0 ? "text-green-400" : "text-red-400")}>
                {formatUSD(todayPnl, { sign: true })}
              </p>
              <p className="text-[10px] text-slate-500">{todayTrades}t · {todayWinRate.toFixed(0)}%</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">7d</p>
              <p className={cn("font-bold font-mono", week7Pnl >= 0 ? "text-green-400" : "text-red-400")}>
                {formatUSD(week7Pnl, { sign: true })}
              </p>
              <p className="text-[10px] text-slate-500">
                {windowStats7d?.totalTrades ?? 0}t · {week7WinRate.toFixed(0)}%
              </p>
            </div>
          </div>
          <Link href="/performance">
            <Button variant="outline" size="sm" className="w-full text-[10px] mt-2 h-6">
              Full performance <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </Card>

        {/* WebSocket */}
        <Card className="glass-card border-slate-800/50 p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {connected ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">WebSocket</p>
              <p className="text-xs font-bold text-white">{connected ? "Connected" : "Disconnected"}</p>
            </div>
          </div>
        </Card>

        {/* Brain mode */}
        <Card className="glass-card border-slate-800/50 p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-purple-400" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Brain mode</p>
              <p className="text-xs font-bold text-white">
                {brainStatus?.dryRun ? "DRY-RUN" : "LIVE"} · {(brainStatus?.tickMs ?? 0)}ms tick
              </p>
            </div>
          </div>
        </Card>

        {/* Engine ticks */}
        <Card className="glass-card border-slate-800/50 p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Engine ticks</p>
              <p className="text-xs font-bold font-mono text-white">
                {(eng as any)?.tickCount?.toLocaleString() ?? 0}
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
