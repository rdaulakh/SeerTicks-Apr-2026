/**
 * Advanced AI/ML Dashboard
 * 
 * Provides interface for:
 * - Reinforcement Learning trading agents
 * - Neural network price predictions
 * - Self-optimizing parameter tuning
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
  Brain, 
  TrendingUp, 
  Settings2, 
  Activity, 
  Zap,
  Target,
  BarChart3,
  RefreshCw,
  Play,
  Pause,
  CheckCircle,
  XCircle,
  Clock,
  Cpu,
  Network,
  Layers
} from 'lucide-react';
import { toast } from 'sonner';

export default function AdvancedAI() {
  const [activeTab, setActiveTab] = useState('overview');
  
  // Fetch dashboard summary
  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = 
    trpc.advancedAI.getDashboardSummary.useQuery(undefined, {
      refetchInterval: 30000
    });
  
  // Fetch RL models
  const { data: rlModels, isLoading: modelsLoading, refetch: refetchModels } = 
    trpc.advancedAI.getRLModels.useQuery();
  
  // Fetch prediction accuracy
  const { data: predictionAccuracy } = trpc.advancedAI.getPredictionAccuracy.useQuery();
  
  // Fetch optimization history
  const { data: optimizationHistory } = trpc.advancedAI.getOptimizationHistory.useQuery({
    limit: 10
  });
  
  // Fetch active optimizations
  const { data: activeOptimizations } = trpc.advancedAI.getActiveOptimizations.useQuery();
  
  // Mutations
  const createAgent = trpc.advancedAI.createRLAgent.useMutation({
    onSuccess: () => {
      toast.success('RL Agent created successfully');
      refetchModels();
      refetchSummary();
    },
    onError: (error) => {
      toast.error(`Failed to create agent: ${error.message}`);
    }
  });
  
  const startOptimization = trpc.advancedAI.startOptimization.useMutation({
    onSuccess: (data) => {
      toast.success(`Optimization started (Task ID: ${data.taskId})`);
    },
    onError: (error) => {
      toast.error(`Failed to start optimization: ${error.message}`);
    }
  });
  
  const handleCreateDQNAgent = () => {
    createAgent.mutate({
      name: `DQN-BTC-${Date.now()}`,
      agentType: 'dqn',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      config: {
        stateSize: 20,
        actionSize: 4,
        hiddenSize: 128,
        learningRate: 0.001,
        gamma: 0.99
      }
    });
  };
  
  const handleCreatePPOAgent = () => {
    createAgent.mutate({
      name: `PPO-BTC-${Date.now()}`,
      agentType: 'ppo',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      config: {
        stateSize: 20,
        actionSize: 4,
        hiddenSize: 128,
        learningRate: 0.0003,
        gamma: 0.99
      }
    });
  };
  
  const handleStartOptimization = (type: 'strategy_params' | 'agent_weights' | 'risk_params' | 'ml_hyperparams') => {
    startOptimization.mutate({
      type,
      targetMetric: type === 'strategy_params' ? 'sharpe' : 'accuracy',
      maxIterations: 50
    });
  };
  
  if (summaryLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Brain className="h-8 w-8 text-primary" />
            Advanced AI/ML
          </h1>
          <p className="text-muted-foreground mt-1">
            Reinforcement Learning, Neural Networks & Self-Optimization
          </p>
        </div>
        <Button variant="outline" onClick={() => { refetchSummary(); refetchModels(); }}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>
      
      {/* System Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className={summary?.systemHealth.rlSystemReady ? 'border-green-500/50' : 'border-yellow-500/50'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              RL System
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{summary?.rlAgents.total || 0}</p>
                <p className="text-xs text-muted-foreground">Total Agents</p>
              </div>
              <Badge variant={summary?.systemHealth.rlSystemReady ? 'default' : 'secondary'}>
                {summary?.systemHealth.rlSystemReady ? 'Ready' : 'Setup Required'}
              </Badge>
            </div>
          </CardContent>
        </Card>
        
        <Card className={summary?.systemHealth.predictionSystemReady ? 'border-green-500/50' : 'border-yellow-500/50'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Network className="h-4 w-4" />
              Prediction System
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{typeof summary?.predictions?.accuracy === 'number' && !isNaN(summary.predictions.accuracy) ? summary.predictions.accuracy : 0}%</p>
                <p className="text-xs text-muted-foreground">Accuracy</p>
              </div>
              <Badge variant="default">Active</Badge>
            </div>
          </CardContent>
        </Card>
        
        <Card className={summary?.systemHealth.optimizationSystemReady ? 'border-green-500/50' : 'border-yellow-500/50'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Optimization
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{summary?.optimization.activeCount || 0}</p>
                <p className="text-xs text-muted-foreground">Active Tasks</p>
              </div>
              <Badge variant="default">Ready</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="rl-agents" className="flex items-center gap-2">
            <Brain className="h-4 w-4" />
            RL Agents
          </TabsTrigger>
          <TabsTrigger value="predictions" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Predictions
          </TabsTrigger>
          <TabsTrigger value="optimization" className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Optimization
          </TabsTrigger>
        </TabsList>
        
        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* RL Agents Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  Reinforcement Learning
                </CardTitle>
                <CardDescription>
                  DQN and PPO trading agents
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <p className="text-3xl font-bold text-blue-500">{summary?.rlAgents.types.dqn || 0}</p>
                    <p className="text-sm text-muted-foreground">DQN Agents</p>
                  </div>
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <p className="text-3xl font-bold text-purple-500">{summary?.rlAgents.types.ppo || 0}</p>
                    <p className="text-sm text-muted-foreground">PPO Agents</p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Active Agents</span>
                  <span className="font-medium">{summary?.rlAgents.active || 0} / {summary?.rlAgents.total || 0}</span>
                </div>
              </CardContent>
            </Card>
            
            {/* Neural Network Predictions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="h-5 w-5" />
                  Neural Network Predictions
                </CardTitle>
                <CardDescription>
                  LSTM + Transformer ensemble
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <p className="text-3xl font-bold text-green-500">{summary?.predictions.totalPredictions || 0}</p>
                    <p className="text-sm text-muted-foreground">Total Predictions</p>
                  </div>
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <p className="text-3xl font-bold text-amber-500">{summary?.predictions.avgConfidence || 0}</p>
                    <p className="text-sm text-muted-foreground">Avg Confidence</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">LSTM Weight</span>
                    <span className="font-medium">{((summary?.predictions.modelWeights?.lstm || 0.5) * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Transformer Weight</span>
                    <span className="font-medium">{((summary?.predictions.modelWeights?.transformer || 0.5) * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Button 
                  variant="outline" 
                  className="h-auto py-4 flex flex-col items-center gap-2"
                  onClick={handleCreateDQNAgent}
                  disabled={createAgent.isPending}
                >
                  <Brain className="h-6 w-6 text-blue-500" />
                  <span>Create DQN Agent</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="h-auto py-4 flex flex-col items-center gap-2"
                  onClick={handleCreatePPOAgent}
                  disabled={createAgent.isPending}
                >
                  <Brain className="h-6 w-6 text-purple-500" />
                  <span>Create PPO Agent</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="h-auto py-4 flex flex-col items-center gap-2"
                  onClick={() => handleStartOptimization('strategy_params')}
                  disabled={startOptimization.isPending}
                >
                  <Target className="h-6 w-6 text-green-500" />
                  <span>Optimize Strategy</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="h-auto py-4 flex flex-col items-center gap-2"
                  onClick={() => handleStartOptimization('agent_weights')}
                  disabled={startOptimization.isPending}
                >
                  <Settings2 className="h-6 w-6 text-amber-500" />
                  <span>Optimize Weights</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* RL Agents Tab */}
        <TabsContent value="rl-agents" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Reinforcement Learning Agents</h2>
            <div className="flex gap-2">
              <Button onClick={handleCreateDQNAgent} disabled={createAgent.isPending}>
                <Brain className="h-4 w-4 mr-2" />
                New DQN Agent
              </Button>
              <Button variant="outline" onClick={handleCreatePPOAgent} disabled={createAgent.isPending}>
                <Brain className="h-4 w-4 mr-2" />
                New PPO Agent
              </Button>
            </div>
          </div>
          
          {modelsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : rlModels && rlModels.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rlModels.map((model) => (
                <Card key={model.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{model.name}</CardTitle>
                      <Badge variant={
                        model.status === 'live' ? 'default' :
                        model.status === 'paper_trading' ? 'secondary' :
                        model.status === 'ready' ? 'outline' :
                        'destructive'
                      }>
                        {model.status}
                      </Badge>
                    </div>
                    <CardDescription>
                      {model.agentType.toUpperCase()} • {model.symbol} • {model.timeframe}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {model.performance && (
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-muted-foreground">Sharpe</p>
                          <p className="font-medium">{model.performance.sharpeRatio.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Win Rate</p>
                          <p className="font-medium">{(model.performance.winRate * 100).toFixed(1)}%</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Max DD</p>
                          <p className="font-medium text-red-500">
                            {(model.performance.maxDrawdown * 100).toFixed(1)}%
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Trades</p>
                          <p className="font-medium">{model.performance.tradeCount}</p>
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2 mt-4">
                      <Button size="sm" variant="outline" className="flex-1">
                        <Play className="h-3 w-3 mr-1" />
                        Train
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1">
                        <BarChart3 className="h-3 w-3 mr-1" />
                        Evaluate
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Brain className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No RL Agents Yet</h3>
                <p className="text-muted-foreground text-center mb-4">
                  Create your first reinforcement learning trading agent to get started.
                </p>
                <div className="flex gap-2">
                  <Button onClick={handleCreateDQNAgent}>Create DQN Agent</Button>
                  <Button variant="outline" onClick={handleCreatePPOAgent}>Create PPO Agent</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        
        {/* Predictions Tab */}
        <TabsContent value="predictions" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* LSTM Model */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-blue-500" />
                  LSTM Model
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <p className="text-3xl font-bold">
                    {predictionAccuracy?.lstm?.totalPredictions 
                      ? ((predictionAccuracy.lstm.correctDirections / predictionAccuracy.lstm.totalPredictions) * 100).toFixed(1)
                      : '0'}%
                  </p>
                  <p className="text-sm text-muted-foreground">Direction Accuracy</p>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Predictions</span>
                    <span>{predictionAccuracy?.lstm?.totalPredictions || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avg Confidence</span>
                    <span>{(predictionAccuracy?.lstm?.avgConfidence || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Calibration</span>
                    <span>{(predictionAccuracy?.lstm?.calibrationScore || 1).toFixed(2)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {/* Transformer Model */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Network className="h-5 w-5 text-purple-500" />
                  Transformer Model
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <p className="text-3xl font-bold">
                    {predictionAccuracy?.transformer?.totalPredictions 
                      ? ((predictionAccuracy.transformer.correctDirections / predictionAccuracy.transformer.totalPredictions) * 100).toFixed(1)
                      : '0'}%
                  </p>
                  <p className="text-sm text-muted-foreground">Direction Accuracy</p>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Predictions</span>
                    <span>{predictionAccuracy?.transformer?.totalPredictions || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avg Confidence</span>
                    <span>{(predictionAccuracy?.transformer?.avgConfidence || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Calibration</span>
                    <span>{(predictionAccuracy?.transformer?.calibrationScore || 1).toFixed(2)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {/* Ensemble Model */}
            <Card className="border-primary/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-green-500" />
                  Ensemble Model
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <p className="text-3xl font-bold text-green-500">
                    {predictionAccuracy?.ensemble?.totalPredictions 
                      ? ((predictionAccuracy.ensemble.correctDirections / predictionAccuracy.ensemble.totalPredictions) * 100).toFixed(1)
                      : '0'}%
                  </p>
                  <p className="text-sm text-muted-foreground">Direction Accuracy</p>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Predictions</span>
                    <span>{predictionAccuracy?.ensemble?.totalPredictions || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avg Confidence</span>
                    <span>{(predictionAccuracy?.ensemble?.avgConfidence || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Calibration</span>
                    <span>{(predictionAccuracy?.ensemble?.calibrationScore || 1).toFixed(2)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Model Weights */}
          <Card>
            <CardHeader>
              <CardTitle>Adaptive Model Weights</CardTitle>
              <CardDescription>
                Weights are automatically adjusted based on recent prediction accuracy
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">LSTM Weight</span>
                    <span className="text-sm text-muted-foreground">
                      {((predictionAccuracy?.modelWeights?.lstm || 0.5) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <Progress value={(predictionAccuracy?.modelWeights?.lstm || 0.5) * 100} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">Transformer Weight</span>
                    <span className="text-sm text-muted-foreground">
                      {((predictionAccuracy?.modelWeights?.transformer || 0.5) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <Progress value={(predictionAccuracy?.modelWeights?.transformer || 0.5) * 100} className="h-2" />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Optimization Tab */}
        <TabsContent value="optimization" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Self-Optimizing Parameters</h2>
          </div>
          
          {/* Optimization Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => handleStartOptimization('strategy_params')}>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <Target className="h-10 w-10 text-green-500 mb-3" />
                  <h3 className="font-medium">Strategy Parameters</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Optimize consensus thresholds, stop-loss, take-profit
                  </p>
                </div>
              </CardContent>
            </Card>
            
            <Card className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => handleStartOptimization('agent_weights')}>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <Settings2 className="h-10 w-10 text-blue-500 mb-3" />
                  <h3 className="font-medium">Agent Weights</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Optimize signal agent contribution weights
                  </p>
                </div>
              </CardContent>
            </Card>
            
            <Card className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => handleStartOptimization('risk_params')}>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <Activity className="h-10 w-10 text-amber-500 mb-3" />
                  <h3 className="font-medium">Risk Parameters</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Optimize position sizing and risk limits
                  </p>
                </div>
              </CardContent>
            </Card>
            
            <Card className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => handleStartOptimization('ml_hyperparams')}>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <Cpu className="h-10 w-10 text-purple-500 mb-3" />
                  <h3 className="font-medium">ML Hyperparameters</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Optimize neural network architecture
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Active Optimizations */}
          {activeOptimizations && activeOptimizations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  Active Optimizations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {activeOptimizations.map((task) => (
                    <div key={task.id} className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{task.type.replace('_', ' ')}</span>
                          <Badge variant="secondary">{task.targetMetric}</Badge>
                        </div>
                        <Progress value={task.progress} className="h-2 mt-2" />
                      </div>
                      <span className="text-sm text-muted-foreground">{task.progress.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* Optimization History */}
          <Card>
            <CardHeader>
              <CardTitle>Optimization History</CardTitle>
            </CardHeader>
            <CardContent>
              {optimizationHistory && optimizationHistory.length > 0 ? (
                <div className="space-y-2">
                  {optimizationHistory.map((opt) => (
                    <div key={opt.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-3">
                        {opt.status === 'completed' ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : opt.status === 'failed' ? (
                          <XCircle className="h-5 w-5 text-red-500" />
                        ) : (
                          <Clock className="h-5 w-5 text-amber-500" />
                        )}
                        <div>
                          <p className="font-medium">{opt.type.replace('_', ' ')}</p>
                          <p className="text-sm text-muted-foreground">
                            Target: {opt.targetMetric}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        {opt.bestScore !== null && (
                          <p className="font-medium text-green-500">
                            Score: {opt.bestScore.toFixed(4)}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          {new Date(opt.startTime).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No optimization history yet. Start an optimization to see results here.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
