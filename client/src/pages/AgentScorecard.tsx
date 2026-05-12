/**
 * AgentScorecard — Phase 82
 *
 * The "team review" surface the user explicitly asked for. Surfaces:
 *   - Per-agent scorecard: signal volume + accuracy + Brier + weight + health
 *   - Watchdog/manager team health (EngineHeartbeat, ProfitLockGuard, etc.)
 *   - Signed-$ P&L attribution per agent — top contributors vs bottlenecks
 *
 * Reads from agentScorecardRouter tRPC endpoints. All queries are protected
 * (require auth) and have placeholderData so the panels stay populated across
 * transient backend restarts.
 */

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend } from "recharts";
import { trpc } from "@/lib/trpc";
import {
  Trophy,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Heart,
  Shield,
  Activity,
  CheckCircle2,
  XCircle,
  CircleSlash,
  Brain,
  Zap,
  Play,
  Square,
  RotateCcw,
  Settings,
  Eye,
} from "lucide-react";

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

function fmtNum(n: number | null | undefined, digits = 3): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

const healthStyle: Record<string, string> = {
  excellent: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  good: "bg-green-500/15 text-green-300 border-green-500/30",
  fair: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  poor: "bg-red-500/15 text-red-300 border-red-500/30",
  no_data: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

const teamStatusIcon = (status: string) => {
  switch (status) {
    case "active":
      return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    case "halted":
      return <XCircle className="w-4 h-4 text-red-400" />;
    case "idle":
      return <CircleSlash className="w-4 h-4 text-yellow-400" />;
    default:
      return <AlertTriangle className="w-4 h-4 text-gray-400" />;
  }
};

export default function AgentScorecard() {
  const [windowHours, setWindowHours] = useState<number>(24);

  const { data: scorecard, isLoading: scorecardLoading } =
    trpc.agentScorecard.getAgentScorecard.useQuery(
      { windowHours },
      {
        refetchInterval: 15_000,
        placeholderData: (prev) => prev,
        retry: 3,
        staleTime: 10_000,
      },
    );

  const { data: summary } = trpc.agentScorecard.getTeamSummary.useQuery(
    { windowHours },
    {
      refetchInterval: 15_000,
      placeholderData: (prev) => prev,
      retry: 3,
      staleTime: 10_000,
    },
  );

  const { data: team } = trpc.agentScorecard.getTeamHealthStatus.useQuery(
    undefined,
    {
      refetchInterval: 15_000,
      placeholderData: (prev) => prev,
      retry: 3,
      staleTime: 10_000,
    },
  );

  const { data: pnlAttribution } =
    trpc.agentScorecard.getSignedPnlByAgent.useQuery(
      { windowHours, minTrades: 1 },
      {
        refetchInterval: 30_000,
        placeholderData: (prev) => prev,
        retry: 3,
        staleTime: 30_000,
      },
    );

  const { data: brainActivity } =
    trpc.agentScorecard.getBrainActivity.useQuery(
      { windowMinutes: Math.min(windowHours * 60, 1440), limit: 100 },
      {
        // Phase 90 — was 5s. Brain decisions update on trade events, not on
        // 5s ticks. 15s is plenty for an operator console.
        refetchInterval: 15_000,
        placeholderData: (prev) => prev,
        retry: 3,
        staleTime: 12_000,
      },
    );

  // ── Phase 85 — operator console: brain config, health, controls ──
  const utils = trpc.useUtils();
  const { data: brainCH, refetch: refetchBrainCH } =
    trpc.agentScorecard.getBrainConfigAndHealth.useQuery(undefined, {
      // Phase 90 — was 5s. Brain config rarely changes; this is fine at 30s.
      refetchInterval: 30_000,
      placeholderData: (prev) => prev,
    });
  const setBrainModeMut = trpc.agentScorecard.setBrainMode.useMutation({
    onSuccess: (d) => {
      refetchBrainCH();
      utils.agentScorecard.getBrainActivity.invalidate();
      const dryRun = (d as any)?.after?.dryRun;
      const running = (d as any)?.after?.running;
      toast.success(running
        ? `Brain ${dryRun ? 'DRY-RUN' : 'LIVE'} — execution ${dryRun ? 'observing' : 'authorized'}`
        : 'Brain stopped');
    },
    onError: (err) => toast.error(`Brain control failed: ${err.message}`),
  });
  const setBrainConfigMut = trpc.agentScorecard.setBrainConfig.useMutation({
    onSuccess: () => { refetchBrainCH(); toast.success('Brain config updated (hot-reloaded)'); },
    onError: (err) => toast.error(`Config update failed: ${err.message}`),
  });
  const setCandidateSymbolsMut = trpc.agentScorecard.setCandidateSymbols.useMutation({
    onSuccess: (d) => { refetchBrainCH(); toast.success(`Candidate symbols → ${(d as any).symbols?.join(', ')}`); },
    onError: (err) => toast.error(`Symbol update failed: ${err.message}`),
  });
  const setLiveEntriesMut = trpc.agentScorecard.setLiveEntriesEnabled.useMutation({
    onSuccess: (d) => { refetchBrainCH(); toast.success(`Live entries ${(d as any).enabled ? 'ENABLED — real money' : 'disabled'}`); },
    onError: (err) => toast.error(`Live-entries toggle failed: ${err.message}`),
  });

  // Drill-down modal: when operator clicks a decision row, show full sensorium.
  const [drillDecision, setDrillDecision] = useState<any | null>(null);
  // Config-editor staged values (so we don't refire on every keystroke).
  const [editConfig, setEditConfig] = useState<Record<string, string>>({});
  // Candidate symbols editor.
  const [symbolsText, setSymbolsText] = useState<string>("");
  // Phase 93.9 — Advanced operator controls toggle. User feedback: this is an
  // autonomous platform; the user shouldn't be tweaking knobs. All editable
  // controls (start/stop, dry-run, config patch, candidate symbols, bulk
  // actions) are hidden behind this toggle. Default OFF — page shows clean
  // read-only status; toggle ON when an operator needs to intervene.
  const [showAdvancedOps, setShowAdvancedOps] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('seer:show_advanced_ops') === '1';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('seer:show_advanced_ops', showAdvancedOps ? '1' : '0');
  }, [showAdvancedOps]);
  // Phase 88 — Sensorium-card drilldown: which sensation kind to inspect.
  // Phase 89 — extended to 'positions' (per-symbol position breakdown) and 'alpha'
  // (alpha library top/bottom patterns).
  const [drillSensorium, setDrillSensorium] = useState<null | 'market' | 'technical' | 'flow' | 'whale' | 'deriv' | 'agentVotes' | 'opportunity' | 'alpha' | 'positions'>(null);
  const { data: sensoriumPerSymbol } = trpc.agentScorecard.getSensoriumPerSymbol.useQuery(undefined, {
    // Phase 90 — was 5s. Modal-only; 10s is responsive enough.
    refetchInterval: 10_000,
    placeholderData: (prev) => prev,
    enabled: !!drillSensorium,
  });
  // Phase 88 — Brain vs Legacy P&L comparison
  const { data: bvl } = trpc.agentScorecard.getBrainVsLegacyPnl.useQuery(
    { windowHours: Math.max(24, windowHours) },
    { refetchInterval: 30_000, placeholderData: (prev) => prev },
  );
  // Phase 89 — Alpha library summary (live row count + recent additions)
  const { data: alphaLib } = trpc.agentScorecard.getAlphaLibrarySummary.useQuery(undefined, {
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
  // Phase 89 — Bulk action mutations
  const bulkActionMut = trpc.agentScorecard.bulkBrainAction.useMutation({
    onSuccess: (d) => {
      refetchBrainCH();
      utils.agentScorecard.getBrainActivity.invalidate();
      if (d.action === 'close_all_brain_positions') toast.success(`Closed ${(d as any).closed}/${(d as any).attempted} brain positions`);
      else if (d.action === 'pause_entries') toast.success(`Brain entries paused until ${new Date((d as any).pauseUntilMs).toLocaleTimeString()}`);
      else if (d.action === 'resume_entries') toast.success('Brain entries resumed');
    },
    onError: (err) => toast.error(`Bulk action failed: ${err.message}`),
  });

  return (
    <div className="min-h-screen bg-background text-foreground pt-16 lg:pt-20">
    <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 lg:py-6 max-w-7xl space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Trophy className="w-5 h-5 lg:w-6 lg:h-6 text-amber-400" />
            Agent Scorecard
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">
            Per-agent performance, watchdog status, signed-$ attribution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Phase 93.9 — autonomous-mode toggle. Off = clean read-only status. */}
          <Button
            size="sm"
            variant={showAdvancedOps ? "default" : "outline"}
            className={showAdvancedOps ? "h-8 text-xs bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25" : "h-8 text-xs border-slate-700 text-slate-400 hover:text-slate-200"}
            onClick={() => setShowAdvancedOps(v => !v)}
            title={showAdvancedOps ? "Hide operator controls — system runs autonomously" : "Show operator controls (start/stop, dry-run, config tuning)"}
          >
            {showAdvancedOps ? "Advanced ops" : "Autonomous"}
          </Button>
          <span className="text-[10px] uppercase tracking-wider text-slate-400 hidden sm:inline">Window</span>
          <Select value={String(windowHours)} onValueChange={(v) => setWindowHours(Number(v))}>
            <SelectTrigger className="w-24 h-8 text-xs bg-slate-900/60 border-slate-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1h</SelectItem>
              <SelectItem value="6">6h</SelectItem>
              <SelectItem value="24">24h</SelectItem>
              <SelectItem value="72">3d</SelectItem>
              <SelectItem value="168">7d</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 lg:gap-3">
        <Card className="p-3 bg-slate-900/40 border-slate-800/60">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Signals in window</div>
          <div className="text-xl lg:text-2xl font-bold text-foreground font-mono tabular-nums mt-0.5">{summary?.signals?.total ?? "—"}</div>
          <div className="text-[10px] text-slate-500 mt-0.5 font-mono tabular-nums">
            {summary?.signals?.distinctAgents ?? 0} agents firing
          </div>
        </Card>
        <Card className="p-3 bg-slate-900/40 border-slate-800/60">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Agents w/ accuracy</div>
          <div className="text-xl lg:text-2xl font-bold text-foreground font-mono tabular-nums mt-0.5">
            {summary?.accuracy?.agentsWithRecords ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 font-mono tabular-nums">
            {summary?.accuracy?.totalTrades ?? 0} trades evaluated
          </div>
        </Card>
        <Card className="p-3 bg-slate-900/40 border-slate-800/60">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Weighted accuracy</div>
          <div className="text-xl lg:text-2xl font-bold text-foreground font-mono tabular-nums mt-0.5">
            {fmtPct(summary?.accuracy?.weightedAccuracy ?? null)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">across all agents</div>
        </Card>
        <Card className="p-3 bg-slate-900/40 border-slate-800/60">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Engine heartbeat</div>
          <div className="text-xl lg:text-2xl font-bold mt-0.5 flex items-center gap-2">
            {summary?.watchdog?.haltActive ? (
              <>
                <XCircle className="w-4 h-4 text-red-400" /> <span className="text-red-400">Halted</span>
              </>
            ) : summary?.watchdog?.healthy ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" /> <span className="text-emerald-400">Active</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-yellow-400" /> <span className="text-yellow-400">Idle</span>
              </>
            )}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 truncate">
            {summary?.watchdog?.haltReason ?? "no halt"}
          </div>
        </Card>
      </div>

      {/* Phase 89 — Tab state persists in URL (?tab=brain). Refresh-safe. */}
      <Tabs
        value={(typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null) ?? 'brain'}
        onValueChange={(v) => {
          if (typeof window === 'undefined') return;
          const u = new URL(window.location.href);
          u.searchParams.set('tab', v);
          window.history.replaceState({}, '', u.toString());
        }}
        className="space-y-4">
        <TabsList className="bg-black/40 border border-white/10">
          <TabsTrigger value="brain">
            <Brain className="w-4 h-4 mr-1.5" /> Brain Activity
          </TabsTrigger>
          <TabsTrigger value="agents">
            <Activity className="w-4 h-4 mr-1.5" /> Per-Agent Scorecard
          </TabsTrigger>
          <TabsTrigger value="pnl">
            <TrendingUp className="w-4 h-4 mr-1.5" /> Signed P&L Attribution
          </TabsTrigger>
          <TabsTrigger value="team">
            <Shield className="w-4 h-4 mr-1.5" /> Team Health
          </TabsTrigger>
        </TabsList>

        {/* PHASE 84 — BRAIN ACTIVITY (Phase 85 console wrappers) */}
        <TabsContent value="brain" className="space-y-3">
          {/* Phase 93.9 — Brain control bar hidden behind Advanced Ops toggle.
              Autonomous mode shows ONLY a read-only status pill. */}
          {!showAdvancedOps && (
            <Card className="bg-slate-900/40 border-slate-800/60 p-3">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${brainCH?.status?.running ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                  <span className="text-slate-400 uppercase tracking-wider text-[10px]">Brain</span>
                  <strong className="text-slate-200">{brainCH?.status?.running ? (brainCH.status.dryRun ? 'OBSERVING (dry-run)' : 'LIVE — execution authority') : 'STOPPED'}</strong>
                </div>
                <div className="flex items-center gap-1.5 text-slate-400">
                  <span className="text-[10px] uppercase tracking-wider">Live entries</span>
                  <strong className={brainCH?.liveEntriesEnabled ? 'text-emerald-300' : 'text-slate-500'}>{brainCH?.liveEntriesEnabled ? 'ON' : 'OFF'}</strong>
                </div>
                <div className="text-slate-500 font-mono tabular-nums ml-auto">Tick {brainCH?.status?.tickMs ?? '—'}ms</div>
              </div>
            </Card>
          )}
          {showAdvancedOps && (
          <Card className="bg-black/40 border-white/10 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase text-gray-400 mr-2">Brain control:</span>
              <Button
                size="sm"
                variant="outline"
                className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                disabled={brainCH?.status?.running}
                onClick={() => setBrainModeMut.mutate({ command: 'start' })}
              >
                <Play className="w-3.5 h-3.5 mr-1.5" /> Start
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                disabled={!brainCH?.status?.running}
                onClick={() => setBrainModeMut.mutate({ command: 'stop' })}
              >
                <Square className="w-3.5 h-3.5 mr-1.5" /> Stop
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
                onClick={() => setBrainModeMut.mutate({ command: 'toggle_dry_run' })}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                {brainCH?.status?.dryRun ? 'Switch to LIVE' : 'Switch to Dry-run'}
              </Button>
              <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Live entries: <strong className="text-gray-200">{brainCH?.liveEntriesEnabled ? 'ON' : 'OFF'}</strong>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs text-gray-400 hover:text-gray-200"
                  onClick={() => setLiveEntriesMut.mutate({ enabled: !brainCH?.liveEntriesEnabled })}
                >
                  {brainCH?.liveEntriesEnabled ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </div>
          </Card>
          )}
          {/* end Advanced Ops — Brain control bar */}

          {/* Phase 85 — Sensorium health (Phase 88: clickable drilldown · Phase 89: + alpha card) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <button onClick={() => setDrillSensorium('agentVotes')} className="text-left">
              <Card className="p-3 bg-black/40 border-white/10 hover:border-cyan-500/40 transition cursor-pointer">
                <div className="text-[10px] uppercase text-gray-400">Agent votes</div>
                <div className="text-xl font-bold mt-1 text-cyan-300">
                  {brainCH?.sensoriumHealth?.agentVotes ?? 0}
                </div>
                <div className="text-[10px] text-gray-500">symbols · click for detail</div>
              </Card>
            </button>
            <button onClick={() => setDrillSensorium('market')} className="text-left">
              <Card className="p-3 bg-black/40 border-white/10 hover:border-cyan-500/40 transition cursor-pointer">
                <div className="text-[10px] uppercase text-gray-400">Market</div>
                <div className="text-xl font-bold mt-1">{brainCH?.sensoriumHealth?.market ?? 0}</div>
                <div className="text-[10px] text-gray-500">tick streams · click</div>
              </Card>
            </button>
            <button onClick={() => setDrillSensorium('technical')} className="text-left">
              <Card className="p-3 bg-black/40 border-white/10 hover:border-cyan-500/40 transition cursor-pointer">
                <div className="text-[10px] uppercase text-gray-400">Technical</div>
                <div className="text-xl font-bold mt-1">{brainCH?.sensoriumHealth?.technical ?? 0}</div>
                <div className="text-[10px] text-gray-500">syms · click</div>
              </Card>
            </button>
            <button onClick={() => setDrillSensorium('flow')} className="text-left">
              <Card className="p-3 bg-black/40 border-white/10 hover:border-cyan-500/40 transition cursor-pointer">
                <div className="text-[10px] uppercase text-gray-400">Flow / Whale / Deriv</div>
                <div className="text-xl font-bold mt-1">
                  {(brainCH?.sensoriumHealth?.flow ?? 0)}/{(brainCH?.sensoriumHealth?.whale ?? 0)}/{(brainCH?.sensoriumHealth?.deriv ?? 0)}
                </div>
                <div className="text-[10px] text-gray-500">syms heard · click</div>
              </Card>
            </button>
            {/* Phase 89 — Positions card is now clickable too */}
            <button onClick={() => setDrillSensorium('positions' as any)} className="text-left">
              <Card className="p-3 bg-black/40 border-white/10 hover:border-blue-500/40 transition cursor-pointer">
                <div className="text-[10px] uppercase text-gray-400">Positions</div>
                <div className="text-xl font-bold mt-1">{brainCH?.sensoriumHealth?.positions ?? 0}</div>
                <div className="text-[10px] text-gray-500">tracked · click</div>
              </Card>
            </button>
            <button onClick={() => setDrillSensorium('opportunity')} className="text-left">
              <Card className="p-3 bg-black/40 border-white/10 hover:border-amber-500/40 transition cursor-pointer">
                <div className="text-[10px] uppercase text-gray-400">Opportunities</div>
                <div className="text-xl font-bold mt-1 text-amber-300">{brainCH?.sensoriumHealth?.opportunities ?? 0}</div>
                <div className="text-[10px] text-gray-500">scores · click</div>
              </Card>
            </button>
            {/* Phase 89 — Alpha library: shows pattern memory accumulation */}
            <button onClick={() => setDrillSensorium('alpha' as any)} className="text-left">
              <Card className="p-3 bg-black/40 border-white/10 hover:border-emerald-500/40 transition cursor-pointer">
                <div className="text-[10px] uppercase text-gray-400">Alpha library</div>
                <div className="text-xl font-bold mt-1 text-emerald-300">
                  {alphaLib?.totalActive ?? 0}
                  {alphaLib && alphaLib.totalDecayed > 0 && (
                    <span className="text-xs text-red-400 ml-1">/{alphaLib.totalDecayed} decayed</span>
                  )}
                </div>
                <div className="text-[10px] text-gray-500">
                  patterns · {alphaLib?.recentlyAdded ?? 0} new 24h
                </div>
              </Card>
            </button>
          </div>

          {/* Phase 89 — Bulk action bar (Phase 93.9: hidden in autonomous mode) */}
          {showAdvancedOps && (
          <Card className="bg-black/40 border-white/10 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase text-gray-400 mr-1">Bulk:</span>
              <Button
                size="sm"
                variant="outline"
                className="border-red-500/40 text-red-300 hover:bg-red-500/10 h-7 text-xs"
                disabled={bulkActionMut.isPending}
                onClick={() => {
                  if (confirm('Close ALL brain-opened positions now?')) {
                    bulkActionMut.mutate({ action: 'close_all_brain_positions' });
                  }
                }}
              >
                <Square className="w-3 h-3 mr-1" /> Close all brain positions
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10 h-7 text-xs"
                disabled={bulkActionMut.isPending}
                onClick={() => bulkActionMut.mutate({ action: 'pause_entries', pauseMinutes: 30 })}
              >
                Pause entries 30 min
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 h-7 text-xs"
                disabled={bulkActionMut.isPending}
                onClick={() => bulkActionMut.mutate({ action: 'resume_entries' })}
              >
                Resume entries
              </Button>
              <span className="ml-auto text-[10px] text-gray-500">
                Bulk actions affect brain_v2_entry only · legacy untouched
              </span>
            </div>
          </Card>
          )}

          {/* Phase 88 — Sensorium drilldown modal */}
          <Dialog open={!!drillSensorium} onOpenChange={(o) => !o && setDrillSensorium(null)}>
            <DialogContent className="max-w-3xl bg-black/95 border-white/10">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-cyan-400" />
                  Sensorium · {drillSensorium}
                </DialogTitle>
              </DialogHeader>
              <SensoriumDrill kind={drillSensorium} rows={sensoriumPerSymbol ?? []} />
            </DialogContent>
          </Dialog>

          {/* Brain status header */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4 bg-black/40 border-white/10">
              <div className="text-xs uppercase text-gray-400">Brain status</div>
              <div className="text-2xl font-bold mt-1 flex items-center gap-2">
                {brainActivity?.status?.running ? (
                  <>
                    <Zap className="w-5 h-5 text-emerald-400" />
                    {brainActivity.status.dryRun ? 'Observing' : 'LIVE'}
                  </>
                ) : (
                  <>
                    <CircleSlash className="w-5 h-5 text-gray-400" /> Stopped
                  </>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {brainActivity?.status?.tickCount ?? 0} ticks @ {brainActivity?.status?.tickMs ?? 0}ms
              </div>
              {/* Phase 87 — heartbeat. ageMs > 5×tickMs = brain hung. */}
              {brainActivity?.status?.running && (brainActivity.status as any).ageMs !== null && (
                <div className="text-[10px] mt-0.5">
                  {(() => {
                    const age = (brainActivity.status as any).ageMs as number;
                    const tickMs = brainActivity.status.tickMs;
                    const stalled = age > tickMs * 5;
                    return (
                      <span className={stalled ? 'text-amber-400 font-semibold font-mono tabular-nums' : 'text-emerald-400 font-mono tabular-nums'}>
                        last tick {age < 1000 ? `${age}ms` : `${(age/1000).toFixed(1)}s`} ago{stalled ? ' STALLED' : ''}
                      </span>
                    );
                  })()}
                </div>
              )}
            </Card>
            <Card className="p-4 bg-black/40 border-white/10">
              <div className="text-xs uppercase text-gray-400">Live decisions</div>
              <div className="text-2xl font-bold mt-1 text-emerald-300">{brainActivity?.totals?.live ?? 0}</div>
              <div className="text-xs text-gray-500 mt-1">in {windowHours}h</div>
            </Card>
            <Card className="p-4 bg-black/40 border-white/10">
              <div className="text-xs uppercase text-gray-400">Dry-run decisions</div>
              <div className="text-2xl font-bold mt-1 text-gray-300">{brainActivity?.totals?.dry ?? 0}</div>
              <div className="text-xs text-gray-500 mt-1">recorded only</div>
            </Card>
            <Card className="p-4 bg-black/40 border-white/10">
              <div className="text-xs uppercase text-gray-400">Pipeline coverage</div>
              <div className="text-2xl font-bold mt-1">{(brainActivity?.breakdown ?? []).length}</div>
              <div className="text-xs text-gray-500 mt-1">distinct steps fired</div>
            </Card>
          </div>

          {/* Breakdown by pipeline step */}
          <Card className="bg-black/40 border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <Brain className="w-4 h-4 text-cyan-400" />
              <h2 className="font-semibold">Pipeline step breakdown</h2>
              <Badge variant="outline" className="border-white/20 ml-auto">
                {(brainActivity?.breakdown ?? []).reduce((s: number, x: any) => s + x.n, 0)} total
              </Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr className="text-left text-xs uppercase text-gray-400">
                    <th className="px-4 py-2">Action</th>
                    <th className="px-4 py-2">Pipeline step</th>
                    <th className="px-4 py-2 text-right">Count</th>
                    <th className="px-4 py-2 text-right">Avg latency</th>
                  </tr>
                </thead>
                <tbody>
                  {!brainActivity || brainActivity.breakdown.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-gray-400" colSpan={4}>
                        No brain activity in window.
                      </td>
                    </tr>
                  ) : (
                    brainActivity.breakdown.map((b: any, i: number) => (
                      <tr key={`${b.kind}-${b.pipelineStep}-${i}`} className="border-t border-white/5 hover:bg-white/5">
                        <td className="px-4 py-2">
                          <Badge className={
                            b.kind === 'exit_full' ? 'bg-red-500/15 text-red-300 border-red-500/30'
                            : b.kind === 'tighten_stop' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                            : b.kind === 'take_partial' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                            : b.kind === 'enter_long' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : b.kind === 'enter_short' ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                            : b.kind === 'abstain' ? 'bg-gray-500/15 text-gray-400 border-gray-500/30'
                            : 'bg-gray-500/15 text-gray-300 border-gray-500/30'
                          }>{b.kind}</Badge>
                        </td>
                        <td className="px-4 py-2 text-gray-300 text-xs font-mono">{b.pipelineStep ?? '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{b.n}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-400">{b.avgLatencyUs}µs</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Phase 85 — Config + Symbols editor */}
          {/* Phase 93.9 — Config editor + symbol editor hidden in autonomous mode. */}
          {showAdvancedOps && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="bg-black/40 border-white/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Settings className="w-4 h-4 text-cyan-400" />
                <h3 className="font-semibold text-sm">Brain config (hot-reload)</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { key: 'minOpportunityScore', label: 'Min opp score', step: 0.05, min: 0, max: 1, hint: '0–1. Default 0.50. Higher = more selective entries.' },
                  { key: 'minConfluenceCount', label: 'Min confluence', step: 1, min: 1, max: 33, hint: '1–33. Default 2. # of agents that must agree on direction.' },
                  { key: 'entrySizeEquityFraction', label: 'Entry equity %', step: 0.05, min: 0, max: 1, hint: '0–1. Default 0.10 (10%). Max % of wallet per entry before Kelly.' },
                  { key: 'kellyFraction', label: 'Kelly fraction', step: 0.05, min: 0, max: 1, hint: '0–1. Default 0.25 (quarter-Kelly). Lower = more conservative sizing.' },
                  { key: 'defaultStopLossPercent', label: 'Stop loss %', step: 0.1, min: 0.1, max: 10, hint: '0.1–10. Default 1.2%. Hard-stop distance from entry.' },
                  { key: 'defaultTakeProfitPercent', label: 'Take profit %', step: 0.1, min: 0.1, max: 20, hint: '0.1–20. Default 1.0%. Take-profit target from entry.' },
                ].map(({ key, label, step, min, max, hint }) => (
                  <label key={key} className="flex flex-col gap-1" title={hint}>
                    <span className="text-gray-400 flex items-center gap-1">
                      {label}
                      <span className="text-gray-600 text-[9px]">[{min}–{max}]</span>
                    </span>
                    <input
                      type="number"
                      step={step}
                      min={min}
                      max={max}
                      defaultValue={brainCH?.config?.[key] ?? ''}
                      onChange={(e) => setEditConfig((s) => ({ ...s, [key]: e.target.value }))}
                      className="bg-black/60 border border-white/10 rounded px-2 py-1 text-gray-200 text-xs font-mono"
                    />
                    <span className="text-[9px] text-gray-500 truncate">{hint}</span>
                  </label>
                ))}
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
                  disabled={Object.keys(editConfig).length === 0 || setBrainConfigMut.isPending}
                  onClick={() => {
                    const numericPatch: Record<string, number> = {};
                    for (const [k, v] of Object.entries(editConfig)) {
                      const n = Number(v);
                      if (Number.isFinite(n)) numericPatch[k] = n;
                    }
                    setBrainConfigMut.mutate(numericPatch as any, { onSuccess: () => setEditConfig({}) });
                  }}
                >
                  Apply changes
                </Button>
              </div>
            </Card>

            <Card className="bg-black/40 border-white/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-4 h-4 text-amber-400" />
                <h3 className="font-semibold text-sm">Candidate symbols</h3>
              </div>
              <div className="text-xs text-gray-400 mb-2">
                Brain hunts for entries on these symbols. Comma-separated, e.g. <code className="text-gray-300">BTC-USD, ETH-USD, SOL-USD</code>
              </div>
              <textarea
                rows={3}
                defaultValue={(brainCH?.candidateSymbols ?? []).join(', ')}
                onChange={(e) => setSymbolsText(e.target.value)}
                className="w-full bg-black/60 border border-white/10 rounded px-2 py-1.5 text-gray-200 text-xs font-mono"
                placeholder="BTC-USD, ETH-USD, SOL-USD"
              />
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[10px] text-gray-500">Current: {(brainCH?.candidateSymbols ?? []).length} syms</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                  disabled={!symbolsText.trim() || setCandidateSymbolsMut.isPending}
                  onClick={() => {
                    const syms = symbolsText.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
                    if (syms.length === 0) return;
                    // Server validates via z.enum — invalid symbols will TRPC-error
                    // and the toast onError handler surfaces it.
                    setCandidateSymbolsMut.mutate({ symbols: syms as any });
                  }}
                >
                  Update symbols
                </Button>
              </div>
            </Card>
          </div>
          )}
          {/* end Advanced Ops — Config + Candidate symbols editors */}

          {/* Phase 88 — Brain vs Legacy P&L over time */}
          <Card className="bg-black/40 border-white/10 p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-cyan-400" />
                <h3 className="font-semibold text-sm">Brain vs Legacy P&L</h3>
                <Badge variant="outline" className="border-white/20 text-[10px]">last {Math.max(24, windowHours)}h</Badge>
                {/* Phase 89 — call out low statistical significance */}
                {bvl?.stats && Math.min(bvl.stats.brain.trades, bvl.stats.legacy.trades) < 5 && (
                  <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px]">
                    Low N &mdash; not yet statistically significant
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                {bvl?.stats?.brain && (
                  <span className="text-cyan-300 font-mono tabular-nums">
                    brain: {bvl.stats.brain.trades} trades · {fmtPct(bvl.stats.brain.winRate)} · <strong>{fmtUsd(bvl.stats.brain.totalPnl)}</strong>
                  </span>
                )}
                {bvl?.stats?.legacy && (
                  <span className="text-slate-300 font-mono tabular-nums">
                    legacy: {bvl.stats.legacy.trades} trades · {fmtPct(bvl.stats.legacy.winRate)} · <strong>{fmtUsd(bvl.stats.legacy.totalPnl)}</strong>
                  </span>
                )}
              </div>
            </div>
            {bvl && (bvl.brain.length > 0 || bvl.legacy.length > 0) ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                    <XAxis
                      dataKey="hour"
                      type="category"
                      allowDuplicatedCategory={false}
                      tick={{ fontSize: 10, fill: '#9CA3AF' }}
                      tickFormatter={(v: string) => v.slice(5, 13)}
                    />
                    <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
                    <RTooltip
                      contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 11 }}
                      formatter={(v: number) => [`$${v.toFixed(2)}`, undefined]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line data={bvl.brain} type="monotone" dataKey="cumPnl" name="Brain (cum)" stroke="#06b6d4" strokeWidth={2} dot={false} />
                    <Line data={bvl.legacy} type="monotone" dataKey="cumPnl" name="Legacy (cum)" stroke="#9CA3AF" strokeWidth={2} strokeDasharray="4 2" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-24 flex items-center justify-center text-xs text-gray-400">
                No closed trades in window yet — chart will populate as positions close.
              </div>
            )}
          </Card>

          {/* Recent decision stream (Phase 85 — rows are clickable for sensorium drill-down) */}
          <Card className="bg-black/40 border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <h2 className="font-semibold">Decision stream (live)</h2>
              <Badge variant="outline" className="border-white/20 ml-auto">
                {brainActivity?.recent?.length ?? 0} entries · click for sensorium
              </Badge>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {!brainActivity || brainActivity.recent.length === 0 ? (
                <div className="px-4 py-6 text-center text-gray-400 text-sm">No recent decisions.</div>
              ) : (
                <div className="divide-y divide-white/5">
                  {brainActivity.recent.map((d: any) => {
                    // Phase 86 — visual distinction for vetoed abstains
                    const isVeto = d.pipelineStep === 'should_enter:veto_active' || d.pipelineStep === 'should_enter:macro_veto';
                    return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDrillDecision(d)}
                      className="w-full text-left px-4 py-2 text-xs hover:bg-white/5 transition"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 font-mono">{new Date(d.timestamp).toLocaleTimeString()}</span>
                        <Badge className={
                          d.kind === 'exit_full' ? 'bg-red-500/15 text-red-300 border-red-500/30'
                          : d.kind === 'tighten_stop' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                          : d.kind === 'enter_long' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : d.kind === 'enter_short' ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                          : isVeto ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                          : d.kind === 'abstain' ? 'bg-gray-500/15 text-gray-400 border-gray-500/30'
                          : 'bg-gray-500/15 text-gray-300 border-gray-500/30'
                        }>{isVeto ? 'VETO' : d.kind}</Badge>
                        <span className="text-gray-300 font-medium">{d.symbol}</span>
                        <span className="text-gray-500">·</span>
                        <span className="font-mono text-gray-400">{d.pipelineStep}</span>
                        {d.isDryRun && <Badge className="bg-gray-500/15 text-gray-400 border-gray-500/30 text-[10px]">DRY</Badge>}
                        <Eye className="w-3 h-3 ml-auto text-gray-500" />
                        <span className="text-gray-500">{d.latencyUs}µs</span>
                      </div>
                      <div className="text-gray-400 mt-0.5 pl-12">{d.reason}</div>
                    </button>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          {/* Phase 85 — Drill-down modal: full sensorium snapshot for the clicked decision */}
          <Dialog open={!!drillDecision} onOpenChange={(o) => !o && setDrillDecision(null)}>
            <DialogContent className="max-w-3xl bg-black/95 border-white/10">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-cyan-400" />
                  Brain decision · {drillDecision?.symbol} · {drillDecision?.kind}
                </DialogTitle>
              </DialogHeader>
              <BrainDecisionDrill positionId={drillDecision?.positionId} decision={drillDecision} />
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* PER-AGENT SCORECARD */}
        <TabsContent value="agents" className="space-y-3">
          <Card className="bg-black/40 border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Heart className="w-4 h-4 text-emerald-400" />
                <h2 className="font-semibold">Per-Agent Performance</h2>
              </div>
              <Badge variant="outline" className="border-white/20">
                {scorecard?.length ?? 0} agents
              </Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr className="text-left text-xs uppercase text-gray-400">
                    <th className="px-4 py-2">Agent</th>
                    <th className="px-4 py-2 text-center">Health</th>
                    <th className="px-4 py-2 text-right">Signals</th>
                    <th className="px-4 py-2 text-center">Vote breakdown</th>
                    <th className="px-4 py-2 text-right">Avg conf</th>
                    <th className="px-4 py-2 text-right">Accuracy</th>
                    <th className="px-4 py-2 text-right">Trades</th>
                    <th className="px-4 py-2 text-right">Brier</th>
                    <th className="px-4 py-2 text-right">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {scorecardLoading && !scorecard ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-gray-400" colSpan={9}>
                        Loading agent scorecard…
                      </td>
                    </tr>
                  ) : !scorecard || scorecard.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-gray-400" colSpan={9}>
                        No agent activity in the selected window.
                      </td>
                    </tr>
                  ) : (
                    scorecard.map((row: any) => (
                      <tr
                        key={row.agentName}
                        className="border-t border-white/5 hover:bg-white/5"
                      >
                        <td className="px-4 py-2 font-medium">{row.agentName}</td>
                        <td className="px-4 py-2 text-center">
                          <Badge className={healthStyle[row.health] ?? healthStyle.no_data}>
                            {row.health}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {row.signalsInWindow}
                        </td>
                        <td className="px-4 py-2 text-center text-xs text-gray-300">
                          <span className="text-emerald-400">
                            ▲{row.signalBreakdown?.bullish ?? 0}
                          </span>{" "}
                          <span className="text-red-400">
                            ▼{row.signalBreakdown?.bearish ?? 0}
                          </span>{" "}
                          <span className="text-gray-400">
                            ◆{row.signalBreakdown?.neutral ?? 0}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {fmtPct(row.avgConfidence)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {row.accuracy === null ? "—" : fmtPct(row.accuracy)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-300">
                          {row.totalTrades}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-300">
                          {fmtNum(row.brierScore)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {fmtNum(row.currentWeight, 2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* SIGNED $ P&L ATTRIBUTION */}
        <TabsContent value="pnl" className="space-y-3">
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="bg-black/40 border-white/10 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <h2 className="font-semibold">Top Contributors</h2>
              </div>
              <div className="divide-y divide-white/5">
                {(pnlAttribution?.topContributors ?? []).length === 0 ? (
                  <div className="px-4 py-6 text-center text-gray-400 text-sm">
                    No closed trades in window yet — attribution populates as
                    positions close.
                  </div>
                ) : (
                  pnlAttribution?.topContributors?.map((a: any) => (
                    <div key={a.agentName} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium">{a.agentName}</div>
                        <div className="text-xs text-gray-400">
                          {a.tradeCount} trades · {fmtPct(a.accuracy)} accuracy · avg
                          conf {fmtPct(a.avgConfidence)}
                        </div>
                      </div>
                      <div
                        className={`tabular-nums font-bold ${
                          a.netContribution >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {fmtUsd(a.netContribution)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="bg-black/40 border-white/10 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-400" />
                <h2 className="font-semibold">P&L Bottlenecks</h2>
              </div>
              <div className="divide-y divide-white/5">
                {(pnlAttribution?.bottlenecks ?? []).length === 0 ? (
                  <div className="px-4 py-6 text-center text-gray-400 text-sm">
                    Nothing to flag yet.
                  </div>
                ) : (
                  pnlAttribution?.bottlenecks?.map((a: any) => (
                    <div key={a.agentName} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium">{a.agentName}</div>
                        <div className="text-xs text-gray-400">
                          {a.tradeCount} trades · {fmtPct(a.accuracy)} accuracy ·
                          worst {fmtUsd(a.maxLoss)}
                        </div>
                      </div>
                      <div
                        className={`tabular-nums font-bold ${
                          a.netContribution >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {fmtUsd(a.netContribution)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>

          <Card className="bg-black/40 border-white/10 p-4">
            <div className="flex items-start gap-3">
              <Minus className="w-4 h-4 text-gray-400 mt-0.5" />
              <div className="text-xs text-gray-400 leading-relaxed">
                <strong>Attribution formula:</strong>{" "}
                <code className="text-gray-300">contribution = alignment × confidence × pnlAfterCosts</code>
                . Agent votes <em>with</em> winning side → positive; votes{" "}
                <em>against</em> → negative. Roll-up tells you each agent's marginal
                dollar impact on the book. Populates as trades close (currently{" "}
                {pnlAttribution?.totalTrades ?? 0} closed in window).
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* TEAM HEALTH — watchdogs / managers */}
        <TabsContent value="team" className="space-y-3">
          <Card className="bg-black/40 border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-400" />
              <h2 className="font-semibold">Watchdog & Manager Status</h2>
            </div>
            <div className="divide-y divide-white/5">
              {(team ?? []).length === 0 ? (
                <div className="px-4 py-6 text-center text-gray-400 text-sm">
                  Loading team status…
                </div>
              ) : (
                team?.map((m: any) => (
                  <div key={m.name} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {teamStatusIcon(m.status)}
                        <span className="font-medium">{m.name}</span>
                        <Badge
                          className={
                            m.status === "active"
                              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                              : m.status === "halted"
                              ? "bg-red-500/15 text-red-300 border-red-500/30"
                              : m.status === "idle"
                              ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/30"
                              : "bg-gray-500/15 text-gray-400 border-gray-500/30"
                          }
                        >
                          {m.status}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-xs text-gray-400 mb-2">{m.role}</div>
                    <pre className="text-xs text-gray-300 bg-black/40 rounded p-2 overflow-x-auto border border-white/5">
                      {JSON.stringify(m.details, null, 2)}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
    </div>
  );
}

// Phase 88 — Sensorium per-symbol drilldown panel. Operator clicks a health
// card; this lists each symbol's freshness + key data for the chosen sensation.
function SensoriumDrill({ kind, rows }: { kind: string | null; rows: any[] }) {
  if (!kind) return null;

  // Phase 89 — Alpha drill renders the library top/bottom from a different
  // data source than the per-symbol sensation rows.
  if (kind === 'alpha') return <AlphaLibraryDrill />;

  if (rows.length === 0) {
    return <div className="text-sm text-gray-400">Loading per-symbol detail…</div>;
  }

  // Phase 89 — Positions drill uses the same row shape but shows occupancy
  // + technical context. We just show the same table emphasizing the
  // 'occupied' flag.
  if (kind === 'positions') {
    const occupied = rows.filter((r) => r.occupied);
    if (occupied.length === 0) {
      return <div className="text-sm text-gray-400">No open positions at the moment.</div>;
    }
    return (
      <div className="space-y-2">
        <div className="text-xs text-gray-400">{occupied.length} occupied symbol(s)</div>
        <div className="bg-black/60 rounded p-2 border border-white/5">
          {occupied.map((r) => (
            <div key={r.symbol} className="flex items-center gap-2 text-[11px] py-1 border-b border-white/5 last:border-0">
              <span className="font-mono text-gray-300 w-20">{r.symbol}</span>
              <Badge className="bg-blue-500/15 text-blue-300 border-blue-500/30 text-[10px]">held</Badge>
              <span className="text-gray-400">mid ${(r.market?.midPrice ?? 0).toFixed(2)}</span>
              <span className="text-gray-500">·</span>
              <span className="text-gray-400">RSI {(r.technical?.rsi ?? 0).toFixed(1)}</span>
              <span className="text-gray-500">·</span>
              <span className="text-gray-400">votes ↑{r.agentVotes?.longCount ?? 0} ↓{r.agentVotes?.shortCount ?? 0}</span>
              {r.agentVotes?.vetoActive && <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[9px]">VETO</Badge>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const ageLabel = (ms: number | undefined): { text: string; cls: string } => {
    if (ms === undefined) return { text: '—', cls: 'text-gray-500' };
    if (ms < 5_000) return { text: `${(ms / 1000).toFixed(1)}s`, cls: 'text-emerald-400' };
    if (ms < 30_000) return { text: `${(ms / 1000).toFixed(1)}s`, cls: 'text-amber-400' };
    return { text: `${(ms / 1000).toFixed(0)}s STALE`, cls: 'text-red-400 font-bold' };
  };

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-400">
        {rows.length} symbol{rows.length !== 1 ? 's' : ''} · {kind} sensation
      </div>
      <div className="max-h-96 overflow-y-auto bg-black/60 rounded border border-white/5">
        <table className="w-full text-xs">
          <thead className="bg-white/5 sticky top-0">
            <tr className="text-left text-[10px] uppercase text-gray-400">
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Pos?</th>
              <th className="px-3 py-2">Fresh</th>
              <th className="px-3 py-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = r[kind] ?? {};
              const age = s.present ? ageLabel(s.stalenessMs) : { text: 'no data', cls: 'text-red-500' };
              let detail = '—';
              if (s.present) {
                if (kind === 'market') detail = `mid=$${(s.midPrice ?? 0).toFixed(2)}`;
                else if (kind === 'technical') detail = `RSI=${(s.rsi ?? 0).toFixed(1)} · ema ${s.emaTrend ?? '?'}`;
                else if (kind === 'flow') detail = `imb5s=${(s.takerImb5s ?? 0).toFixed(2)}`;
                else if (kind === 'whale') detail = `netFlow=$${((s.netFlow ?? 0) / 1000).toFixed(0)}k`;
                else if (kind === 'deriv') detail = `funding=${(s.funding ?? 0).toFixed(4)} · OIΔ=${(s.oiDelta ?? 0).toFixed(2)}`;
                else if (kind === 'agentVotes') detail = `↑${s.longCount} ↓${s.shortCount} •${s.neutralCount}${s.vetoActive ? ' VETO' : ''}`;
                else if (kind === 'opportunity') detail = `${s.direction} · score ${(s.score ?? 0).toFixed(2)} · ${s.confluence ?? 0} agree`;
                else if (kind === 'alpha') detail = `${s.activePatternCount} active · ${s.decayedPatternCount} decayed · winRate ${((s.weightedWinRate ?? 0) * 100).toFixed(0)}%`;
              }
              return (
                <tr key={r.symbol} className="border-t border-white/5">
                  <td className="px-3 py-1.5 font-mono text-gray-300">{r.symbol}</td>
                  <td className="px-3 py-1.5">{r.occupied ? <Badge className="bg-blue-500/15 text-blue-300 border-blue-500/30 text-[10px]">held</Badge> : <span className="text-gray-500">·</span>}</td>
                  <td className={`px-3 py-1.5 ${age.cls}`}>{age.text}</td>
                  <td className="px-3 py-1.5 text-gray-300">{detail}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Phase 89 — Alpha library drilldown. Shows top performers + decay
// candidates from winningPatterns, so the operator can see what the brain
// has learned.
function AlphaLibraryDrill() {
  const { data: lib } = trpc.agentScorecard.getAlphaLibrarySummary.useQuery(undefined, {
    refetchInterval: 10_000,
    placeholderData: (prev) => prev,
  });
  if (!lib) return <div className="text-sm text-gray-400">Loading alpha library…</div>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-black/60 rounded p-2 border border-white/5">
          <div className="text-[10px] uppercase text-gray-400">Active</div>
          <div className="text-xl font-bold text-emerald-300">{lib.totalActive}</div>
        </div>
        <div className="bg-black/60 rounded p-2 border border-white/5">
          <div className="text-[10px] uppercase text-gray-400">Decayed</div>
          <div className="text-xl font-bold text-red-300">{lib.totalDecayed}</div>
        </div>
        <div className="bg-black/60 rounded p-2 border border-white/5">
          <div className="text-[10px] uppercase text-gray-400">Added 24h</div>
          <div className="text-xl font-bold text-cyan-300">{lib.recentlyAdded}</div>
        </div>
      </div>
      {lib.top.length > 0 ? (
        <div>
          <h5 className="text-xs uppercase text-gray-400 mb-1">Top 5 by win rate × sample size</h5>
          <div className="bg-black/60 rounded border border-white/5">
            {lib.top.map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[11px] px-2 py-1 border-b border-white/5 last:border-0">
                <span className="text-gray-500 font-mono w-4">{i + 1}.</span>
                <span className="text-gray-300 font-mono flex-1 truncate">{p.pattern}</span>
                <span className="text-gray-500">·</span>
                <span className="text-gray-400 w-16">{p.symbol}</span>
                <span className="text-emerald-300 font-mono w-12 text-right">{(p.winRate * 100).toFixed(0)}%</span>
                <span className="text-gray-500 w-12 text-right">n={p.trades}</span>
                <span className={`font-mono w-16 text-right ${p.avgPnl >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{fmtUsd(p.avgPnl)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-xs text-gray-500 italic">No patterns learned yet — close a few brain trades to start accumulating.</div>
      )}
      {lib.bottom.length > 0 && (
        <div>
          <h5 className="text-xs uppercase text-gray-400 mb-1">Watch-list (low win rate ≥ 5 trades)</h5>
          <div className="bg-black/60 rounded border border-white/5">
            {lib.bottom.map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[11px] px-2 py-1 border-b border-white/5 last:border-0">
                <span className="text-gray-300 font-mono flex-1 truncate">{p.pattern}</span>
                <span className="text-gray-400 w-16">{p.symbol}</span>
                <span className="text-red-300 font-mono w-12 text-right">{(p.winRate * 100).toFixed(0)}%</span>
                <span className="text-gray-500 w-12 text-right">n={p.trades}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Phase 85 — Brain decision drill-down panel. Loads the historical trace for
// the position (if known) and renders the sensorium snapshot from the
// decision row. Operator sees exactly what the brain saw + why it decided.
function BrainDecisionDrill({ positionId, decision }: { positionId?: string; decision: any | null }) {
  const { data: trace } = trpc.agentScorecard.getBrainTraceForPosition.useQuery(
    { positionId: positionId ?? '', limit: 50 },
    { enabled: !!positionId, staleTime: 10_000 },
  );

  if (!decision) return null;
  // The decision passed in is from getBrainActivity, but to keep the sensorium
  // payload light we fetch the matching row in the trace (it has the snapshot).
  const sensoriumRow = (trace ?? []).find((t: any) => t.id === decision.id) ?? (trace ?? [])[0];
  const sensorium = sensoriumRow?.sensorium ?? null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-black/60 rounded p-2 border border-white/5">
          <div className="text-gray-500">Pipeline step</div>
          <div className="text-gray-200 font-mono">{decision.pipelineStep}</div>
        </div>
        <div className="bg-black/60 rounded p-2 border border-white/5">
          <div className="text-gray-500">Side / mode</div>
          <div className="text-gray-200">{decision.side ?? '—'} · {decision.isDryRun ? 'dry-run' : 'LIVE'}</div>
        </div>
        <div className="bg-black/60 rounded p-2 border border-white/5 col-span-2">
          <div className="text-gray-500">Reason</div>
          <div className="text-gray-200">{decision.reason ?? '—'}</div>
        </div>
      </div>

      {sensorium ? (
        <div className="space-y-2">
          <h4 className="text-xs uppercase text-gray-400 flex items-center gap-1">
            <Eye className="w-3 h-3" /> What the brain saw
          </h4>
          {/* Phase 89 — structured sensations table (replaces raw JSON dump) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
            {sensorium.market && (
              <div className="bg-black/60 rounded p-2 border border-white/5">
                <div className="text-gray-500 text-[9px] uppercase mb-0.5">Market</div>
                <div className="text-gray-200 font-mono">mid <strong>${(sensorium.market.midPrice ?? 0).toFixed(2)}</strong> · spread {(sensorium.market.spreadBps ?? 0).toFixed(2)}bps</div>
              </div>
            )}
            {sensorium.technical && (
              <div className="bg-black/60 rounded p-2 border border-white/5">
                <div className="text-gray-500 text-[9px] uppercase mb-0.5">Technical</div>
                <div className="text-gray-200 font-mono">
                  RSI <strong>{(sensorium.technical.rsi ?? 0).toFixed(1)}</strong> · ema {sensorium.technical.emaTrend} · super {sensorium.technical.superTrend} · macdH {(sensorium.technical.macdHist ?? 0).toFixed(2)}
                </div>
              </div>
            )}
            {sensorium.flow && (
              <div className="bg-black/60 rounded p-2 border border-white/5">
                <div className="text-gray-500 text-[9px] uppercase mb-0.5">Flow</div>
                <div className="text-gray-200 font-mono">
                  takerImb5s {(sensorium.flow.takerImbalance5s ?? 0).toFixed(2)} · depthImb5bp {(sensorium.flow.depthImbalance5bp ?? 0).toFixed(2)}
                </div>
              </div>
            )}
            {sensorium.whale && (
              <div className="bg-black/60 rounded p-2 border border-white/5">
                <div className="text-gray-500 text-[9px] uppercase mb-0.5">Whale</div>
                <div className="text-gray-200 font-mono">
                  netFlow ${((sensorium.whale.netExchangeFlow5m ?? 0) / 1000).toFixed(0)}k · {sensorium.whale.largeFillsLast30s ?? 0} large fills
                </div>
              </div>
            )}
            {sensorium.deriv && (
              <div className="bg-black/60 rounded p-2 border border-white/5">
                <div className="text-gray-500 text-[9px] uppercase mb-0.5">Derivatives</div>
                <div className="text-gray-200 font-mono">
                  funding {(sensorium.deriv.fundingRate ?? 0).toFixed(4)} · oiΔ {(sensorium.deriv.oiDelta5m ?? 0).toFixed(2)} · liqP {(sensorium.deriv.liquidationPressure ?? 0).toFixed(2)}
                </div>
              </div>
            )}
            {sensorium.opportunity && (
              <div className="bg-black/60 rounded p-2 border border-white/5">
                <div className="text-gray-500 text-[9px] uppercase mb-0.5">Opportunity</div>
                <div className="text-gray-200 font-mono">
                  <strong>{sensorium.opportunity.direction}</strong> @ {(sensorium.opportunity.score ?? 0).toFixed(2)} · {sensorium.opportunity.confluenceCount}/{sensorium.opportunity.totalSensors} confluence
                </div>
              </div>
            )}
            {sensorium.stance && (
              <div className="bg-black/60 rounded p-2 border border-white/5">
                <div className="text-gray-500 text-[9px] uppercase mb-0.5">Stance (consensus)</div>
                <div className="text-gray-200 font-mono">
                  {sensorium.stance.currentDirection} @ {((sensorium.stance.currentConsensus ?? 0) * 100).toFixed(0)}% · drift {(sensorium.stance.driftFromEntry ?? 0).toFixed(2)}
                </div>
              </div>
            )}
            {sensorium.alpha && (
              <div className="bg-black/60 rounded p-2 border border-white/5">
                <div className="text-gray-500 text-[9px] uppercase mb-0.5">Alpha library</div>
                <div className="text-gray-200 font-mono">
                  {sensorium.alpha.activePatternCount} active · {sensorium.alpha.decayedPatternCount} decayed · winRate {((sensorium.alpha.weightedWinRate ?? 0) * 100).toFixed(0)}%
                </div>
              </div>
            )}
            {sensorium.portfolio && (
              <div className="bg-black/60 rounded p-2 border border-white/5 md:col-span-2">
                <div className="text-gray-500 text-[9px] uppercase mb-0.5">Portfolio</div>
                <div className="text-gray-200 font-mono">
                  equity ${(sensorium.portfolio.equity ?? 0).toFixed(2)} · daily {(sensorium.portfolio.dailyPnlPercent ?? 0).toFixed(2)}% · {sensorium.portfolio.openPositionCount ?? 0} open · circuit {sensorium.portfolio.dailyLossCircuitTripped ? 'TRIPPED' : 'ok'}
                </div>
              </div>
            )}
          </div>
          {sensorium?.agentVotes && (
            <div className="space-y-2">
              <h4 className="text-xs uppercase text-gray-400">Agent vote tally ({sensorium.agentVotes.votes?.length ?? 0} agents heard)</h4>
              <div className="flex flex-wrap gap-1">
                <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                  ↑ {sensorium.agentVotes.longCount ?? 0} long
                </Badge>
                <Badge className="bg-red-500/15 text-red-300 border-red-500/30">
                  ↓ {sensorium.agentVotes.shortCount ?? 0} short
                </Badge>
                <Badge className="bg-gray-500/15 text-gray-400 border-gray-500/30">
                  • {sensorium.agentVotes.neutralCount ?? 0} neutral
                </Badge>
                {sensorium.agentVotes.anyVetoActive && (
                  <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30">
                    VETO: {(sensorium.agentVotes.vetoReasons ?? []).join('; ')}
                  </Badge>
                )}
              </div>
              {/* Phase 86 — Individual agent names + direction + confidence */}
              {Array.isArray(sensorium.agentVotes.votes) && sensorium.agentVotes.votes.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-0.5 max-h-48 overflow-y-auto bg-black/60 rounded p-2 border border-white/5 text-[10px]">
                  {[...sensorium.agentVotes.votes]
                    .sort((a: any, b: any) => {
                      const order = { bullish: 0, bearish: 1, neutral: 2 } as Record<string, number>;
                      return (order[a.direction] ?? 3) - (order[b.direction] ?? 3) || (b.confidence ?? 0) - (a.confidence ?? 0);
                    })
                    .map((v: any) => (
                      <div key={v.agentName} className="flex items-center gap-1.5">
                        <span className={
                          v.direction === 'bullish' ? 'text-emerald-400'
                          : v.direction === 'bearish' ? 'text-red-400'
                          : 'text-gray-500'
                        }>
                          {v.direction === 'bullish' ? '↑' : v.direction === 'bearish' ? '↓' : '•'}
                        </span>
                        <span className="text-gray-300 truncate flex-1">{v.agentName}</span>
                        <span className="text-gray-500 font-mono">{(v.confidence ?? 0).toFixed(2)}</span>
                        {v.vetoActive && <span className="text-amber-400 text-[9px] font-bold">VETO</span>}
                      </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-gray-500 italic">No sensorium snapshot stored on this decision (trace flushing may have lagged).</div>
      )}

      {trace && trace.length > 1 && (
        <div className="space-y-2">
          <h4 className="text-xs uppercase text-gray-400">Recent decisions for this position ({trace.length})</h4>
          <div className="max-h-40 overflow-y-auto bg-black/60 rounded border border-white/5">
            {trace.slice(0, 25).map((t: any) => (
              <div key={t.id} className="px-2 py-1 text-[10px] flex items-center gap-2 border-b border-white/5">
                <span className="text-gray-500 font-mono">{new Date(t.timestamp).toLocaleTimeString()}</span>
                <Badge className="text-[9px] py-0">{t.kind}</Badge>
                <span className="font-mono text-gray-400">{t.pipelineStep}</span>
                <span className="ml-auto text-gray-500 truncate max-w-md">{t.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
