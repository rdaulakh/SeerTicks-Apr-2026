/**
 * Regime Intelligence Dashboard — Phase 34 + Phase 36
 *
 * Comprehensive regime monitoring panel:
 * - Current regime with confidence (Phase 34)
 * - Regime transition smoothing status (Phase 34)
 * - Active/skipped agents per regime (Phase 34)
 * - Effective vs base parameter values (Phase 34)
 * - Monte Carlo visualization (Phase 36)
 * - Conviction heatmap (Phase 36)
 * - Regime performance tracking (Phase 36)
 *
 * Auto-refreshes every 5 seconds.
 */
import { useAuth } from '@/_core/hooks/useAuth';
import { SeerLoader } from '@/components/SeerLoader';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, Cell, Legend,
  Tooltip as RTooltip,
} from 'recharts';
import {
  Gauge, Activity, Shield, Clock, TrendingUp, TrendingDown, Zap,
  Eye, EyeOff, ArrowRight, BarChart3, Target, Timer, Layers, Bot,
  AlertTriangle, Dice5, Grid3X3, Trophy, ArrowUpDown,
} from 'lucide-react';

const REFETCH_INTERVAL = 5_000;

// Regime display config
const REGIME_META: Record<string, { label: string; color: string; bgColor: string; hex: string; icon: React.ReactNode }> = {
  trending_up: { label: 'Trending Up', color: 'text-green-400', bgColor: 'bg-green-500/10 border-green-500/20', hex: '#4ade80', icon: <TrendingUp className="w-5 h-5 text-green-400" /> },
  trending_down: { label: 'Trending Down', color: 'text-red-400', bgColor: 'bg-red-500/10 border-red-500/20', hex: '#f87171', icon: <TrendingDown className="w-5 h-5 text-red-400" /> },
  range_bound: { label: 'Range Bound', color: 'text-yellow-400', bgColor: 'bg-yellow-500/10 border-yellow-500/20', hex: '#facc15', icon: <Activity className="w-5 h-5 text-yellow-400" /> },
  high_volatility: { label: 'High Volatility', color: 'text-orange-400', bgColor: 'bg-orange-500/10 border-orange-500/20', hex: '#fb923c', icon: <Zap className="w-5 h-5 text-orange-400" /> },
  breakout: { label: 'Breakout', color: 'text-cyan-400', bgColor: 'bg-cyan-500/10 border-cyan-500/20', hex: '#22d3ee', icon: <Target className="w-5 h-5 text-cyan-400" /> },
  mean_reverting: { label: 'Mean Reverting', color: 'text-purple-400', bgColor: 'bg-purple-500/10 border-purple-500/20', hex: '#c084fc', icon: <BarChart3 className="w-5 h-5 text-purple-400" /> },
};

