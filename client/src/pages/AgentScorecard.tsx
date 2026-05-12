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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

        {/* PHASE 84 — BRAIN ACTIVITY */}
        <TabsContent value="brain" className="space-y-3">
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

          {/* Recent decision stream */}
          <Card className="bg-black/40 border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <h2 className="font-semibold">Decision stream (live)</h2>
              <Badge variant="outline" className="border-white/20 ml-auto">
                {brainActivity?.recent?.length ?? 0} entries
              </Badge>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {!brainActivity || brainActivity.recent.length === 0 ? (
                <div className="px-4 py-6 text-center text-gray-400 text-sm">No recent decisions.</div>
              ) : (
                <div className="divide-y divide-white/5">
                  {brainActivity.recent.map((d: any) => (
                    <div key={d.id} className="px-4 py-2 text-xs hover:bg-white/5">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 font-mono">{new Date(d.timestamp).toLocaleTimeString()}</span>
                        <Badge className={
                          d.kind === 'exit_full' ? 'bg-red-500/15 text-red-300 border-red-500/30'
                          : d.kind === 'tighten_stop' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                          : d.kind === 'enter_long' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : d.kind === 'enter_short' ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                          : 'bg-gray-500/15 text-gray-400 border-gray-500/30'
                        }>{d.kind}</Badge>
                        <span className="text-gray-300 font-medium">{d.symbol}</span>
                        <span className="text-gray-500">·</span>
                        <span className="font-mono text-gray-400">{d.pipelineStep}</span>
                        {d.isDryRun && <Badge className="bg-gray-500/15 text-gray-400 border-gray-500/30 text-[10px]">DRY</Badge>}
                        <span className="ml-auto text-gray-500">{d.latencyUs}µs</span>
                      </div>
                      <div className="text-gray-400 mt-0.5 pl-12">{d.reason}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
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
