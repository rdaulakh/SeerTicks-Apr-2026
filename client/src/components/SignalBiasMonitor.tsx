/**
 * Signal Bias Monitor Widget
 * Real-time bullish/bearish/neutral signal distribution tracking
 * Phase 29: Bias monitoring for drift detection
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  BarChart3,
  Clock,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TimeRange = 1 | 6 | 24 | 72 | 168;

interface DirectionCount {
  direction: string | null;
  count: number;
}

function getPercent(items: DirectionCount[], dir: string): number {
  const total = items.reduce((s, i) => s + Number(i.count), 0);
  if (total === 0) return 0;
  const match = items.find((i) => i.direction === dir);
  return match ? (Number(match.count) / total) * 100 : 0;
}

function getCount(items: DirectionCount[], dir: string): number {
  return Number(items.find((i) => i.direction === dir)?.count ?? 0);
}

function BiasBar({
  bullish,
  bearish,
  label,
  total,
}: {
  bullish: number;
  bearish: number;
  label: string;
  total: number;
}) {
  const bullPct = total > 0 ? (bullish / total) * 100 : 50;
  const bearPct = total > 0 ? (bearish / total) * 100 : 50;
  const biasLevel =
    bullPct > 80 || bearPct > 80
      ? "extreme"
      : bullPct > 65 || bearPct > 65
        ? "moderate"
        : "balanced";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-500">
          {total > 0 ? `${total} signals` : "No data"}
        </span>
      </div>
      <div className="flex h-5 rounded-full overflow-hidden bg-gray-800">
        {total > 0 ? (
          <>
            <div
              className="bg-emerald-500/80 flex items-center justify-center text-[10px] font-medium text-white transition-all duration-500"
              style={{ width: `${bullPct}%` }}
            >
              {bullPct >= 15 ? `${bullPct.toFixed(0)}%` : ""}
            </div>
            <div
              className="bg-red-500/80 flex items-center justify-center text-[10px] font-medium text-white transition-all duration-500"
              style={{ width: `${bearPct}%` }}
            >
              {bearPct >= 15 ? `${bearPct.toFixed(0)}%` : ""}
            </div>
          </>
        ) : (
          <div className="w-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-500">
            Waiting for data
          </div>
        )}
      </div>
      {biasLevel === "extreme" && total > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-amber-400">
          <AlertTriangle className="w-3 h-3" />
          Extreme bias detected ({bullPct > bearPct ? "bullish" : "bearish"}{" "}
          {Math.max(bullPct, bearPct).toFixed(0)}%)
        </div>
      )}
    </div>
  );
}

function HourlyTrend({
  hourly,
}: {
  hourly: Array<{
    hour: string;
    direction: string | null;
    eventType: string;
    count: number;
  }>;
}) {
  const chartData = useMemo(() => {
    // Group by hour, only consensus events
    const hourMap = new Map<
      string,
      { bullish: number; bearish: number; total: number }
    >();
    for (const row of hourly.filter((h) => h.eventType === "CONSENSUS")) {
      const existing = hourMap.get(row.hour) || {
        bullish: 0,
        bearish: 0,
        total: 0,
      };
      if (row.direction === "bullish")
        existing.bullish += Number(row.count);
      if (row.direction === "bearish")
        existing.bearish += Number(row.count);
      existing.total += Number(row.count);
      hourMap.set(row.hour, existing);
    }
    return Array.from(hourMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12); // Last 12 hours
  }, [hourly]);

  if (chartData.length === 0) {
    return (
      <div className="text-center text-gray-500 text-xs py-4">
        No hourly data available
      </div>
    );
  }

  const maxTotal = Math.max(...chartData.map(([, d]) => d.total), 1);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <Clock className="w-3 h-3" />
        Hourly Consensus Trend
      </div>
      <div className="flex items-end gap-1 h-20">
        {chartData.map(([hour, data]) => {
          const height = (data.total / maxTotal) * 100;
          const bullPct =
            data.total > 0 ? (data.bullish / data.total) * 100 : 50;
          return (
            <div
              key={hour}
              className="flex-1 flex flex-col items-center gap-0.5"
              title={`${hour}\nBullish: ${data.bullish} (${bullPct.toFixed(0)}%)\nBearish: ${data.bearish} (${(100 - bullPct).toFixed(0)}%)`}
            >
              <div
                className="w-full rounded-t overflow-hidden flex flex-col"
                style={{ height: `${height}%`, minHeight: "4px" }}
              >
                <div
                  className="bg-emerald-500/70 w-full"
                  style={{ height: `${bullPct}%` }}
                />
                <div
                  className="bg-red-500/70 w-full flex-1"
                />
              </div>
              <span className="text-[8px] text-gray-600 truncate w-full text-center">
                {hour.split(" ")[1]?.replace(":00", "h") || ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentBreakdownTable({
  breakdown,
}: {
  breakdown: Array<{
    reason: string | null;
    direction: string | null;
    count: number;
  }>;
}) {
  if (breakdown.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <BarChart3 className="w-3 h-3" />
        Top Consensus Patterns
      </div>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {breakdown.slice(0, 8).map((row, i) => (
          <div
            key={i}
            className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-gray-800/50"
          >
            <div className="flex items-center gap-1.5">
              {row.direction === "bullish" ? (
                <TrendingUp className="w-3 h-3 text-emerald-400" />
              ) : (
                <TrendingDown className="w-3 h-3 text-red-400" />
              )}
              <span className="text-gray-300 font-mono">{row.reason}</span>
            </div>
            <span
              className={cn(
                "font-medium",
                row.direction === "bullish"
                  ? "text-emerald-400"
                  : "text-red-400"
              )}
            >
              {Number(row.count)}x
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SignalBiasMonitor() {
  const [hours, setHours] = useState<TimeRange>(24);
  const timeRanges: { label: string; value: TimeRange }[] = [
    { label: "1h", value: 1 },
    { label: "6h", value: 6 },
    { label: "24h", value: 24 },
    { label: "3d", value: 72 },
    { label: "7d", value: 168 },
  ];

  const { data, isLoading, refetch } = trpc.monitoring.getSignalBiasDistribution.useQuery(
    { hours },
    { refetchInterval: 30000 } // Refresh every 30s
  );

  const consensus = data?.consensus ?? [];
  const approved = data?.approved ?? [];
  const rejected = data?.rejected ?? [];
  const hourly = data?.hourly ?? [];
  const agentBreakdown = data?.agentBreakdown ?? [];

  const consBull = getCount(consensus, "bullish");
  const consBear = getCount(consensus, "bearish");
  const consTotal = consBull + consBear;

  const appBull = getCount(approved, "bullish");
  const appBear = getCount(approved, "bearish");
  const appTotal = appBull + appBear;

  const rejBull = getCount(rejected, "bullish");
  const rejBear = getCount(rejected, "bearish");
  const rejTotal = rejBull + rejBear;

  // Overall bias score: -100 (extreme bearish) to +100 (extreme bullish)
  const biasScore =
    consTotal > 0 ? ((consBull - consBear) / consTotal) * 100 : 0;
  const biasLabel =
    Math.abs(biasScore) < 20
      ? "Balanced"
      : Math.abs(biasScore) < 50
        ? biasScore > 0
          ? "Mild Bullish"
          : "Mild Bearish"
        : Math.abs(biasScore) < 75
          ? biasScore > 0
            ? "Moderate Bullish"
            : "Moderate Bearish"
          : biasScore > 0
            ? "Strong Bullish"
            : "Strong Bearish";

  return (
    <Card className="bg-gray-900/60 border-gray-700/50 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-gray-200">
            Signal Bias Monitor
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-800 rounded-lg p-0.5">
            {timeRanges.map((tr) => (
              <button
                key={tr.value}
                onClick={() => setHours(tr.value)}
                className={cn(
                  "px-2 py-0.5 text-[10px] rounded-md transition-colors",
                  hours === tr.value
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-gray-200"
                )}
              >
                {tr.label}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => refetch()}
          >
            <RefreshCw
              className={cn("w-3 h-3 text-gray-400", isLoading && "animate-spin")}
            />
          </Button>
        </div>
      </div>

      {/* Bias Score */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-800/50">
        <div
          className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center",
            Math.abs(biasScore) < 20
              ? "bg-gray-700"
              : biasScore > 0
                ? "bg-emerald-900/50"
                : "bg-red-900/50"
          )}
        >
          {Math.abs(biasScore) < 20 ? (
            <Minus className="w-5 h-5 text-gray-400" />
          ) : biasScore > 0 ? (
            <TrendingUp className="w-5 h-5 text-emerald-400" />
          ) : (
            <TrendingDown className="w-5 h-5 text-red-400" />
          )}
        </div>
        <div>
          <div className="text-lg font-bold text-gray-100">
            {biasScore > 0 ? "+" : ""}
            {biasScore.toFixed(1)}
          </div>
          <div className="text-[11px] text-gray-400">{biasLabel}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-xs text-gray-400">
            {consTotal} consensus / {appTotal} approved
          </div>
          <div className="text-[10px] text-gray-500">
            Last {hours}h window
          </div>
        </div>
      </div>

      {/* Bias Bars */}
      <div className="space-y-3">
        <BiasBar
          bullish={consBull}
          bearish={consBear}
          total={consTotal}
          label="Consensus"
        />
        <BiasBar
          bullish={appBull}
          bearish={appBear}
          total={appTotal}
          label="Approved Signals"
        />
        <BiasBar
          bullish={rejBull}
          bearish={rejBear}
          total={rejTotal}
          label="Rejected Signals"
        />
      </div>

      {/* Hourly Trend */}
      <HourlyTrend hourly={hourly} />

      {/* Agent Breakdown */}
      <AgentBreakdownTable breakdown={agentBreakdown} />

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-[10px] text-gray-500 pt-1 border-t border-gray-800">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          Bullish
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          Bearish
        </div>
        <div className="flex items-center gap-1">
          <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
          &gt;80% = Extreme Bias
        </div>
      </div>
    </Card>
  );
}
