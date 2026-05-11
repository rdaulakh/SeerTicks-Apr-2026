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
