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

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
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
        refetchInterval: 5_000,
        placeholderData: (prev) => prev,
        retry: 3,
        staleTime: 4_000,
      },
    );

  // ── Phase 85 — operator console: brain config, health, controls ──
  const utils = trpc.useUtils();
  const { data: brainCH, refetch: refetchBrainCH } =
    trpc.agentScorecard.getBrainConfigAndHealth.useQuery(undefined, {
      refetchInterval: 5_000,
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

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-400" />
            Agent Scorecard
          </h1>
          <p className="text-sm text-gray-400">
            Per-agent performance, watchdog status, and signed-$ contribution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Window:</span>
          <Select value={String(windowHours)} onValueChange={(v) => setWindowHours(Number(v))}>
            <SelectTrigger className="w-32 bg-black/40 border-white/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 1h</SelectItem>
              <SelectItem value="6">Last 6h</SelectItem>
              <SelectItem value="24">Last 24h</SelectItem>
              <SelectItem value="72">Last 3d</SelectItem>
              <SelectItem value="168">Last 7d</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 bg-black/40 border-white/10">
          <div className="text-xs uppercase text-gray-400">Signals in window</div>
          <div className="text-2xl font-bold mt-1">{summary?.signals?.total ?? "—"}</div>
          <div className="text-xs text-gray-500 mt-1">
            {summary?.signals?.distinctAgents ?? 0} agents firing
          </div>
        </Card>
        <Card className="p-4 bg-black/40 border-white/10">
          <div className="text-xs uppercase text-gray-400">Agents w/ accuracy</div>
          <div className="text-2xl font-bold mt-1">
            {summary?.accuracy?.agentsWithRecords ?? 0}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {summary?.accuracy?.totalTrades ?? 0} trades evaluated
          </div>
        </Card>
        <Card className="p-4 bg-black/40 border-white/10">
          <div className="text-xs uppercase text-gray-400">Weighted accuracy</div>
          <div className="text-2xl font-bold mt-1">
            {fmtPct(summary?.accuracy?.weightedAccuracy ?? null)}
          </div>
          <div className="text-xs text-gray-500 mt-1">across all agents</div>
        </Card>
        <Card className="p-4 bg-black/40 border-white/10">
          <div className="text-xs uppercase text-gray-400">Engine heartbeat</div>
          <div className="text-2xl font-bold mt-1 flex items-center gap-2">
            {summary?.watchdog?.haltActive ? (
              <>
                <XCircle className="w-5 h-5 text-red-400" /> Halted
              </>
            ) : summary?.watchdog?.healthy ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-emerald-400" /> Active
              </>
            ) : (
              <>
                <AlertTriangle className="w-5 h-5 text-yellow-400" /> Idle
              </>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {summary?.watchdog?.haltReason ?? "no halt"}
          </div>
        </Card>
      </div>

      <Tabs defaultValue="agents" className="space-y-4">
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
          {/* Phase 85 — Control bar: Start / Stop / Toggle Dry-Run */}
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

          {/* Phase 85 — Sensorium health: how many agents are talking to the brain */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Card className="p-3 bg-black/40 border-white/10">
              <div className="text-[10px] uppercase text-gray-400">Agent votes</div>
              <div className="text-xl font-bold mt-1 text-cyan-300">
                {brainCH?.sensoriumHealth?.agentVotes ?? 0}
              </div>
              <div className="text-[10px] text-gray-500">symbols heard</div>
            </Card>
            <Card className="p-3 bg-black/40 border-white/10">
              <div className="text-[10px] uppercase text-gray-400">Market</div>
              <div className="text-xl font-bold mt-1">{brainCH?.sensoriumHealth?.market ?? 0}</div>
              <div className="text-[10px] text-gray-500">tick streams</div>
            </Card>
            <Card className="p-3 bg-black/40 border-white/10">
              <div className="text-[10px] uppercase text-gray-400">Technical</div>
              <div className="text-xl font-bold mt-1">{brainCH?.sensoriumHealth?.technical ?? 0}</div>
              <div className="text-[10px] text-gray-500">syms</div>
            </Card>
            <Card className="p-3 bg-black/40 border-white/10">
              <div className="text-[10px] uppercase text-gray-400">Flow / Whale / Deriv</div>
              <div className="text-xl font-bold mt-1">
                {(brainCH?.sensoriumHealth?.flow ?? 0)}/{(brainCH?.sensoriumHealth?.whale ?? 0)}/{(brainCH?.sensoriumHealth?.deriv ?? 0)}
              </div>
              <div className="text-[10px] text-gray-500">syms heard</div>
            </Card>
            <Card className="p-3 bg-black/40 border-white/10">
              <div className="text-[10px] uppercase text-gray-400">Positions</div>
              <div className="text-xl font-bold mt-1">{brainCH?.sensoriumHealth?.positions ?? 0}</div>
              <div className="text-[10px] text-gray-500">tracked</div>
            </Card>
            <Card className="p-3 bg-black/40 border-white/10">
              <div className="text-[10px] uppercase text-gray-400">Opportunities</div>
              <div className="text-xl font-bold mt-1 text-amber-300">{brainCH?.sensoriumHealth?.opportunities ?? 0}</div>
              <div className="text-[10px] text-gray-500">candidate scores</div>
            </Card>
          </div>

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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="bg-black/40 border-white/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Settings className="w-4 h-4 text-cyan-400" />
                <h3 className="font-semibold text-sm">Brain config (hot-reload)</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { key: 'minOpportunityScore', label: 'Min opp score', step: 0.05 },
                  { key: 'minConfluenceCount', label: 'Min confluence', step: 1 },
                  { key: 'entrySizeEquityFraction', label: 'Entry equity %', step: 0.05 },
                  { key: 'kellyFraction', label: 'Kelly fraction', step: 0.05 },
                  { key: 'defaultStopLossPercent', label: 'Stop loss %', step: 0.1 },
                  { key: 'defaultTakeProfitPercent', label: 'Take profit %', step: 0.1 },
                ].map(({ key, label, step }) => (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="text-gray-400">{label}</span>
                    <input
                      type="number"
                      step={step}
                      defaultValue={brainCH?.config?.[key] ?? ''}
                      onChange={(e) => setEditConfig((s) => ({ ...s, [key]: e.target.value }))}
                      className="bg-black/60 border border-white/10 rounded px-2 py-1 text-gray-200 text-xs font-mono"
                    />
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
                    setCandidateSymbolsMut.mutate({ symbols: syms });
                  }}
                >
                  Update symbols
                </Button>
              </div>
            </Card>
          </div>

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
                        }>{isVeto ? '⚠ VETO' : d.kind}</Badge>
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
          <pre className="text-[10px] text-gray-300 bg-black/60 rounded p-2 overflow-auto max-h-72 border border-white/5 font-mono">
{JSON.stringify(sensorium, null, 2)}
          </pre>
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
                    ⚠ VETO: {(sensorium.agentVotes.vetoReasons ?? []).join('; ')}
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
                        {v.vetoActive && <span className="text-amber-400">⚠</span>}
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
