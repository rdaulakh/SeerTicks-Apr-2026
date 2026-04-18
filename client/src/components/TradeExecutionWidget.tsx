/**
 * Trade Execution Dashboard Widget
 * Displays real-time execution rate, latency metrics, and P&L summary
 * Institutional-grade monitoring for signal-to-trade pipeline
 */

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Activity, 
  Zap, 
  TrendingUp, 
  TrendingDown,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  BarChart3,
  Timer
} from "lucide-react";

interface LatencyGradeDistribution {
  excellent: number;
  good: number;
  acceptable: number;
  slow: number;
  critical: number;
}

// Latency grade colors
const gradeColors: Record<string, string> = {
  excellent: "bg-emerald-500",
  good: "bg-green-500",
  acceptable: "bg-yellow-500",
  slow: "bg-orange-500",
  critical: "bg-red-500",
};

const gradeLabels: Record<string, string> = {
  excellent: "<50ms",
  good: "50-100ms",
  acceptable: "100-250ms",
  slow: "250-500ms",
  critical: ">500ms",
};

export function TradeExecutionWidget() {
  const { data: latencyData, isLoading: latencyLoading } = trpc.health.getLatencyMetrics.useQuery(
    { hours: 24 },
    { refetchInterval: 30000 } // Refresh every 30 seconds
  );

  const { data: walletData } = trpc.trading.getPaperWallet.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const { data: positionsData } = trpc.seer.getPositions.useQuery(undefined, {
    refetchInterval: 30000,
  });

  if (latencyLoading) {
    return (
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Trade Execution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-8 bg-slate-700/50 rounded" />
            <div className="h-16 bg-slate-700/50 rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate P&L from wallet (values may be strings from database)
  const totalPnL = parseFloat(String(walletData?.totalPnL || '0'));
  const isProfitable = totalPnL >= 0;
  const winRate = parseFloat(String(walletData?.winRate || '0'));
  const totalTrades = walletData?.totalTrades || 0;
  const openPositions = positionsData?.length || 0;

  // Latency metrics
  const avgLatency = latencyData?.summary?.avgLatencyMs || 0;
  const p50Latency = latencyData?.summary?.p50LatencyMs || 0;
  const p95Latency = latencyData?.summary?.p95LatencyMs || 0;
  const executionRate = latencyData?.execution?.executionRate || "0.0%";
  const totalSignals = latencyData?.execution?.totalSignals || 0;
  const executed = latencyData?.execution?.executed || 0;
  const gradeDistribution = latencyData?.gradeDistribution as LatencyGradeDistribution || {
    excellent: 0, good: 0, acceptable: 0, slow: 0, critical: 0
  };

  // Calculate grade distribution percentages
  const totalGraded = Object.values(gradeDistribution).reduce((a, b) => a + b, 0);

  return (
    <Card className="bg-slate-900/50 border-slate-700/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-400" />
            Trade Execution
          </CardTitle>
          <Badge 
            variant="outline" 
            className={`text-xs ${
              parseFloat(executionRate) > 60 
                ? "border-emerald-500/50 text-emerald-400" 
                : parseFloat(executionRate) > 40 
                  ? "border-yellow-500/50 text-yellow-400"
                  : "border-red-500/50 text-red-400"
            }`}
          >
            {executionRate} Exec Rate
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* P&L Summary Row */}
        <div className="grid grid-cols-3 gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="bg-slate-800/50 rounded-lg p-2 text-center cursor-help">
                <div className={`text-lg font-bold ${isProfitable ? "text-emerald-400" : "text-red-400"}`}>
                  {isProfitable ? "+" : ""}{totalPnL.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                </div>
                <div className="text-xs text-slate-500 flex items-center justify-center gap-1">
                  {isProfitable ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  Total P&L
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Cumulative profit/loss from all closed positions</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="bg-slate-800/50 rounded-lg p-2 text-center cursor-help">
                <div className={`text-lg font-bold ${winRate >= 50 ? "text-emerald-400" : "text-yellow-400"}`}>
                  {winRate.toFixed(1)}%
                </div>
                <div className="text-xs text-slate-500 flex items-center justify-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Win Rate
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Percentage of profitable trades</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="bg-slate-800/50 rounded-lg p-2 text-center cursor-help">
                <div className="text-lg font-bold text-blue-400">
                  {totalTrades}
                </div>
                <div className="text-xs text-slate-500 flex items-center justify-center gap-1">
                  <BarChart3 className="h-3 w-3" />
                  Trades ({openPositions} open)
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Total trades executed, {openPositions} positions currently open</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Latency Metrics Row */}
        <div className="grid grid-cols-4 gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="bg-slate-800/30 rounded p-2 text-center cursor-help">
                <div className={`text-sm font-semibold ${avgLatency < 100 ? "text-emerald-400" : avgLatency < 250 ? "text-yellow-400" : "text-red-400"}`}>
                  {avgLatency}ms
                </div>
                <div className="text-[10px] text-slate-500">AVG</div>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Average signal-to-execution latency</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="bg-slate-800/30 rounded p-2 text-center cursor-help">
                <div className={`text-sm font-semibold ${p50Latency < 100 ? "text-emerald-400" : p50Latency < 250 ? "text-yellow-400" : "text-red-400"}`}>
                  {p50Latency}ms
                </div>
                <div className="text-[10px] text-slate-500">P50</div>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>50th percentile latency (median)</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="bg-slate-800/30 rounded p-2 text-center cursor-help">
                <div className={`text-sm font-semibold ${p95Latency < 250 ? "text-emerald-400" : p95Latency < 500 ? "text-yellow-400" : "text-red-400"}`}>
                  {p95Latency}ms
                </div>
                <div className="text-[10px] text-slate-500">P95</div>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>95th percentile latency (tail)</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="bg-slate-800/30 rounded p-2 text-center cursor-help">
                <div className="text-sm font-semibold text-blue-400">
                  {executed}/{totalSignals}
                </div>
                <div className="text-[10px] text-slate-500">Signals</div>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Executed signals out of total signals (24h)</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Latency Grade Distribution Bar */}
        {totalGraded > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Timer className="h-3 w-3" />
                Latency Distribution (24h)
              </span>
              <span>{totalGraded} executions</span>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden bg-slate-800">
              {Object.entries(gradeDistribution).map(([grade, count]) => {
                const percentage = totalGraded > 0 ? (count / totalGraded) * 100 : 0;
                if (percentage === 0) return null;
                return (
                  <Tooltip key={grade}>
                    <TooltipTrigger asChild>
                      <div 
                        className={`${gradeColors[grade]} cursor-help transition-all`}
                        style={{ width: `${percentage}%` }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="capitalize">{grade}: {count} ({percentage.toFixed(1)}%)</p>
                      <p className="text-xs text-slate-400">{gradeLabels[grade]}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-slate-600">
              <span>Excellent</span>
              <span>Critical</span>
            </div>
          </div>
        )}

        {/* No Data State */}
        {totalGraded === 0 && (
          <div className="text-center py-2 text-slate-500 text-xs">
            <Clock className="h-4 w-4 mx-auto mb-1 opacity-50" />
            No latency data in last 24h
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Compact version for dashboard header
 */
export function TradeExecutionIndicator() {
  const { data: latencyData } = trpc.health.getLatencyMetrics.useQuery(
    { hours: 24 },
    { refetchInterval: 60000 }
  );

  const { data: walletData } = trpc.trading.getPaperWallet.useQuery(undefined, {
    refetchInterval: 60000,
  });

  const avgLatency = latencyData?.summary?.avgLatencyMs || 0;
  const executionRate = latencyData?.execution?.executionRate || "0%";
  const totalPnL = parseFloat(String(walletData?.totalPnL || '0'));
  const isProfitable = totalPnL >= 0;

  // Determine latency status
  let latencyStatus: "excellent" | "good" | "warning" | "critical" = "excellent";
  if (avgLatency >= 500) latencyStatus = "critical";
  else if (avgLatency >= 250) latencyStatus = "warning";
  else if (avgLatency >= 100) latencyStatus = "good";

  const statusColors = {
    excellent: "text-emerald-400",
    good: "text-green-400",
    warning: "text-yellow-400",
    critical: "text-red-400",
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-3 px-3 py-1.5 bg-slate-800/50 rounded-lg cursor-help">
          <div className="flex items-center gap-1.5">
            <Zap className={`h-3.5 w-3.5 ${statusColors[latencyStatus]}`} />
            <span className={`text-xs font-medium ${statusColors[latencyStatus]}`}>
              {avgLatency}ms
            </span>
          </div>
          <div className="w-px h-4 bg-slate-700" />
          <div className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-xs font-medium text-blue-400">{executionRate}</span>
          </div>
          <div className="w-px h-4 bg-slate-700" />
          <div className="flex items-center gap-1.5">
            {isProfitable ? (
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5 text-red-400" />
            )}
            <span className={`text-xs font-medium ${isProfitable ? "text-emerald-400" : "text-red-400"}`}>
              {isProfitable ? "+" : ""}{totalPnL.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="space-y-1">
          <p className="font-medium">Trade Execution Status</p>
          <p className="text-xs text-slate-400">
            Avg Latency: {avgLatency}ms | Exec Rate: {executionRate} | P&L: {totalPnL.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default TradeExecutionWidget;
