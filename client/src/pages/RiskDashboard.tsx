/**
 * Phase 18: Risk Dashboard — Unified Risk Monitoring
 *
 * Displays all Phase 16+17 risk infrastructure data:
 * - VaR Risk Gate status (portfolio VaR, CVaR, incremental VaR)
 * - Dynamic Correlation Matrix (rolling 24h Pearson correlations)
 * - Walk-Forward Optimization (overfit detection, parameter stability)
 * - Unified TradingConfig (all active trading parameters)
 * - Agent Alpha Validation (per-agent statistical alpha)
 * - Adaptive Consensus Weights (boosted/pruned agents)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2, Shield, AlertTriangle, CheckCircle2, XCircle,
  TrendingUp, TrendingDown, Activity, BarChart3, Settings2,
  Users, Zap, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── VaR Status Panel ───
function VaRPanel() {
  const { data, isLoading, error } = trpc.riskManagement.getVaRStatus.useQuery(undefined, {
    refetchInterval: 10000,
    staleTime: 5000,
  });

  if (isLoading) return <VaRSkeleton />;
  if (error || !data) return <ErrorCard title="VaR Risk Gate" message={error?.message || "Unavailable"} />;

  const varUtilization = data.limits.maxPortfolioVaR95Percent > 0
    ? (data.recentVolatility / data.limits.maxPortfolioVaR95Percent) * 100
    : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="h-5 w-5 text-blue-500" />
              VaR Risk Gate
            </CardTitle>
            <CardDescription>Portfolio Value-at-Risk monitoring</CardDescription>
          </div>
          <Badge variant={data.enabled ? "default" : "secondary"}>
            {data.enabled ? "Active" : "Disabled"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <MetricCard
            label="Data Points"
            value={data.dataPoints}
            suffix=""
            status={data.dataPoints >= 30 ? "good" : "warning"}
            tooltip="Return observations for VaR calculation (need 30+)"
          />
          <MetricCard
            label="Recent Volatility"
            value={(data.recentVolatility * 100).toFixed(2)}
            suffix="%"
            status={data.recentVolatility < 0.05 ? "good" : data.recentVolatility < 0.08 ? "warning" : "critical"}
          />
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Risk Limits</h4>
          <LimitBar
            label="Portfolio VaR(95%)"
            current={data.recentVolatility}
            limit={data.limits.maxPortfolioVaR95Percent}
          />
          <LimitBar
            label="Incremental VaR"
            current={0}
            limit={data.limits.maxIncrementalVaR95Percent}
          />
          <LimitBar
            label="CVaR(95%)"
            current={data.recentVolatility * 1.3}
            limit={data.limits.maxPortfolioCVaR95Percent}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Correlation Matrix Panel ───
function CorrelationPanel() {
  const { data, isLoading, error } = trpc.riskManagement.getCorrelationMatrix.useQuery(undefined, {
    refetchInterval: 30000,
    staleTime: 15000,
  });

  if (isLoading) return <CorrelationSkeleton />;
  if (error || !data) return <ErrorCard title="Correlation Matrix" message={error?.message || "Unavailable"} />;

  const symbols = data.matrix.symbols;
  const correlations = data.matrix.correlations;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-purple-500" />
          Dynamic Correlations
        </CardTitle>
        <CardDescription>
          Rolling {data.matrix.windowMinutes}-min windows &middot; {data.matrix.dataPoints} data points
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {symbols.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No correlation data yet. Correlations populate after price data accumulates.
          </p>
        ) : (
          <>
            {/* Correlation Heatmap */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left p-1"></th>
                    {symbols.map(s => (
                      <th key={s} className="p-1 text-center font-medium">
                        {s.replace('USDT', '').replace('USD', '')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {symbols.map((rowSym, i) => (
                    <tr key={rowSym}>
                      <td className="p-1 font-medium">{rowSym.replace('USDT', '').replace('USD', '')}</td>
                      {symbols.map((_, j) => {
                        const corr = correlations[i]?.[j] ?? 0;
                        return (
                          <td
                            key={j}
                            className="p-1 text-center rounded"
                            style={{ backgroundColor: getCorrelationColor(corr, i === j) }}
                          >
                            {i === j ? "1.00" : corr.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Correlation Pairs */}
            {data.correlationPairs.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-muted-foreground">Active Pairs</h4>
                {data.correlationPairs.map((pair, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <span>{pair.symbolA} / {pair.symbolB}</span>
                    <Badge variant={Math.abs(pair.correlation) > 0.85 ? "destructive" : Math.abs(pair.correlation) > 0.7 ? "secondary" : "outline"}>
                      {pair.correlation.toFixed(3)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            {/* Open Exposure */}
            {Object.keys(data.openExposure).length > 0 && (
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-muted-foreground">Open Exposure</h4>
                {Object.entries(data.openExposure).map(([sym, exp]) => (
                  <div key={sym} className="flex items-center justify-between text-sm">
                    <span>{sym}</span>
                    <span className="font-mono">${(exp as number).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Walk-Forward Panel ───
function WalkForwardPanel() {
  const { data, isLoading, error } = trpc.riskManagement.getWalkForwardResults.useQuery(undefined, {
    refetchInterval: 60000,
    staleTime: 30000,
  });

  if (isLoading) return <WalkForwardSkeleton />;
  if (error || !data) return <ErrorCard title="Walk-Forward Optimizer" message={error?.message || "Unavailable"} />;

  if (data.status === 'pending') {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-orange-500" />
            Walk-Forward Optimization
          </CardTitle>
          <CardDescription>Parameter stability and overfit detection</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
            <p className="text-sm">Awaiting first optimization run...</p>
            <p className="text-xs mt-1">Runs weekly after sufficient trade history</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (data.status === 'error') {
    return <ErrorCard title="Walk-Forward Optimizer" message={data.message || "Error"} />;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5 text-orange-500" />
              Walk-Forward Optimization
            </CardTitle>
            <CardDescription>Last run: {data.timestamp}</CardDescription>
          </div>
          <div className="flex gap-1">
            {data.isOverfit && <Badge variant="destructive">Overfit</Badge>}
            {data.isUnstable && <Badge variant="destructive">Unstable</Badge>}
            {!data.isOverfit && !data.isUnstable && <Badge variant="default">Stable</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <MetricCard
            label="In-Sample Sharpe"
            value={data.avgInSampleSharpe?.toFixed(2) ?? "N/A"}
            status={data.avgInSampleSharpe && data.avgInSampleSharpe > 1 ? "good" : "warning"}
          />
          <MetricCard
            label="Out-of-Sample Sharpe"
            value={data.avgOutOfSampleSharpe?.toFixed(2) ?? "N/A"}
            status={data.avgOutOfSampleSharpe && data.avgOutOfSampleSharpe > 0.5 ? "good" : "warning"}
          />
          <MetricCard
            label="Overfit Ratio"
            value={data.avgOverfitRatio?.toFixed(2) ?? "N/A"}
            status={data.avgOverfitRatio && data.avgOverfitRatio > 0.7 ? "good" : "critical"}
            tooltip="OOS/IS Sharpe ratio. Below 0.7 = overfitting"
          />
          <MetricCard
            label="Parameter Drift"
            value={((data.maxParameterDrift ?? 0) * 100).toFixed(1)}
            suffix="%"
            status={data.maxParameterDrift && data.maxParameterDrift < 0.15 ? "good" : "warning"}
            tooltip="Max parameter variation across windows. >15% = unstable"
          />
        </div>

        <Badge variant="outline" className="text-xs">
          Confidence: {data.confidence} &middot; Windows: {data.totalWindows}
        </Badge>

        {data.recommendedParams && (
          <div className="space-y-1">
            <h4 className="text-sm font-medium text-muted-foreground">Recommended Parameters</h4>
            <div className="grid grid-cols-2 gap-1 text-xs font-mono bg-muted/50 p-2 rounded">
              {Object.entries(data.recommendedParams).map(([key, val]) => (
                <div key={key}>
                  <span className="text-muted-foreground">{key}:</span> {typeof val === 'number' ? val.toFixed(3) : String(val)}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Trading Config Panel ───
function TradingConfigPanel() {
  const { data, isLoading, error } = trpc.riskManagement.getTradingConfig.useQuery(undefined, {
    staleTime: 60000,
  });

  if (isLoading) return <ConfigSkeleton />;
  if (error || !data || !data.config) return <ErrorCard title="Trading Config" message={error?.message || "Unavailable"} />;

  const c = data.config;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-gray-500" />
              Active Trading Configuration
            </CardTitle>
            <CardDescription>Single source of truth (Phase 17)</CardDescription>
          </div>
          <Badge variant={data.isValid ? "default" : "destructive"}>
            {data.isValid ? "Valid" : `${data.validationErrors.length} errors`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ConfigSection title="Circuit Breakers" items={[
          ["Max Daily Trades", c.circuitBreakers.maxDailyTrades],
          ["Max Consecutive Losses", c.circuitBreakers.maxConsecutiveLosses],
          ["Daily Loss Limit", `${(c.circuitBreakers.maxDailyLossPercent * 100).toFixed(0)}%`],
          ["Max Drawdown", `${(c.circuitBreakers.maxDrawdownPercent * 100).toFixed(0)}%`],
          ["Symbol Concentration", `${(c.circuitBreakers.maxSymbolConcentration * 100).toFixed(0)}%`],
        ]} />

        <ConfigSection title="Position Sizing" items={[
          ["Max Position Size", `${(c.positionSizing.maxPositionSizePercent * 100).toFixed(0)}%`],
          ["Max Concurrent Positions", c.positionSizing.maxConcurrentPositions],
          ["Kelly Fraction", c.positionSizing.kellyFraction],
          ["Max Total Exposure", `${(c.positionSizing.maxTotalExposurePercent * 100).toFixed(0)}%`],
        ]} />

        <ConfigSection title="VaR Limits" items={[
          ["Portfolio VaR(95%)", `${(c.varLimits.maxPortfolioVaR95Percent * 100).toFixed(0)}%`],
          ["Incremental VaR", `${(c.varLimits.maxIncrementalVaR95Percent * 100).toFixed(0)}%`],
          ["CVaR(95%)", `${(c.varLimits.maxPortfolioCVaR95Percent * 100).toFixed(0)}%`],
          ["Min Data Points", c.varLimits.minHistoricalDataPoints],
        ]} />

        <ConfigSection title="Correlation" items={[
          ["Threshold", c.correlation.correlationThreshold],
          ["High Corr Reduction", `${(c.correlation.highCorrelationSizeReduction * 100).toFixed(0)}%`],
          ["Very High Reduction", `${(c.correlation.veryHighCorrelationSizeReduction * 100).toFixed(0)}%`],
          ["Block Above", c.correlation.blockIfCorrelationAbove],
        ]} />

        <ConfigSection title="Exits (Base)" items={[
          ["Hard Stop", `${c.exits.hardStopLossPercent}%`],
          ["Max Loser Time", `${c.exits.maxLoserTimeMinutes} min`],
          ["Trailing Distance", `${c.exits.trailingDistancePercent}%`],
          ["ATR Stop Multiplier", `${c.exits.atrStopMultiplier}x`],
        ]} />

        <ConfigSection title="Consensus" items={[
          ["Min Strength", `${(c.consensus.minConsensusStrength * 100).toFixed(0)}%`],
          ["Min Confidence", `${(c.consensus.minConfidence * 100).toFixed(0)}%`],
          ["Min Execution Score", c.consensus.minExecutionScore],
          ["Min Agent Agreement", c.consensus.minAgentAgreement],
        ]} />
      </CardContent>
    </Card>
  );
}

// ─── Alpha Validation Panel ───
function AlphaPanel() {
  const { data, isLoading, error } = trpc.riskManagement.getAlphaValidation.useQuery(undefined, {
    refetchInterval: 30000,
    staleTime: 15000,
  });

  if (isLoading) return <Skeleton className="h-[300px] w-full" />;
  if (error || !data) return <ErrorCard title="Alpha Validation" message={error?.message || "Unavailable"} />;

  if (data.status === 'pending') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5 text-green-500" />
            Agent Alpha Validation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">Awaiting first validation run...</p>
        </CardContent>
      </Card>
    );
  }

  if (data.status !== 'complete') return <ErrorCard title="Alpha Validation" message="Error" />;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5 text-green-500" />
              Agent Alpha Validation
            </CardTitle>
            <CardDescription>{data.totalTradesAnalyzed} trades analyzed</CardDescription>
          </div>
          <div className="flex gap-1">
            <Badge variant="default">{data.agentsWithAlpha} with alpha</Badge>
            {data.agentsToPrune?.length > 0 && <Badge variant="destructive">{data.agentsToPrune.length} to prune</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2 mb-4">
          <MetricCard label="System Win Rate" value={((data.systemMetrics?.winRate ?? 0) * 100).toFixed(1)} suffix="%" status={(data.systemMetrics?.winRate ?? 0) > 0.5 ? "good" : "warning"} />
          <MetricCard label="System Sharpe" value={(data.systemMetrics?.sharpeRatio ?? 0).toFixed(2)} status={(data.systemMetrics?.sharpeRatio ?? 0) > 1 ? "good" : "warning"} />
          <MetricCard label="Profit Factor" value={(data.systemMetrics?.profitFactor ?? 0).toFixed(2)} status={(data.systemMetrics?.profitFactor ?? 0) > 1.5 ? "good" : "warning"} />
        </div>

        {data.agentReports && data.agentReports.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-1.5">Agent</th>
                  <th className="text-center p-1.5">Grade</th>
                  <th className="text-center p-1.5">Accuracy</th>
                  <th className="text-center p-1.5">Sharpe</th>
                  <th className="text-center p-1.5">Alpha</th>
                  <th className="text-right p-1.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.agentReports.map((r: any) => (
                  <tr key={r.agentName} className="border-b border-muted">
                    <td className="p-1.5 font-medium">{r.agentName}</td>
                    <td className="p-1.5 text-center">
                      <Badge variant={r.alphaGrade === 'A' || r.alphaGrade === 'B' ? 'default' : r.alphaGrade === 'F' ? 'destructive' : 'secondary'} className="text-xs">
                        {r.alphaGrade}
                      </Badge>
                    </td>
                    <td className="p-1.5 text-center">{(r.directionalAccuracy * 100).toFixed(1)}%</td>
                    <td className="p-1.5 text-center">{r.sharpeRatio.toFixed(2)}</td>
                    <td className="p-1.5 text-center">
                      {r.hasAlpha ? <CheckCircle2 className="h-3 w-3 text-green-500 inline" /> : <XCircle className="h-3 w-3 text-red-400 inline" />}
                    </td>
                    <td className="p-1.5 text-right">
                      <Badge variant="outline" className="text-[10px]">{r.recommendation}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Consensus Weights Panel ───
function ConsensusPanel() {
  const { data, isLoading, error } = trpc.riskManagement.getConsensusWeights.useQuery(undefined, {
    refetchInterval: 15000,
    staleTime: 10000,
  });

  if (isLoading) return <Skeleton className="h-[200px] w-full" />;
  if (error || !data) return <ErrorCard title="Consensus Weights" message={error?.message || "Unavailable"} />;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              Adaptive Consensus Weights
            </CardTitle>
            <CardDescription>
              {data.totalUpdates} updates &middot; {data.boostedAgents} boosted &middot; {data.prunedAgents} pruned
            </CardDescription>
          </div>
          <Badge variant={data.isActive ? "default" : "secondary"}>
            {data.isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {data.weights.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No weight adjustments yet</p>
        ) : (
          <div className="space-y-1">
            {data.weights.map((w: any) => (
              <div key={w.agentName} className="flex items-center justify-between text-sm">
                <span className="truncate max-w-[150px]">{w.agentName}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {w.baseWeight.toFixed(2)} &times; {w.alphaMultiplier.toFixed(2)} &times; {w.rollingMultiplier.toFixed(2)}
                  </span>
                  <Badge variant={w.finalWeight > 1 ? "default" : w.finalWeight < 0.5 ? "destructive" : "secondary"} className="text-xs font-mono min-w-[50px] text-center">
                    {w.finalWeight.toFixed(2)}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Shared Components ───

function MetricCard({ label, value, suffix, status, tooltip }: {
  label: string; value: string | number; suffix?: string;
  status?: "good" | "warning" | "critical"; tooltip?: string;
}) {
  const statusColors = {
    good: "text-green-500",
    warning: "text-yellow-500",
    critical: "text-red-500",
  };

  return (
    <div className="bg-muted/30 rounded-lg p-3" title={tooltip}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${status ? statusColors[status] : ""}`}>
        {value}{suffix}
      </p>
    </div>
  );
}

function LimitBar({ label, current, limit }: { label: string; current: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (current / limit) * 100) : 0;
  const color = pct < 50 ? "bg-green-500" : pct < 80 ? "bg-yellow-500" : "bg-red-500";

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{(current * 100).toFixed(1)}% / {(limit * 100).toFixed(0)}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ConfigSection({ title, items }: { title: string; items: [string, any][] }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{title}</h4>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {items.map(([key, val]) => (
          <div key={key} className="flex justify-between">
            <span className="text-muted-foreground">{key}</span>
            <span className="font-mono">{String(val)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <Card className="border-destructive/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function getCorrelationColor(corr: number, isDiagonal: boolean): string {
  if (isDiagonal) return "rgba(100,100,100,0.2)";
  const abs = Math.abs(corr);
  if (abs > 0.85) return "rgba(239,68,68,0.3)";   // red — very high
  if (abs > 0.70) return "rgba(234,179,8,0.3)";    // yellow — high
  if (abs > 0.50) return "rgba(59,130,246,0.15)";   // blue — moderate
  return "rgba(100,100,100,0.05)";                  // gray — low
}

// ─── Skeletons ───
function VaRSkeleton() { return <Card><CardContent className="pt-6"><Skeleton className="h-[200px]" /></CardContent></Card>; }
function CorrelationSkeleton() { return <Card><CardContent className="pt-6"><Skeleton className="h-[250px]" /></CardContent></Card>; }
function WalkForwardSkeleton() { return <Card><CardContent className="pt-6"><Skeleton className="h-[200px]" /></CardContent></Card>; }
function ConfigSkeleton() { return <Card><CardContent className="pt-6"><Skeleton className="h-[300px]" /></CardContent></Card>; }

// ─── Main Page ───
export default function RiskDashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const utils = trpc.useUtils();

  const refreshAll = () => {
    utils.riskManagement.getVaRStatus.invalidate();
    utils.riskManagement.getCorrelationMatrix.invalidate();
    utils.riskManagement.getWalkForwardResults.invalidate();
    utils.riskManagement.getTradingConfig.invalidate();
    utils.riskManagement.getAlphaValidation.invalidate();
    utils.riskManagement.getConsensusWeights.invalidate();
  };

  return (
    <div className="min-h-screen bg-background pt-16 sm:pt-20 pb-6 sm:pb-10 px-3 sm:px-4 md:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 sm:mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="h-7 w-7 text-blue-500" />
              Risk Management Dashboard
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Phase 16+17 risk infrastructure monitoring
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh All
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="agents">Agent Alpha</TabsTrigger>
            <TabsTrigger value="config">Configuration</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <VaRPanel />
              <CorrelationPanel />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <WalkForwardPanel />
              <ConsensusPanel />
            </div>
          </TabsContent>

          <TabsContent value="agents" className="space-y-4">
            <AlphaPanel />
          </TabsContent>

          <TabsContent value="config" className="space-y-4">
            <TradingConfigPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
