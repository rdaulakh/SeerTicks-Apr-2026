/**
 * EquityCurvePanel — cumulative P&L over the last N days.
 *
 * Data source: `trpc.pnlChart.getDateWisePnl` returns one row per day with
 * `cumulativePnl`, `dailyPnl`, `tradeCount`. We render an area chart with
 * a zero baseline so red shading visualises the underwater region clearly.
 *
 * Fall-back: `trpc.advancedRisk.getEquityCurve` returns DAILY equity
 * snapshots from PortfolioSnapshotService. The dateWisePnl source is
 * preferred because it works even before snapshot history exists (it's
 * derived from closed trades).
 */

import { useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

type WindowKey = "7d" | "30d" | "90d";
const WINDOW_DAYS: Record<WindowKey, number> = { "7d": 7, "30d": 30, "90d": 90 };

function fmtUSD(n: number, opts: { sign?: boolean; compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = opts.sign && n > 0 ? "+" : "";
  if (opts.compact && abs >= 1000) return `${sign}$${(n / 1000).toFixed(1)}k`;
  return `${sign}$${n.toFixed(2)}`;
}

export default function EquityCurvePanel() {
  const [window, setWindow] = useState<WindowKey>("30d");
  const days = WINDOW_DAYS[window];

  const start = useMemo(() => {
    const d = new Date(Date.now() - days * 86400_000);
    return d.toISOString().slice(0, 10);
  }, [days]);

  const { data, isLoading } = trpc.pnlChart.getDateWisePnl.useQuery(
    { startDate: start },
    { refetchInterval: 60_000, staleTime: 30_000 }
  );

  const chartData = data?.data ?? [];
  const summary = data?.summary;
  const final = chartData.length ? chartData[chartData.length - 1].cumulativePnl : 0;
  const positive = final >= 0;

  // Min/max for ref-line and y-axis padding hints
  const stats = useMemo(() => {
    if (chartData.length === 0) return { min: 0, max: 0, peak: 0, trough: 0 };
    let min = Infinity, max = -Infinity;
    for (const d of chartData) {
      if (d.cumulativePnl < min) min = d.cumulativePnl;
      if (d.cumulativePnl > max) max = d.cumulativePnl;
    }
    return { min, max, peak: max, trough: min };
  }, [chartData]);

  return (
    <Card className="glass-card border-slate-800/50 p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <TrendingUp className={cn("w-4 h-4", positive ? "text-green-400" : "text-red-400")} />
          Equity Curve
          <span className="text-xs text-slate-500 normal-case">
            ({summary?.totalTrades ?? 0} trades · {window})
          </span>
        </h2>
        <div className="flex items-center gap-1">
          {(["7d", "30d", "90d"] as const).map((w) => (
            <Button
              key={w}
              variant="ghost"
              size="sm"
              onClick={() => setWindow(w)}
              className={cn(
                "h-6 px-2 text-[10px] uppercase tracking-wider",
                window === w ? "bg-slate-700/60 text-white" : "text-slate-400 hover:text-white"
              )}
            >
              {w}
            </Button>
          ))}
        </div>
      </div>

      {/* Summary numbers */}
      <div className="grid grid-cols-4 gap-2 mb-3 text-xs font-mono">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Net</p>
          <p className={cn("font-bold", positive ? "text-green-400" : "text-red-400")}>
            {fmtUSD(final, { sign: true })}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Peak</p>
          <p className="font-bold text-green-300">{fmtUSD(stats.peak, { sign: true })}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Trough</p>
          <p className="font-bold text-red-300">{fmtUSD(stats.trough, { sign: true })}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Win rate</p>
          <p className="font-bold text-slate-200">
            {summary && summary.totalTrades > 0
              ? `${((summary.totalWins / summary.totalTrades) * 100).toFixed(1)}%`
              : "—"}
          </p>
        </div>
      </div>

      <div className="h-[260px] -ml-2">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500">
            Loading equity curve…
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500">
            No closed trades in window — equity curve will populate after the first trade closes.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="eqGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="eqRed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.4} />
              <XAxis
                dataKey="date"
                tick={{ fill: "#64748b", fontSize: 10 }}
                tickFormatter={(d) => {
                  const dt = new Date(d);
                  return `${dt.getMonth() + 1}/${dt.getDate()}`;
                }}
                interval="preserveStartEnd"
                minTickGap={30}
              />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 10 }}
                tickFormatter={(v) => fmtUSD(Number(v), { compact: true })}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: "monospace",
                }}
                labelStyle={{ color: "#94a3b8" }}
                formatter={(value: any, name: string) => {
                  if (name === "cumulativePnl") return [fmtUSD(Number(value), { sign: true }), "Cumulative"];
                  if (name === "dailyPnl") return [fmtUSD(Number(value), { sign: true }), "Daily"];
                  return [value, name];
                }}
              />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
              <Area
                type="monotone"
                dataKey="cumulativePnl"
                stroke={positive ? "#10b981" : "#ef4444"}
                strokeWidth={2}
                fill={positive ? "url(#eqGreen)" : "url(#eqRed)"}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