function getRegimeMeta(regime: string) {
  return REGIME_META[regime] || { label: regime, color: 'text-muted-foreground', bgColor: 'bg-muted/50 border-border', hex: '#94a3b8', icon: <Activity className="w-5 h-5" /> };
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

export default function RegimeDashboard() {
  const { loading: authLoading } = useAuth();

  const { data, isLoading, error } = trpc.pipeline.getRegimeDashboard.useQuery(
    { symbol: 'BTC-USD' },
    { refetchInterval: REFETCH_INTERVAL }
  );

  if (authLoading || isLoading) return <SeerLoader text="Loading Regime Intelligence..." />;

  if (error || !data?.success) {
    return (
      <div className="container py-8">
        <div className="flex items-center gap-3 mb-6">
          <Gauge className="w-8 h-8 text-primary" />
          <h1 className="text-2xl font-bold">Regime Intelligence</h1>
        </div>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              <span>Failed to load regime data: {(data as any)?.error || error?.message || 'Unknown error'}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const d = data;
  const meta = getRegimeMeta(d.regime || 'unknown');
  const isSmoothing = d.isTransitioning && d.transitionState;

  return (
    <TooltipProvider>
      <div className="container py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Gauge className="w-7 h-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Regime Intelligence</h1>
              <p className="text-sm text-muted-foreground">
                Real-time market regime analysis for {d.symbol}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            Auto-refresh: 5s
          </Badge>
        </div>

        {/* Current Regime Hero */}
        <Card className={`border ${meta.bgColor}`}>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-background/50">{meta.icon}</div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Current Regime</p>
                  <p className={`text-2xl font-bold ${meta.color}`}>{meta.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Age: {formatAge(d.regimeAge || 0)}
                    {d.previousRegime && <span> · Prev: {getRegimeMeta(d.previousRegime).label}</span>}
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Regime Confidence</span>
                    <span className="font-mono">{((d.regimeConfidence || 0) * 100).toFixed(1)}%</span>
                  </div>
                  <Progress value={(d.regimeConfidence || 0) * 100} className="h-2" />
                </div>
                <div className="flex gap-4 text-xs">
                  <div>
                    <span className="text-muted-foreground">Volatility: </span>
                    <Badge variant="outline" className="text-xs capitalize">{d.volatilityClass}</Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Trend: </span>
                    <span className="font-mono">{((d.trendStrength || 0) * 100).toFixed(0)}% {d.trendDirection}</span>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Key Drivers</p>
                <div className="flex flex-wrap gap-1">
                  {(d.keyDrivers || []).slice(0, 5).map((driver: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-xs">{driver}</Badge>
                  ))}
                  {(!d.keyDrivers || d.keyDrivers.length === 0) && (
                    <span className="text-xs text-muted-foreground">No drivers detected</span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Transition Smoothing Banner */}
        {isSmoothing && d.transitionState && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3 mb-2">
                <Timer className="w-5 h-5 text-amber-400 animate-pulse" />
                <span className="font-semibold text-amber-300">Regime Transition Active</span>
              </div>
              <div className="flex items-center gap-2 text-sm mb-2">
                <Badge variant="outline" className={getRegimeMeta(d.transitionState.from).color}>
                  {getRegimeMeta(d.transitionState.from).label}
                </Badge>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
                <Badge variant="outline" className={getRegimeMeta(d.transitionState.to).color}>
                  {getRegimeMeta(d.transitionState.to).label}
                </Badge>
                <span className="text-xs text-muted-foreground ml-2">
                  {formatMs(d.transitionState.elapsed)} / {formatMs(d.transitionState.gracePeriodMs)}
                </span>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Blending Progress</span>
                  <span className="font-mono">{((d.transitionState.progress || 0) * 100).toFixed(0)}%</span>
                </div>
                <Progress value={(d.transitionState.progress || 0) * 100} className="h-2" />
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="parameters" className="space-y-4">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="parameters">Parameters</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="montecarlo">Monte Carlo</TabsTrigger>
            <TabsTrigger value="conviction">Conviction</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="regimes">All Regimes</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          {/* Tab 1: Effective Parameters */}
          <TabsContent value="parameters" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <ParameterCard title="Stop-Loss ATR Multiplier" icon={<Shield className="w-4 h-4 text-red-400" />}
                effective={d.effectiveValues?.stopLossAtrMultiplier} base={d.baseValues?.stopLossAtrMultiplier}
                unit="x" description="ATR multiplier for dynamic stop-loss distance" isSmoothing={!!isSmoothing} />
              <ParameterCard title="Take-Profit R:R Ratio" icon={<Target className="w-4 h-4 text-green-400" />}
                effective={d.effectiveValues?.takeProfitRrRatio} base={d.baseValues?.takeProfitRrRatio}
                unit="x" description="Risk:reward ratio for take-profit levels" isSmoothing={!!isSmoothing} />
              <ParameterCard title="Trade Cooldown" icon={<Clock className="w-4 h-4 text-blue-400" />}
                effective={d.effectiveValues?.tradeCooldownMs} base={d.baseValues?.tradeCooldownMs}
                unit="ms" format={formatMs} description="Minimum interval between approved signals" isSmoothing={!!isSmoothing} />
              <ParameterCard title="Position Size Multiplier" icon={<Layers className="w-4 h-4 text-purple-400" />}
                effective={d.effectiveValues?.positionSizeMultiplier} base={d.baseValues?.positionSizeMultiplier}
                unit="x" description="Regime-based position sizing adjustment" isSmoothing={!!isSmoothing} />
              <ParameterCard title="Consensus Threshold" icon={<Gauge className="w-4 h-4 text-cyan-400" />}
                effective={d.effectiveValues?.consensusThresholdMultiplier} base={d.baseValues?.consensusThresholdMultiplier}
                unit="x" description="Multiplier applied to base consensus threshold" isSmoothing={!!isSmoothing} />
            </div>
          </TabsContent>

          {/* Tab 2: Active/Skipped Agents */}
          <TabsContent value="agents" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Eye className="w-4 h-4 text-green-400" />
                    Active Agents ({(d.activeAgents || []).length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(d.activeAgents || []).map((agent: string) => {
                      const weight = (d.agentWeights as Record<string, number>)?.[agent] || 1.0;
                      return (
                        <div key={agent} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-green-500/5 border border-green-500/10">
                          <div className="flex items-center gap-2">
                            <Bot className="w-3.5 h-3.5 text-green-400" />
                            <span className="text-sm">{agent}</span>
                          </div>
                          <Badge variant="outline" className="text-xs font-mono">{weight.toFixed(2)}x</Badge>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <EyeOff className="w-4 h-4 text-red-400" />
                    Skipped Agents ({(d.skipAgents || []).length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(d.skipAgents || []).map((agent: string) => (
                      <div key={agent} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-red-500/5 border border-red-500/10">
                        <div className="flex items-center gap-2">
                          <Bot className="w-3.5 h-3.5 text-red-400 opacity-50" />
                          <span className="text-sm text-muted-foreground line-through">{agent}</span>
                        </div>
                        <Badge variant="outline" className="text-xs text-red-400 border-red-500/20">Skipped</Badge>
                      </div>
                    ))}
                    {(!d.skipAgents || d.skipAgents.length === 0) && (
                      <div className="text-center py-6">
                        <Eye className="w-8 h-8 text-green-400 mx-auto mb-2 opacity-50" />
                        <p className="text-sm text-muted-foreground">All agents active in this regime</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Tab 3: Monte Carlo Visualization */}
          <TabsContent value="montecarlo" className="space-y-4">
            <MonteCarloTab regime={d.regime || 'unknown'} />
          </TabsContent>

          {/* Tab 4: Conviction Heatmap */}
          <TabsContent value="conviction" className="space-y-4">
            <ConvictionHeatmapTab />
          </TabsContent>

          {/* Tab 5: Regime Performance */}
          <TabsContent value="performance" className="space-y-4">
            <RegimePerformanceTab />
          </TabsContent>

          {/* Tab 6: All Regime Configs */}
          <TabsContent value="regimes" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(d.allRegimeConfigs || {}).map(([regime, config]: [string, any]) => {
                const rmeta = getRegimeMeta(regime);
                const isActive = regime === d.regime;
                return (
                  <Card key={regime} className={`${isActive ? rmeta.bgColor + ' border' : 'border-border/50'}`}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {rmeta.icon}
                          <span className={isActive ? rmeta.color : ''}>{rmeta.label}</span>
                        </div>
                        {isActive && <Badge className="text-xs bg-primary/20 text-primary border-primary/30">Active</Badge>}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Consensus Threshold</span>
                        <span className="font-mono">{config.consensusThreshold?.toFixed(2)}x</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Position Size</span>
                        <span className="font-mono">{config.positionSize?.toFixed(2)}x</span>
                      </div>
                      <div className="mt-2">
                        <p className="text-muted-foreground mb-1">Top Agents:</p>
                        <div className="flex flex-wrap gap-1">
                          {(config.topAgents || []).map((a: string, i: number) => (
                            <Badge key={i} variant="secondary" className="text-xs font-mono">{a}</Badge>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* Tab 7: Regime History */}
          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Regime History (Last 20 transitions)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(d.regimeHistory || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No regime transitions recorded yet</p>
                ) : (
                  <div className="space-y-1">
                    {[...(d.regimeHistory || [])].reverse().map((entry: any, i: number) => {
                      const rmeta = getRegimeMeta(entry.regime);
                      const ts = new Date(entry.timestamp);
                      const age = Date.now() - entry.timestamp;
                      return (
                        <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: rmeta.hex }} />
                          <span className={`text-sm font-medium ${rmeta.color} min-w-[140px]`}>{rmeta.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <span className="text-xs text-muted-foreground ml-auto">{formatAge(age)} ago</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

// ============================================================
// Sub-components
// ============================================================

function ParameterCard({ title, icon, effective, base, unit, format, description, isSmoothing }: {
  title: string; icon: React.ReactNode; effective?: number; base?: number;
  unit: string; format?: (v: number) => string; description: string; isSmoothing: boolean;
}) {
  const effVal = effective ?? 0;
  const baseVal = base ?? 0;
  const isBlended = isSmoothing && Math.abs(effVal - baseVal) > 0.001;
  const displayEff = format ? format(effVal) : `${effVal.toFixed(2)}${unit}`;
  const displayBase = format ? format(baseVal) : `${baseVal.toFixed(2)}${unit}`;

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 mb-3">
          {icon}
          <span className="text-sm font-medium">{title}</span>
          {isBlended && (
            <Badge variant="outline" className="text-xs text-amber-400 border-amber-500/20 ml-auto">Blending</Badge>
          )}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono">{displayEff}</span>
          {isBlended && <span className="text-xs text-muted-foreground">(base: {displayBase})</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Monte Carlo Tab
// ============================================================

function MonteCarloTab({ regime }: { regime: string }) {
  const [mcParams] = useState({
    currentPrice: 85000,
    direction: 'long' as const,
    regime,
    strength: 0.6,
    atrPercent: 2.5,
  });

  const mcMutation = trpc.pipeline.runMonteCarlo.useMutation();

  const runSimulation = () => {
    mcMutation.mutate({ ...mcParams, regime });
  };

  const mcData = mcMutation.data;
  const mc = mcData?.success ? (mcData as any).monteCarlo : null;

  // Build histogram data
  const histogramData = useMemo(() => {
    if (!mc?.returnDistribution) return [];
    const minR = mc.p10 - 5;
    const maxR = mc.p90 + 5;
    const binWidth = (maxR - minR) / 20;
    return mc.returnDistribution.map((count: number, i: number) => ({
      bin: `${(minR + i * binWidth).toFixed(1)}%`,
      count,
      isNegative: (minR + i * binWidth) < 0,
    }));
  }, [mc]);

  // Build sample paths data
  const pathsData = useMemo(() => {
    if (!mc?.samplePaths || mc.samplePaths.length === 0) return [];
    const numSteps = mc.samplePaths[0].length;
    const data: any[] = [];
    for (let step = 0; step < numSteps; step++) {
      const point: any = { step };
      mc.samplePaths.forEach((path: number[], pathIdx: number) => {
        point[`path${pathIdx}`] = path[step];
      });
      data.push(point);
    }
    return data;
  }, [mc]);

  const pathColors = ['#4ade80', '#f87171', '#60a5fa', '#facc15', '#c084fc', '#fb923c', '#22d3ee', '#f472b6', '#a3e635', '#818cf8'];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Dice5 className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">Monte Carlo Simulation</h3>
        </div>
        <Button onClick={runSimulation} disabled={mcMutation.isPending} size="sm">
          {mcMutation.isPending ? 'Simulating...' : 'Run Simulation'}
        </Button>
      </div>

      {!mc && !mcMutation.isPending && (
        <Card className="border-dashed">
          <CardContent className="pt-6 text-center py-12">
            <Dice5 className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-30" />
            <p className="text-muted-foreground">Click "Run Simulation" to generate Monte Carlo projections</p>
            <p className="text-xs text-muted-foreground mt-1">500 random walks using {getRegimeMeta(regime).label} regime parameters</p>
          </CardContent>
        </Card>
      )}

      {mc && (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <MetricCard label="Win Probability" value={`${(mc.probabilityOfProfit * 100).toFixed(1)}%`}
              color={mc.probabilityOfProfit > 0.5 ? 'text-green-400' : 'text-red-400'} />
            <MetricCard label="Expected Return" value={`${mc.expectedReturn > 0 ? '+' : ''}${mc.expectedReturn}%`}
              color={mc.expectedReturn > 0 ? 'text-green-400' : 'text-red-400'} />
            <MetricCard label="VaR (95%)" value={`${mc.valueAtRisk95}%`} color="text-red-400" />
            <MetricCard label="CVaR (95%)" value={`${mc.conditionalVaR95}%`} color="text-red-400" />
            <MetricCard label="Sharpe Ratio" value={mc.sharpeRatio.toFixed(2)} color="text-cyan-400" />
            <MetricCard label="Max Drawdown" value={`${mc.maxDrawdown}%`} color="text-orange-400" />
          </div>

          {/* Percentile Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Return Percentiles</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-3 text-center">
                {[
                  { label: 'P10 (Bear)', value: mc.p10, color: 'text-red-400' },
                  { label: 'P25', value: mc.p25, color: 'text-orange-400' },
                  { label: 'P50 (Median)', value: mc.p50, color: 'text-yellow-400' },
                  { label: 'P75', value: mc.p75, color: 'text-green-400' },
                  { label: 'P90 (Bull)', value: mc.p90, color: 'text-emerald-400' },
                ].map((p) => (
                  <div key={p.label} className="py-3 px-2 rounded-lg bg-muted/30">
                    <p className="text-xs text-muted-foreground mb-1">{p.label}</p>
                    <p className={`text-lg font-bold font-mono ${p.color}`}>
                      {p.value > 0 ? '+' : ''}{p.value}%
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Return Distribution Histogram */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Return Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histogramData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                      <XAxis dataKey="bin" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} interval={3} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <RTooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                        {histogramData.map((entry: any, idx: number) => (
                          <Cell key={idx} fill={entry.isNegative ? '#f87171' : '#4ade80'} opacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Sample Paths */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Sample Price Paths ({mc.samplePaths?.length || 0} shown)</CardTitle>
              </CardHeader>
              <CardContent>
                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={pathsData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                      <XAxis dataKey="step" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} label={{ value: 'Steps', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} domain={['auto', 'auto']} />
                      <RTooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                      {(mc.samplePaths || []).map((_: any, idx: number) => (
                        <Line key={idx} type="monotone" dataKey={`path${idx}`} stroke={pathColors[idx % pathColors.length]}
                          strokeWidth={1.5} dot={false} opacity={0.7} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Additional Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Skewness" value={mc.skewness.toFixed(2)} color="text-muted-foreground" />
            <MetricCard label="Kurtosis" value={mc.kurtosis.toFixed(2)} color="text-muted-foreground" />
            <MetricCard label="Optimal Exit Step" value={`Step ${mc.optimalExitStep}`} color="text-cyan-400" />
            <MetricCard label="Holding Period" value={`${mc.avgHoldingPeriodMinutes}m`} color="text-muted-foreground" />
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="py-3 px-3 rounded-lg bg-muted/20 border border-border/50">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-base font-bold font-mono ${color}`}>{value}</p>
    </div>
  );
}

// ============================================================
// Conviction Heatmap Tab
// ============================================================

function ConvictionHeatmapTab() {
  const { data, isLoading } = trpc.pipeline.getConvictionHeatmap.useQuery(
    undefined,
    { refetchInterval: REFETCH_INTERVAL }
  );

  if (isLoading) return <SeerLoader text="Loading conviction data..." />;

  if (!data?.success || !data.symbols || data.symbols.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6 text-center py-12">
          <Grid3X3 className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-30" />
          <p className="text-muted-foreground">No conviction data available yet</p>
          <p className="text-xs text-muted-foreground mt-1">Data populates as analysis cycles complete</p>
        </CardContent>
      </Card>
    );
  }

  const { heatmap, symbols, agents } = data as any;

  const getConvictionColor = (conviction: number, signal: string): string => {
    if (signal === 'neutral') return 'bg-zinc-800/50';
    const intensity = Math.min(conviction, 1);
    if (signal === 'bullish') {
      if (intensity > 0.7) return 'bg-green-500/60';
      if (intensity > 0.4) return 'bg-green-500/35';
      return 'bg-green-500/15';
    }
    if (signal === 'bearish') {
      if (intensity > 0.7) return 'bg-red-500/60';
      if (intensity > 0.4) return 'bg-red-500/35';
      return 'bg-red-500/15';
    }
    return 'bg-muted/30';
  };

  const getSignalIcon = (signal: string) => {
    if (signal === 'bullish') return <TrendingUp className="w-3 h-3 text-green-400" />;
    if (signal === 'bearish') return <TrendingDown className="w-3 h-3 text-red-400" />;
    return <ArrowUpDown className="w-3 h-3 text-muted-foreground" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Grid3X3 className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold">Agent Conviction Heatmap</h3>
        <span className="text-xs text-muted-foreground ml-2">
          {symbols.length} symbol{symbols.length !== 1 ? 's' : ''} · {agents.length} agent{agents.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-green-500/60" />
          <span>Strong Bullish</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-green-500/20" />
          <span>Weak Bullish</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-zinc-800/50" />
          <span>Neutral</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-red-500/20" />
          <span>Weak Bearish</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-red-500/60" />
          <span>Strong Bearish</span>
        </div>
      </div>

      {/* Heatmap Grid */}
      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-left py-2 px-2 text-muted-foreground font-medium sticky left-0 bg-card z-10">Symbol</th>
                {agents.map((agent: string) => (
                  <th key={agent} className="py-2 px-1 text-muted-foreground font-medium text-center whitespace-nowrap">
                    <Tooltip>
                      <TooltipTrigger>
                        <span className="truncate max-w-[80px] inline-block">{agent.replace('Agent', '').replace('Analyst', '')}</span>
                      </TooltipTrigger>
                      <TooltipContent><p>{agent}</p></TooltipContent>
                    </Tooltip>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {symbols.map((symbol: string) => (
                <tr key={symbol} className="border-t border-border/30">
                  <td className="py-1.5 px-2 font-mono font-medium sticky left-0 bg-card z-10">{symbol}</td>
                  {agents.map((agent: string) => {
                    const cell = heatmap[symbol]?.[agent];
                    if (!cell) {
                      return <td key={agent} className="py-1.5 px-1 text-center"><div className="w-full h-8 rounded bg-muted/10" /></td>;
                    }
                    return (
                      <td key={agent} className="py-1.5 px-1 text-center">
                        <Tooltip>
                          <TooltipTrigger className="w-full">
                            <div className={`flex items-center justify-center gap-1 h-8 rounded ${getConvictionColor(cell.conviction, cell.signal)}`}>
                              {getSignalIcon(cell.signal)}
                              <span className="font-mono text-xs">{(cell.conviction * 100).toFixed(0)}%</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs space-y-1">
                              <p className="font-medium">{agent} → {symbol}</p>
                              <p>Signal: {cell.signal} ({(cell.conviction * 100).toFixed(1)}%)</p>
                              <p>Consecutive: {cell.consecutiveCycles} cycles</p>
                              <p>Flips: {cell.flipCount}</p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Regime Performance Tab
// ============================================================

function RegimePerformanceTab() {
  const { data, isLoading } = trpc.pipeline.getRegimePerformance.useQuery(
    undefined,
    { refetchInterval: 10_000 }
  );

  if (isLoading) return <SeerLoader text="Loading performance data..." />;

  if (!data?.success || !('totalTrades' in data) || (data as any).totalTrades === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6 text-center py-12">
          <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-30" />
          <p className="text-muted-foreground">No trade performance data yet</p>
          <p className="text-xs text-muted-foreground mt-1">Data populates as trades are closed</p>
        </CardContent>
      </Card>
    );
  }

  const { regimeStats, bestRegime, worstRegime, overallWinRate, totalTrades, recentTrades } = data as any;

  // Build chart data
  const chartData = Object.entries(regimeStats || {}).map(([regime, stats]: [string, any]) => ({
    name: getRegimeMeta(regime).label,
    regime,
    winRate: Math.round(stats.winRate * 100),
    avgPnl: stats.avgPnlPercent,
    totalPnl: stats.totalPnl,
    trades: stats.totalTrades,
    profitFactor: stats.profitFactor,
    sharpe: stats.sharpeRatio,
    avgRR: stats.avgRiskReward,
    fill: getRegimeMeta(regime).hex,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">Regime Performance</h3>
          <Badge variant="outline" className="text-xs ml-2">{totalTrades} trades</Badge>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">Overall Win Rate:</span>
          <span className={`font-bold font-mono ${overallWinRate > 0.5 ? 'text-green-400' : 'text-red-400'}`}>
            {(overallWinRate * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Best/Worst Regime Badges */}
      <div className="flex gap-3">
        {bestRegime !== 'none' && (
          <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-green-500/10 border border-green-500/20">
            <Trophy className="w-4 h-4 text-green-400" />
            <span className="text-xs text-muted-foreground">Best:</span>
            <span className="text-sm font-medium text-green-400">{getRegimeMeta(bestRegime).label}</span>
            <span className="text-xs font-mono text-green-400">
              {(regimeStats[bestRegime]?.winRate * 100).toFixed(0)}% WR
            </span>
          </div>
        )}
        {worstRegime !== 'none' && (
          <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-xs text-muted-foreground">Worst:</span>
            <span className="text-sm font-medium text-red-400">{getRegimeMeta(worstRegime).label}</span>
            <span className="text-xs font-mono text-red-400">
              {(regimeStats[worstRegime]?.winRate * 100).toFixed(0)}% WR
            </span>
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Win Rate by Regime */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Win Rate by Regime</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} width={100} />
                  <RTooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    formatter={(value: any) => [`${value}%`, 'Win Rate']} />
                  <Bar dataKey="winRate" radius={[0, 4, 4, 0]}>
                    {chartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} opacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* PnL by Regime */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Avg PnL% by Regime</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} width={100} />
                  <RTooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    formatter={(value: any) => [`${value}%`, 'Avg PnL']} />
                  <Bar dataKey="avgPnl" radius={[0, 4, 4, 0]}>
                    {chartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.avgPnl >= 0 ? '#4ade80' : '#f87171'} opacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Stats Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Detailed Regime Statistics</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 px-2 text-muted-foreground">Regime</th>
                <th className="text-right py-2 px-2 text-muted-foreground">Trades</th>
                <th className="text-right py-2 px-2 text-muted-foreground">Win Rate</th>
                <th className="text-right py-2 px-2 text-muted-foreground">Avg R:R</th>
                <th className="text-right py-2 px-2 text-muted-foreground">Total PnL</th>
                <th className="text-right py-2 px-2 text-muted-foreground">Profit Factor</th>
                <th className="text-right py-2 px-2 text-muted-foreground">Sharpe</th>
                <th className="text-right py-2 px-2 text-muted-foreground">Best</th>
                <th className="text-right py-2 px-2 text-muted-foreground">Worst</th>
                <th className="text-right py-2 px-2 text-muted-foreground">Max Win Streak</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(regimeStats || {}).map(([regime, stats]: [string, any]) => {
                const rmeta = getRegimeMeta(regime);
                return (
                  <tr key={regime} className="border-b border-border/20 hover:bg-muted/20">
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: rmeta.hex }} />
                        <span className={`font-medium ${rmeta.color}`}>{rmeta.label}</span>
                      </div>
                    </td>
                    <td className="text-right py-2 px-2 font-mono">{stats.totalTrades}</td>
                    <td className={`text-right py-2 px-2 font-mono font-medium ${stats.winRate > 0.5 ? 'text-green-400' : 'text-red-400'}`}>
                      {(stats.winRate * 100).toFixed(1)}%
                    </td>
                    <td className="text-right py-2 px-2 font-mono">{stats.avgRiskReward.toFixed(2)}</td>
                    <td className={`text-right py-2 px-2 font-mono font-medium ${stats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ${stats.totalPnl.toFixed(2)}
                    </td>
                    <td className="text-right py-2 px-2 font-mono">{stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}</td>
                    <td className="text-right py-2 px-2 font-mono">{stats.sharpeRatio.toFixed(2)}</td>
                    <td className="text-right py-2 px-2 font-mono text-green-400">+{stats.bestTrade.toFixed(2)}%</td>
                    <td className="text-right py-2 px-2 font-mono text-red-400">{stats.worstTrade.toFixed(2)}%</td>
                    <td className="text-right py-2 px-2 font-mono">{stats.maxConsecutiveWins}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Recent Trades */}
      {recentTrades && recentTrades.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recent Trades ({recentTrades.length})</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 px-2 text-muted-foreground">Time</th>
                  <th className="text-left py-2 px-2 text-muted-foreground">Symbol</th>
                  <th className="text-left py-2 px-2 text-muted-foreground">Regime</th>
                  <th className="text-center py-2 px-2 text-muted-foreground">Direction</th>
                  <th className="text-right py-2 px-2 text-muted-foreground">PnL%</th>
                  <th className="text-right py-2 px-2 text-muted-foreground">PnL</th>
                  <th className="text-right py-2 px-2 text-muted-foreground">R:R</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((trade: any, i: number) => {
                  const rmeta = getRegimeMeta(trade.regime);
                  return (
                    <tr key={i} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="py-1.5 px-2 text-muted-foreground">
                        {new Date(trade.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-1.5 px-2 font-mono font-medium">{trade.symbol}</td>
                      <td className="py-1.5 px-2">
                        <Badge variant="outline" className={`text-xs ${rmeta.color}`}>{rmeta.label}</Badge>
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <Badge variant={trade.direction === 'long' ? 'default' : 'destructive'} className="text-xs">
                          {trade.direction}
                        </Badge>
                      </td>
                      <td className={`py-1.5 px-2 text-right font-mono font-medium ${trade.pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {trade.pnlPercent >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                      </td>
                      <td className={`py-1.5 px-2 text-right font-mono ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${trade.pnl.toFixed(2)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono">{trade.riskRewardActual.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
