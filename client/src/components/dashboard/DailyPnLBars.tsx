/**
 * DailyPnLBars — last 14 days of daily P&L as green/red bars.
 *
 * Bars are bucketed by day from `pnlChart.getDateWisePnl`. We pad the
 * result to N days so the operator sees blank-day context (no trades vs
 * a losing day are visually distinct).
 */

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import { Card } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

const DAYS = 14;

function fmtUSD(n: number, opts: { sign?: boolean; compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = opts.sign && n > 0 ? "+" : "";
  if (opts.compact && abs >= 1000) return `${sign}$${(n / 1000).toFixed(1)}k`;
  return `${sign}$${n.toFixed(2)}`;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function DailyPnLBars() {
  const startDate = useMemo(() => isoDay(new Date(Date.now() - DAYS * 86400_000)), []);

  const { data, isLoading } = trpc.pnlChart.getDateWisePnl.useQuery(
    { startDate },
    { refetchInterval: 60_000, staleTime: 30_000 }
  );

  // Pad to DAYS so blank days show as zero bars
  const bars = useMemo(() => {
    const byDate = new Map<string, { dailyPnl: number; tradeCount: number }>();
    for (const r of data?.data ?? []) {
      byDate.set(r.date, { dailyPnl: r.dailyPnl, tradeCount: r.tradeCount });
    }
    const out: Array<{ date: string; label: string; dailyPnl: number; tradeCount: number }> = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      const key = isoDay(d);
      const row = byDate.get(key);
      out.push({
        date: key,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        dailyPnl: row?.dailyPnl ?? 0,
        tradeCount: row?.tradeCount ?? 0,
      });
    }
    return out;
  }, [data]);

  const stats = useMemo(() => {
    let win = 0, loss = 0, flat = 0, sum = 0;
    for (const b of bars) {
      if (b.tradeCount === 0) flat++;
      else if (b.dailyPnl > 0) win++;
      else if (b.dailyPnl < 0) loss++;
      else flat++;
      sum += b.dailyPnl;
    }
    return { win, loss, flat, sum };
  }, [bars]);

  return (
    <Card className="glass-card border-slate-800/50 p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-emerald-400" />
          Daily P&L
          <span className="text-xs text-slate-500 normal-case">(last {DAYS}d)</span>
        </h2>
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="text-green-400">{stats.win}w</span>
          <span className="text-red-400">{stats.loss}l</span>
          <span className="text-slate-500">{stats.flat}—</span>
          <span className={cn(stats.sum >= 0 ? "text-green-400" : "text-red-400")}>
            {fmtUSD(stats.sum, { sign: true })}
          </span>
        </div>
      </div>

      <div className="h-[260px] -ml-2">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500">Loading…</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fill: "#64748b", fontSize: 10 }}
                interval="preserveStartEnd"
                minTickGap={20}
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
                formatter={(value: any, _name, item: any) => [
                  fmtUSD(Number(value), { sign: true }) +
                    ` · ${item?.payload?.tradeCount ?? 0}t`,
                  "P&L",
                ]}
              />
              <ReferenceLine y={0} stroke="#475569" />
              <Bar dataKey="dailyPnl">
                {bars.map((b, idx) => (
                  <Cell
                    key={idx}
                    fill={b.dailyPnl >= 0 ? "#10b981" : "#ef4444"}
                    fillOpacity={b.tradeCount === 0 ? 0.15 : 0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
