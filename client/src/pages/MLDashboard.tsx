/**
 * ML Dashboard Page
 *
 * Displays comprehensive ML system status powered by real tRPC queries:
 * - Ensemble prediction accuracy
 * - Trade predictor model status
 * - Learning system progress and retraining
 * - Training data statistics
 * - Optimization scheduler status
 * - Agent intelligence metrics (Brier scores, calibration)
 * - ML Quality Gate statistics
 *
 * All data auto-refreshes on 10-second intervals.
 */

import { useAuth } from '@/_core/hooks/useAuth';
import { SeerLoader } from '@/components/SeerLoader';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Brain,
  TrendingUp,
  Activity,
  Zap,
  Clock,
  Target,
  BarChart3,
  Cpu,
  RefreshCw,
  Play,
  CheckCircle2,
  ShieldCheck,
  Users,
  Database,
  Gauge,
} from 'lucide-react';
import { Link } from 'wouter';
import { toast } from 'sonner';

const REFETCH_INTERVAL = 10_000;

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function accuracyColor(pct: number): string {
  if (pct >= 70) return 'text-green-500';
  if (pct >= 50) return 'text-yellow-500';
  return 'text-red-500';
}

export default function MLDashboard() {
  const { loading: authLoading } = useAuth();

  // --------------- tRPC queries ---------------
  const {
    data: overview,
    isLoading: overviewLoading,
    refetch: refetchOverview,
  } = trpc.mlAnalytics.getMLOverview.useQuery(undefined, {
    refetchInterval: REFETCH_INTERVAL,
  });

  const {
    data: agentMetrics,
    isLoading: agentsLoading,
    refetch: refetchAgents,
  } = trpc.mlAnalytics.getAgentPerformanceMetrics.useQuery(undefined, {
    refetchInterval: REFETCH_INTERVAL,
  });

  const {
    data: trainingStats,
    isLoading: trainingLoading,
    refetch: refetchTraining,
  } = trpc.mlAnalytics.getTrainingDataStats.useQuery(undefined, {
    refetchInterval: REFETCH_INTERVAL,
  });

  const {
    data: gateStats,
    isLoading: gateLoading,
    refetch: refetchGate,
  } = trpc.mlAnalytics.getMLQualityGateStats.useQuery(undefined, {
    refetchInterval: REFETCH_INTERVAL,
  });

  const triggerRetraining = trpc.mlAnalytics.triggerRetraining.useMutation({
    onSuccess: () => {
      toast.success('Retraining triggered successfully');
      refetchOverview();
      refetchTraining();
    },
    onError: (err) => {
      toast.error(`Retraining failed: ${err.message}`);
    },
  });

  // --------------- Derived values (safe even when data is undefined) ---------------
  const ensembleStats = overview?.ensemblePredictor?.accuracyStats;
  const ensembleEntry = Array.isArray(ensembleStats)
    ? ensembleStats.find((s: any) => s.type?.toLowerCase() === 'ensemble')
    : undefined;
  const ensembleAccuracy =
    ensembleEntry && ensembleEntry.totalPredictions > 0
      ? (ensembleEntry.correctDirections / ensembleEntry.totalPredictions) * 100
      : null;

  const tradePredictorActive = overview?.tradePredictor?.modelAvailable === true;
  const tradePredictorSamples = overview?.tradePredictor?.trainingSamples ?? 0;

  const learningProgress =
    overview?.learningSystem && overview.learningSystem.retrainThreshold > 0
      ? (overview.learningSystem.newTradesSinceRetrain / overview.learningSystem.retrainThreshold) * 100
      : 0;
  const tradesUntilRetrain =
    overview?.learningSystem
      ? overview.learningSystem.retrainThreshold - overview.learningSystem.newTradesSinceRetrain
      : null;

  const totalTrainingData = overview?.learningSystem?.totalTrainingData ?? null;

  // Feature importance sorted descending
  const featureImportance: Array<{ name: string; value: number }> = (() => {
    const raw = overview?.tradePredictor?.featureImportance;
    if (!raw || typeof raw !== 'object') return [];
    return Object.entries(raw as Record<string, number>)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  })();

  const maxFeatureValue = featureImportance.length > 0 ? featureImportance[0].value : 1;

  // --------------- Refresh handler ---------------
  const handleRefresh = async () => {
    await Promise.all([refetchOverview(), refetchAgents(), refetchTraining(), refetchGate()]);
    toast.success('ML metrics refreshed');
  };

  // --------------- Loading states ---------------
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center space-y-6">
          <SeerLoader size="lg" />
          <p className="text-muted-foreground">Loading ML Dashboard...</p>
        </div>
      </div>
    );
  }

  const isMainLoading = overviewLoading && agentsLoading && trainingLoading && gateLoading;

  if (isMainLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center space-y-6">
          <SeerLoader size="lg" />
          <p className="text-muted-foreground">Fetching ML analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm">
                ← Dashboard
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-bold">ML Dashboard</h1>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="training">Training</TabsTrigger>
            <TabsTrigger value="optimization">Optimization</TabsTrigger>
            <TabsTrigger value="agents">Agent Intelligence</TabsTrigger>
            <TabsTrigger value="gate">ML Quality Gate</TabsTrigger>
          </TabsList>

          {/* ============================================================
              TAB 1: Overview
              ============================================================ */}
          <TabsContent value="overview" className="space-y-6">
            {/* Overview Cards (top row) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* 1. Ensemble Accuracy */}
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Ensemble Accuracy</CardDescription>
                  <CardTitle className="text-2xl flex items-center gap-2">
                    <Target className="h-5 w-5 text-primary" />
                    {ensembleAccuracy !== null ? `${ensembleAccuracy.toFixed(1)}%` : 'No data yet'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Progress value={ensembleAccuracy ?? 0} className="h-2" />
                  {ensembleEntry ? (
                    <p className="text-xs text-muted-foreground mt-2">
                      {ensembleEntry.correctDirections} / {ensembleEntry.totalPredictions} predictions
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-2">Awaiting predictions</p>
                  )}
                </CardContent>
              </Card>

              {/* 2. Trade Predictor */}
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Trade Predictor</CardDescription>
                  <CardTitle className="text-2xl flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-blue-500" />
                    {overview ? (tradePredictorActive ? 'Active' : 'Not trained') : 'No data yet'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {overview ? `${tradePredictorSamples.toLocaleString()} training samples` : '--'}
                  </p>
                </CardContent>
              </Card>

              {/* 3. Learning Progress */}
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Learning Progress</CardDescription>
                  <CardTitle className="text-2xl flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-yellow-500" />
                    {overview ? `${Math.min(learningProgress, 100).toFixed(0)}%` : 'No data yet'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Progress value={Math.min(learningProgress, 100)} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-2">
                    {tradesUntilRetrain !== null
                      ? `${Math.max(tradesUntilRetrain, 0)}/${overview?.learningSystem?.retrainThreshold ?? '?'} trades until retrain`
                      : '--'}
                  </p>
                </CardContent>
              </Card>

              {/* 4. Training Data */}
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Training Data</CardDescription>
                  <CardTitle className="text-2xl flex items-center gap-2">
                    <Database className="h-5 w-5 text-green-500" />
                    {totalTrainingData !== null ? totalTrainingData.toLocaleString() : 'No data yet'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">Total samples in learning system</p>
                </CardContent>
              </Card>
            </div>

            {/* Feature Importance (top 10) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Feature Importance (Top 10)
                </CardTitle>
                <CardDescription>Most influential features used by TradeSuccessPredictor</CardDescription>
              </CardHeader>
              <CardContent>
                {featureImportance.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data yet</p>
                ) : (
                  <div className="space-y-3">
                    {featureImportance.map((f) => (
                      <div key={f.name} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium truncate mr-4">{f.name}</span>
                          <span className="text-muted-foreground shrink-0">{f.value.toFixed(4)}</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${(f.value / maxFeatureValue) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================
              TAB 2: Models
              ============================================================ */}
          <TabsContent value="models" className="space-y-4">
            {/* Accuracy Stats per model type */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="h-5 w-5" />
                  Ensemble Predictor — Model Accuracy
                </CardTitle>
                <CardDescription>Per-model prediction statistics from EnsemblePredictor</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!ensembleStats || !Array.isArray(ensembleStats) || ensembleStats.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data yet</p>
                ) : (
                  ensembleStats.map((stat: any, idx: number) => {
                    const acc =
                      stat.totalPredictions > 0
                        ? (stat.correctDirections / stat.totalPredictions) * 100
                        : 0;
                    return (
                      <div key={idx} className="p-4 rounded-lg bg-muted/50 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-base">{stat.type ?? `Model ${idx + 1}`}</p>
                            <p className="text-xs text-muted-foreground">
                              {stat.totalPredictions} total predictions, {stat.correctDirections} correct
                            </p>
                          </div>
                          <p className={`text-xl font-bold ${stat.totalPredictions > 0 ? accuracyColor(acc) : 'text-gray-400'}`}>
                            {stat.totalPredictions > 0 ? `${acc.toFixed(1)}%` : '--'}
                          </p>
                        </div>
                        <Progress value={acc} className="h-2" />
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Avg Confidence: </span>
                            <span className="font-medium">
                              {stat.avgConfidence != null ? `${(stat.avgConfidence * 100).toFixed(1)}%` : '--'}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Avg Price Error: </span>
                            <span className="font-medium">
                              {stat.avgPriceError != null ? stat.avgPriceError.toFixed(4) : '--'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            {/* Model weights */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Gauge className="h-5 w-5" />
                  Model Weights
                </CardTitle>
                <CardDescription>Current ensemble weighting between LSTM and Transformer</CardDescription>
              </CardHeader>
              <CardContent>
                {overview?.ensemblePredictor ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg border">
                      <p className="text-sm text-muted-foreground mb-1">LSTM Weight</p>
                      <p className="text-2xl font-bold">
                        {overview.ensemblePredictor.lstmWeight != null
                          ? overview.ensemblePredictor.lstmWeight.toFixed(3)
                          : '--'}
                      </p>
                    </div>
                    <div className="p-4 rounded-lg border">
                      <p className="text-sm text-muted-foreground mb-1">Transformer Weight</p>
                      <p className="text-2xl font-bold">
                        {overview.ensemblePredictor.transformerWeight != null
                          ? overview.ensemblePredictor.transformerWeight.toFixed(3)
                          : '--'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No data yet</p>
                )}
              </CardContent>
            </Card>

            {/* Trade Success Predictor card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  TradeSuccessPredictor
                </CardTitle>
                <CardDescription>Model that predicts probability of trade success</CardDescription>
              </CardHeader>
              <CardContent>
                {overview?.tradePredictor ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-lg border">
                      <p className="text-sm text-muted-foreground mb-1">Model Status</p>
                      <Badge variant={tradePredictorActive ? 'default' : 'outline'}>
                        {tradePredictorActive ? 'Active' : 'Not trained'}
                      </Badge>
                    </div>
                    <div className="p-4 rounded-lg border">
                      <p className="text-sm text-muted-foreground mb-1">Feature Count</p>
                      <p className="text-2xl font-bold">
                        {overview.tradePredictor.featureCount ?? '--'}
                      </p>
                    </div>
                    <div className="p-4 rounded-lg border">
                      <p className="text-sm text-muted-foreground mb-1">Training Samples</p>
                      <p className="text-2xl font-bold">{tradePredictorSamples.toLocaleString()}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No data yet</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================
              TAB 3: Training
              ============================================================ */}
          <TabsContent value="training" className="space-y-4">
            {/* LearningSystem retrain progress */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Learning System — Retrain Progress
                </CardTitle>
                <CardDescription>Automatic retraining triggered after enough new trades</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {overview?.learningSystem ? (
                  <>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span>
                        {overview.learningSystem.newTradesSinceRetrain} /{' '}
                        {overview.learningSystem.retrainThreshold} trades
                      </span>
                      <span className="text-muted-foreground">
                        {Math.min(learningProgress, 100).toFixed(0)}%
                      </span>
                    </div>
                    <Progress value={Math.min(learningProgress, 100)} className="h-3" />
                    <Button
                      variant="default"
                      className="mt-4"
                      disabled={triggerRetraining.isPending}
                      onClick={() => triggerRetraining.mutate()}
                    >
                      {triggerRetraining.isPending ? (
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4 mr-2" />
                      )}
                      Retrain Now
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No data yet</p>
                )}
              </CardContent>
            </Card>

            {/* Training Data Stats */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  Training Data Statistics
                </CardTitle>
                <CardDescription>Breakdown of training data by regime and quality grade</CardDescription>
              </CardHeader>
              <CardContent>
                {trainingLoading ? (
                  <SeerLoader size="sm" text="Loading training stats..." />
                ) : !trainingStats ? (
                  <p className="text-sm text-muted-foreground">No data yet</p>
                ) : (
                  <div className="space-y-6">
                    <div className="p-4 rounded-lg border">
                      <p className="text-sm text-muted-foreground mb-1">Total Rows</p>
                      <p className="text-3xl font-bold">{trainingStats.totalRows.toLocaleString()}</p>
                    </div>

                    {/* By Regime */}
                    {trainingStats.byMarketRegime && Object.keys(trainingStats.byMarketRegime).length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-3">By Market Regime</h4>
                        <div className="space-y-2">
                          {Object.entries(trainingStats.byMarketRegime).map(([regime, count]) => {
                            const pct = trainingStats.totalRows > 0 ? ((count as number) / trainingStats.totalRows) * 100 : 0;
                            return (
                              <div key={regime} className="space-y-1">
                                <div className="flex items-center justify-between text-sm">
                                  <span className="capitalize">{regime}</span>
                                  <span className="text-muted-foreground">
                                    {(count as number).toLocaleString()} ({pct.toFixed(1)}%)
                                  </span>
                                </div>
                                <div className="h-2 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-blue-500 rounded-full transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* By Quality */}
                    {trainingStats.byTradeQualityScore && Object.keys(trainingStats.byTradeQualityScore).length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-3">By Quality Grade</h4>
                        <div className="space-y-2">
                          {Object.entries(trainingStats.byTradeQualityScore).map(([grade, count]) => {
                            const pct = trainingStats.totalRows > 0 ? ((count as number) / trainingStats.totalRows) * 100 : 0;
                            return (
                              <div key={grade} className="space-y-1">
                                <div className="flex items-center justify-between text-sm">
                                  <span className="capitalize">{grade}</span>
                                  <span className="text-muted-foreground">
                                    {(count as number).toLocaleString()} ({pct.toFixed(1)}%)
                                  </span>
                                </div>
                                <div className="h-2 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-green-500 rounded-full transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================
              TAB 4: Optimization
              ============================================================ */}
          <TabsContent value="optimization" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Optimization Scheduler
                </CardTitle>
                <CardDescription>Scheduled optimization tasks and their results</CardDescription>
              </CardHeader>
              <CardContent>
                {!overview?.optimizationScheduler ? (
                  <p className="text-sm text-muted-foreground">No data yet</p>
                ) : (
                  <div className="space-y-4">
                    {/* Schedule entries */}
                    {Array.isArray(overview.optimizationScheduler.schedules) &&
                    overview.optimizationScheduler.schedules.length > 0 ? (
                      overview.optimizationScheduler.schedules.map((schedule: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between p-4 rounded-lg border">
                          <div className="flex items-center gap-4">
                            <div
                              className={`w-3 h-3 rounded-full shrink-0 ${
                                schedule.enabled ? 'bg-green-500' : 'bg-gray-500'
                              }`}
                            />
                            <div>
                              <p className="font-medium">{schedule.type}</p>
                              <p className="text-xs text-muted-foreground">
                                Last run: {formatDate(schedule.lastRun)}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            {schedule.lastResult?.score != null ? (
                              <p className="text-lg font-bold text-green-500">
                                {(schedule.lastResult.score * 100).toFixed(1)}%
                              </p>
                            ) : (
                              <p className="text-lg font-bold text-gray-400">--</p>
                            )}
                            <Badge variant={schedule.enabled ? 'default' : 'outline'} className="mt-1">
                              {schedule.enabled ? 'Enabled' : 'Disabled'}
                            </Badge>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No schedules configured</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Current optimized parameters */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Current Optimized Parameters
                </CardTitle>
                <CardDescription>Live parameter values produced by the optimizer</CardDescription>
              </CardHeader>
              <CardContent>
                {!overview?.optimizationScheduler?.currentParameters ? (
                  <p className="text-sm text-muted-foreground">No data yet</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {Object.entries(overview.optimizationScheduler.currentParameters).map(
                      ([key, value]) => (
                        <div key={key} className="p-3 rounded-lg border">
                          <p className="text-xs text-muted-foreground truncate">{key}</p>
                          <p className="text-lg font-bold mt-1">
                            {typeof value === 'number' ? value.toFixed(4) : String(value ?? '--')}
                          </p>
                        </div>
                      )
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent optimization history */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Recent Optimization History
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!overview?.optimizationScheduler?.history ||
                !Array.isArray(overview.optimizationScheduler.history) ||
                overview.optimizationScheduler.history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data yet</p>
                ) : (
                  <div className="space-y-2">
                    {overview.optimizationScheduler.history.map((entry: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 text-sm">
                        <div>
                          <span className="font-medium">{entry.type ?? 'Optimization'}</span>
                          <span className="text-muted-foreground ml-2">{formatDate(entry.timestamp)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {entry.score != null && (
                            <span className="font-bold">{(entry.score * 100).toFixed(1)}%</span>
                          )}
                          {entry.success != null && (
                            <Badge variant={entry.success ? 'default' : 'destructive'}>
                              {entry.success ? 'Success' : 'Failed'}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================
              TAB 5: Agent Intelligence
              ============================================================ */}
          <TabsContent value="agents" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Agent Performance Metrics
                </CardTitle>
                <CardDescription>
                  Brier scores, calibration, and weight adjustments for all agents
                </CardDescription>
              </CardHeader>
              <CardContent>
                {agentsLoading ? (
                  <SeerLoader size="sm" text="Loading agent metrics..." />
                ) : !agentMetrics || agentMetrics.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data yet</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="pb-3 pr-4 font-semibold">Agent</th>
                          <th className="pb-3 pr-4 font-semibold text-right">Accuracy</th>
                          <th className="pb-3 pr-4 font-semibold text-right">Brier Score</th>
                          <th className="pb-3 pr-4 font-semibold text-right">Calibration</th>
                          <th className="pb-3 pr-4 font-semibold text-right">Samples</th>
                          <th className="pb-3 pr-4 font-semibold text-right">Recent Acc.</th>
                          <th className="pb-3 font-semibold text-right">Weight Adj.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agentMetrics.map((agent: any, idx: number) => {
                          const accPct = (agent.accuracy ?? 0) * 100;
                          const recentPct = (agent.recentAccuracy ?? 0) * 100;
                          return (
                            <tr key={idx} className="border-b border-muted/30 hover:bg-muted/20">
                              <td className="py-3 pr-4 font-medium">{agent.agentName}</td>
                              <td className={`py-3 pr-4 text-right font-bold ${accuracyColor(accPct)}`}>
                                {accPct.toFixed(1)}%
                              </td>
                              <td className="py-3 pr-4 text-right">
                                {agent.brierScore != null ? agent.brierScore.toFixed(4) : '--'}
                              </td>
                              <td className="py-3 pr-4 text-right">
                                {agent.calibration != null ? agent.calibration.toFixed(4) : '--'}
                              </td>
                              <td className="py-3 pr-4 text-right">{agent.samples ?? 0}</td>
                              <td className={`py-3 pr-4 text-right font-bold ${accuracyColor(recentPct)}`}>
                                {recentPct.toFixed(1)}%
                              </td>
                              <td className="py-3 text-right">
                                {agent.weightAdjustment != null ? (
                                  <span
                                    className={
                                      agent.weightAdjustment > 0
                                        ? 'text-green-500'
                                        : agent.weightAdjustment < 0
                                        ? 'text-red-500'
                                        : 'text-gray-400'
                                    }
                                  >
                                    {agent.weightAdjustment > 0 ? '+' : ''}
                                    {agent.weightAdjustment.toFixed(4)}
                                  </span>
                                ) : (
                                  '--'
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================
              TAB 6: ML Quality Gate
              ============================================================ */}
          <TabsContent value="gate" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5" />
                  ML Quality Gate Statistics
                </CardTitle>
                <CardDescription>
                  How the ML quality gate filters and adjusts trade signals
                </CardDescription>
              </CardHeader>
              <CardContent>
                {gateLoading ? (
                  <SeerLoader size="sm" text="Loading quality gate stats..." />
                ) : !gateStats ? (
                  <p className="text-sm text-muted-foreground">No data yet</p>
                ) : (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div className="p-4 rounded-lg border">
                        <p className="text-sm text-muted-foreground">Total Checked</p>
                        <p className="text-3xl font-bold mt-1">{gateStats.totalChecked.toLocaleString()}</p>
                      </div>
                      <div className="p-4 rounded-lg border">
                        <p className="text-sm text-muted-foreground">Model Available</p>
                        <p className="text-3xl font-bold mt-1">{gateStats.modelAvailable.toLocaleString()}</p>
                      </div>
                      <div className="p-4 rounded-lg border">
                        <p className="text-sm text-muted-foreground">Position Reduced</p>
                        <p className="text-3xl font-bold mt-1 text-yellow-500">
                          {gateStats.positionReduced.toLocaleString()}
                        </p>
                      </div>
                      <div className="p-4 rounded-lg border">
                        <p className="text-sm text-muted-foreground">Full Size Passed</p>
                        <p className="text-3xl font-bold mt-1 text-green-500">
                          {gateStats.fullSizePassed.toLocaleString()}
                        </p>
                      </div>
                      <div className="p-4 rounded-lg border">
                        <p className="text-sm text-muted-foreground">Normal Passed</p>
                        <p className="text-3xl font-bold mt-1">{gateStats.normalPassed.toLocaleString()}</p>
                      </div>
                      <div className="p-4 rounded-lg border">
                        <p className="text-sm text-muted-foreground">Avg Success Probability</p>
                        <p className="text-3xl font-bold mt-1 text-primary">
                          {gateStats.avgSuccessProbability != null
                            ? `${(gateStats.avgSuccessProbability * 100).toFixed(1)}%`
                            : '--'}
                        </p>
                      </div>
                    </div>

                    {/* Visual summary bar */}
                    {gateStats.totalChecked > 0 && (
                      <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                        <h4 className="text-sm font-semibold">Gate Outcome Distribution</h4>
                        <div className="flex h-4 rounded-full overflow-hidden">
                          {gateStats.fullSizePassed > 0 && (
                            <div
                              className="bg-green-500"
                              title={`Full Size Passed: ${gateStats.fullSizePassed}`}
                              style={{
                                width: `${(gateStats.fullSizePassed / gateStats.totalChecked) * 100}%`,
                              }}
                            />
                          )}
                          {gateStats.normalPassed > 0 && (
                            <div
                              className="bg-blue-500"
                              title={`Normal Passed: ${gateStats.normalPassed}`}
                              style={{
                                width: `${(gateStats.normalPassed / gateStats.totalChecked) * 100}%`,
                              }}
                            />
                          )}
                          {gateStats.positionReduced > 0 && (
                            <div
                              className="bg-yellow-500"
                              title={`Position Reduced: ${gateStats.positionReduced}`}
                              style={{
                                width: `${(gateStats.positionReduced / gateStats.totalChecked) * 100}%`,
                              }}
                            />
                          )}
                        </div>
                        <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Full Size
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Normal
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> Reduced
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
