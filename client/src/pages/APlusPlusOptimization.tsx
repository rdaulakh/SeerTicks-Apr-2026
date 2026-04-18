/**
 * A++ Grade Optimization Dashboard
 * 
 * This page provides the interface for the continuous improvement cycle:
 * - Run backtests with A++ grade parameters
 * - Analyze losses and identify root causes
 * - Run automated parameter optimization
 * - Monitor quality gate status
 * - Track progress toward A++ grade
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { 
  Play, 
  RefreshCw, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle,
  CheckCircle,
  XCircle,
  Target,
  Zap,
  BarChart3,
  Settings,
  ArrowRight,
  Loader2
} from 'lucide-react';

export default function APlusPlusOptimization() {
  const [activeTab, setActiveTab] = useState('overview');
  
  // Queries
  const { data: gradeRequirements, isLoading: loadingRequirements } = 
    trpc.aplusPlus.getGradeRequirements.useQuery();
  const { data: qualityGateStatus, isLoading: loadingQualityGate, refetch: refetchQualityGate } = 
    trpc.aplusPlus.getQualityGateStatus.useQuery();
  const { data: latestBacktest, isLoading: loadingBacktest, refetch: refetchBacktest } = 
    trpc.aplusPlus.getLatestBacktest.useQuery();
  const { data: latestOptimization, refetch: refetchOptimization } = 
    trpc.aplusPlus.getLatestOptimization.useQuery();

  // Mutations
  const runBacktestMutation = trpc.aplusPlus.runBacktest.useMutation({
    onSuccess: () => {
      refetchBacktest();
      refetchQualityGate();
    },
  });
  const analyzeLossesMutation = trpc.aplusPlus.analyzeLosses.useMutation();
  const runOptimizationMutation = trpc.aplusPlus.runOptimization.useMutation({
    onSuccess: () => {
      refetchOptimization();
      refetchBacktest();
    },
  });
  const runContinuousImprovementMutation = trpc.aplusPlus.runContinuousImprovement.useMutation({
    onSuccess: () => {
      refetchBacktest();
      refetchOptimization();
    },
  });

  const getGradeBadgeColor = (grade: string) => {
    switch (grade) {
      case 'A++': return 'bg-gradient-to-r from-yellow-400 to-amber-500 text-black';
      case 'A+': return 'bg-gradient-to-r from-green-400 to-emerald-500 text-white';
      case 'A': return 'bg-green-500 text-white';
      case 'B': return 'bg-blue-500 text-white';
      case 'C': return 'bg-yellow-500 text-black';
      case 'D': return 'bg-orange-500 text-white';
      case 'F': return 'bg-red-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const currentMetrics = gradeRequirements?.currentMetrics;
  const requirements = gradeRequirements?.requirements;

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-3 sm:p-4 lg:p-6 space-y-4 lg:space-y-6">
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">A++ Grade Optimization</h1>
            <p className="text-muted-foreground mt-1">
              Continuous improvement cycle: Backtest → Analyze → Fix → Retest
            </p>
          </div>
          <div className="flex items-center gap-3">
            {currentMetrics && (
              <Badge className={`text-lg px-4 py-2 ${getGradeBadgeColor(currentMetrics.currentGrade)}`}>
                Current Grade: {currentMetrics.currentGrade}
              </Badge>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Run Backtest</p>
                  <p className="text-xs text-muted-foreground mt-1">Test current parameters</p>
                </div>
                <Button 
                  size="sm" 
                  onClick={() => runBacktestMutation.mutate({})}
                  disabled={runBacktestMutation.isPending}
                >
                  {runBacktestMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Analyze Losses</p>
                  <p className="text-xs text-muted-foreground mt-1">Find root causes</p>
                </div>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => analyzeLossesMutation.mutate()}
                  disabled={analyzeLossesMutation.isPending || !latestBacktest?.success}
                >
                  {analyzeLossesMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BarChart3 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Optimize</p>
                  <p className="text-xs text-muted-foreground mt-1">Auto-tune parameters</p>
                </div>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => runOptimizationMutation.mutate({})}
                  disabled={runOptimizationMutation.isPending}
                >
                  {runOptimizationMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Settings className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Full Cycle</p>
                  <p className="text-xs text-muted-foreground mt-1">Run improvement loop</p>
                </div>
                <Button 
                  size="sm" 
                  onClick={() => runContinuousImprovementMutation.mutate({})}
                  disabled={runContinuousImprovementMutation.isPending}
                  className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
                >
                  {runContinuousImprovementMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="backtest">Backtest Results</TabsTrigger>
            <TabsTrigger value="analysis">Loss Analysis</TabsTrigger>
            <TabsTrigger value="quality-gate">Quality Gate</TabsTrigger>
            <TabsTrigger value="optimization">Optimization</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Grade Requirements */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-amber-500" />
                    Grade Requirements
                  </CardTitle>
                  <CardDescription>Metrics needed for each grade level</CardDescription>
                </CardHeader>
                <CardContent>
                  {requirements && (
                    <div className="space-y-4">
                      {Object.entries(requirements).map(([grade, reqs]: [string, any]) => (
                        <div key={grade} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                          <Badge className={getGradeBadgeColor(grade)}>{grade}</Badge>
                          <div className="text-sm text-right">
                            <p>Win Rate: ≥{(reqs.winRate * 100).toFixed(0)}%</p>
                            <p>Profit Factor: ≥{reqs.profitFactor.toFixed(1)}</p>
                            <p>Max DD: ≤{(reqs.maxDrawdown * 100).toFixed(0)}%</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Current Performance */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-blue-500" />
                    Current Performance
                  </CardTitle>
                  <CardDescription>Latest backtest metrics</CardDescription>
                </CardHeader>
                <CardContent>
                  {currentMetrics ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Win Rate</span>
                        <div className="flex items-center gap-2">
                          <Progress value={currentMetrics.winRate * 100} className="w-24" />
                          <span className="font-mono">{(currentMetrics.winRate * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Profit Factor</span>
                        <span className="font-mono">{currentMetrics.profitFactor.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Sharpe Ratio</span>
                        <span className="font-mono">{currentMetrics.sharpeRatio.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Max Drawdown</span>
                        <span className="font-mono text-red-400">{(currentMetrics.maxDrawdown * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>No backtest data available</p>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="mt-4"
                        onClick={() => runBacktestMutation.mutate({})}
                      >
                        Run First Backtest
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Improvement Path */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ArrowRight className="h-5 w-5 text-green-500" />
                  Path to A++ Grade
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-4">
                  {['F', 'D', 'C', 'B', 'A', 'A+', 'A++'].map((grade, index) => (
                    <div key={grade} className="flex items-center">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold ${
                        currentMetrics?.currentGrade === grade 
                          ? getGradeBadgeColor(grade) 
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {grade}
                      </div>
                      {index < 6 && (
                        <ArrowRight className="h-4 w-4 mx-2 text-muted-foreground" />
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Backtest Results Tab */}
          <TabsContent value="backtest" className="space-y-4">
            {latestBacktest?.success && latestBacktest.result ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-muted-foreground">Total Trades</div>
                      <div className="text-2xl font-bold">{latestBacktest.result.totalTrades}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-muted-foreground">Win Rate</div>
                      <div className="text-2xl font-bold text-green-500">
                        {(latestBacktest.result.winRate * 100).toFixed(1)}%
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-muted-foreground">Total P&L</div>
                      <div className={`text-2xl font-bold ${latestBacktest.result.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        ${latestBacktest.result.totalPnL.toFixed(2)}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-muted-foreground">Profit Factor</div>
                      <div className="text-2xl font-bold">{latestBacktest.result.profitFactor.toFixed(2)}</div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>Quality Gate Blocks</CardTitle>
                    <CardDescription>Trades blocked by A++ grade filters</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-sm text-muted-foreground">Macro Veto</div>
                        <div className="text-xl font-bold">{latestBacktest.result.tradesBlockedByMacroVeto}</div>
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-sm text-muted-foreground">Regime Filter</div>
                        <div className="text-xl font-bold">{latestBacktest.result.tradesBlockedByRegimeFilter}</div>
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-sm text-muted-foreground">Consensus</div>
                        <div className="text-xl font-bold">{latestBacktest.result.tradesBlockedByConsensus}</div>
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-sm text-muted-foreground">Confidence</div>
                        <div className="text-xl font-bold">{latestBacktest.result.tradesBlockedByConfidence}</div>
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-sm text-muted-foreground">Agent Agreement</div>
                        <div className="text-xl font-bold">{latestBacktest.result.tradesBlockedByAgentAgreement}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <p className="text-muted-foreground">No backtest results available</p>
                  <Button 
                    className="mt-4"
                    onClick={() => runBacktestMutation.mutate({})}
                    disabled={runBacktestMutation.isPending}
                  >
                    {runBacktestMutation.isPending ? 'Running...' : 'Run Backtest'}
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Loss Analysis Tab */}
          <TabsContent value="analysis" className="space-y-4">
            {analyzeLossesMutation.data?.success && analyzeLossesMutation.data.analysis ? (
              <>
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Top Causes of Losses</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc list-inside mt-2">
                      {analyzeLossesMutation.data.analysis.topCauses.map((cause: string, i: number) => (
                        <li key={i}>{cause}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>

                <Card>
                  <CardHeader>
                    <CardTitle>Priority Actions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {analyzeLossesMutation.data.analysis.priorityActions.map((action: any, i: number) => (
                        <div key={i} className={`p-3 rounded-lg border ${
                          action.priority === 'critical' ? 'border-red-500 bg-red-500/10' :
                          action.priority === 'high' ? 'border-orange-500 bg-orange-500/10' :
                          action.priority === 'medium' ? 'border-yellow-500 bg-yellow-500/10' :
                          'border-blue-500 bg-blue-500/10'
                        }`}>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="uppercase">{action.priority}</Badge>
                            <span className="font-medium">{action.action}</span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{action.expectedImpact}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>AI Analysis</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <pre className="whitespace-pre-wrap text-sm">{analyzeLossesMutation.data.analysis.aiAnalysis}</pre>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <p className="text-muted-foreground">Run loss analysis to identify root causes</p>
                  <Button 
                    className="mt-4"
                    onClick={() => analyzeLossesMutation.mutate()}
                    disabled={analyzeLossesMutation.isPending || !latestBacktest?.success}
                  >
                    {analyzeLossesMutation.isPending ? 'Analyzing...' : 'Analyze Losses'}
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Quality Gate Tab */}
          <TabsContent value="quality-gate" className="space-y-4">
            {qualityGateStatus && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>A++ Grade Thresholds</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span>Consensus Threshold</span>
                        <Badge variant="outline">{(qualityGateStatus.config.consensusThreshold * 100).toFixed(0)}%</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Confidence Threshold</span>
                        <Badge variant="outline">{(qualityGateStatus.config.confidenceThreshold * 100).toFixed(0)}%</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Min Agent Agreement</span>
                        <Badge variant="outline">{qualityGateStatus.config.minAgentAgreement} agents</Badge>
                      </div>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <span>Macro Veto</span>
                        {qualityGateStatus.config.enableMacroVeto ? (
                          <Badge className="bg-green-500">ENABLED</Badge>
                        ) : (
                          <Badge variant="destructive">DISABLED</Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Regime Filter</span>
                        {qualityGateStatus.config.enableRegimeFilter ? (
                          <Badge className="bg-green-500">ENABLED</Badge>
                        ) : (
                          <Badge variant="destructive">DISABLED</Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Gate Statistics</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span>Total Checks</span>
                        <span className="font-mono">{qualityGateStatus.stats.totalChecks}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Passed</span>
                        <span className="font-mono text-green-500">{qualityGateStatus.stats.passed}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Rejected</span>
                        <span className="font-mono text-red-500">{qualityGateStatus.stats.rejected}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Pass Rate</span>
                        <Badge variant="outline">{qualityGateStatus.stats.passRate}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        {qualityGateStatus.macroTrend.direction === 'bullish' ? (
                          <TrendingUp className="h-5 w-5 text-green-500" />
                        ) : qualityGateStatus.macroTrend.direction === 'bearish' ? (
                          <TrendingDown className="h-5 w-5 text-red-500" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-yellow-500" />
                        )}
                        Macro Trend
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span>Direction</span>
                        <Badge className={
                          qualityGateStatus.macroTrend.direction === 'bullish' ? 'bg-green-500' :
                          qualityGateStatus.macroTrend.direction === 'bearish' ? 'bg-red-500' :
                          'bg-yellow-500'
                        }>
                          {qualityGateStatus.macroTrend.direction.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Confidence</span>
                        <span>{(qualityGateStatus.macroTrend.confidence * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Regime</span>
                        <span>{qualityGateStatus.macroTrend.regime}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Veto Active</span>
                        {qualityGateStatus.macroTrend.vetoActive ? (
                          <XCircle className="h-5 w-5 text-red-500" />
                        ) : (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Market Regime</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span>Current Regime</span>
                        <Badge variant="outline">{qualityGateStatus.regime.regime}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Confidence</span>
                        <span>{(qualityGateStatus.regime.confidence * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Allowed Actions</span>
                        <div className="flex gap-1">
                          {qualityGateStatus.regime.allowedActions.length > 0 ? (
                            qualityGateStatus.regime.allowedActions.map((action: string) => (
                              <Badge key={action} variant="outline">{action.toUpperCase()}</Badge>
                            ))
                          ) : (
                            <Badge variant="destructive">NONE</Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Data Fresh</span>
                        {qualityGateStatus.regime.isFresh ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-yellow-500" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </TabsContent>

          {/* Optimization Tab */}
          <TabsContent value="optimization" className="space-y-4">
            {latestOptimization?.success && latestOptimization.result ? (
              <>
                <Alert className={latestOptimization.result.success ? 'border-green-500' : 'border-yellow-500'}>
                  {latestOptimization.result.success ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  )}
                  <AlertTitle>
                    {latestOptimization.result.success ? 'Target Achieved!' : 'Optimization Complete'}
                  </AlertTitle>
                  <AlertDescription>
                    Final Grade: {latestOptimization.result.finalGrade} | 
                    Iterations: {latestOptimization.result.totalIterations} | 
                    Improvement: {(latestOptimization.result.totalImprovement * 100).toFixed(1)}%
                  </AlertDescription>
                </Alert>

                <Card>
                  <CardHeader>
                    <CardTitle>Optimized Parameters</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-sm text-muted-foreground">Consensus</div>
                        <div className="text-xl font-bold">
                          {(latestOptimization.result.optimizedParameters.consensusThreshold * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-sm text-muted-foreground">Confidence</div>
                        <div className="text-xl font-bold">
                          {(latestOptimization.result.optimizedParameters.confidenceThreshold * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-sm text-muted-foreground">Min Agents</div>
                        <div className="text-xl font-bold">
                          {latestOptimization.result.optimizedParameters.minAgentAgreement}
                        </div>
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-sm text-muted-foreground">Macro Veto</div>
                        <div className="text-xl font-bold">
                          {latestOptimization.result.optimizedParameters.enableMacroVeto ? '✓' : '✗'}
                        </div>
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-sm text-muted-foreground">Regime Filter</div>
                        <div className="text-xl font-bold">
                          {latestOptimization.result.optimizedParameters.enableRegimeFilter ? '✓' : '✗'}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="whitespace-pre-wrap text-sm">{latestOptimization.result.summary}</pre>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <p className="text-muted-foreground">Run optimization to find best parameters</p>
                  <Button 
                    className="mt-4"
                    onClick={() => runOptimizationMutation.mutate({})}
                    disabled={runOptimizationMutation.isPending}
                  >
                    {runOptimizationMutation.isPending ? 'Optimizing...' : 'Start Optimization'}
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
