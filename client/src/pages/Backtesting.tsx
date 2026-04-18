import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  Play,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Target,
  Shield,
  Zap,
  Settings,
  FileText,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  Layers,
  Sparkles,
  ArrowRight,
  Trophy,
  Activity,
} from 'lucide-react';

// Preset card component
function PresetCard({ 
  preset, 
  isSelected, 
  onSelect, 
  onRunBacktest,
  isLoading 
}: { 
  preset: any; 
  isSelected: boolean; 
  onSelect: () => void;
  onRunBacktest: () => void;
  isLoading: boolean;
}) {
  const getRiskColor = (id: string) => {
    switch (id) {
      case 'ultra_conservative':
      case 'conservative':
        return 'text-green-400 border-green-500/30 bg-green-500/10';
      case 'institutional':
        return 'text-blue-400 border-blue-500/30 bg-blue-500/10';
      case 'aggressive':
        return 'text-orange-400 border-orange-500/30 bg-orange-500/10';
      case 'ultra_aggressive':
        return 'text-red-400 border-red-500/30 bg-red-500/10';
      case 'trend_following':
        return 'text-purple-400 border-purple-500/30 bg-purple-500/10';
      case 'mean_reversion':
        return 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10';
      default:
        return 'text-muted-foreground border-border bg-muted/50';
    }
  };

  return (
    <Card 
      className={`cursor-pointer transition-all ${isSelected ? 'ring-2 ring-primary' : 'hover:border-primary/50'}`}
      onClick={onSelect}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            {preset.name}
            {preset.id === 'institutional' && (
              <Badge variant="default" className="text-xs">Recommended</Badge>
            )}
          </CardTitle>
          <Checkbox checked={isSelected} />
        </div>
        <CardDescription>{preset.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className={`p-2 rounded ${getRiskColor(preset.id)}`}>
            <span className="text-xs opacity-70">Base Threshold</span>
            <p className="font-bold">{(preset.baseThreshold * 100).toFixed(0)}%</p>
          </div>
          <div className="p-2 rounded bg-muted/50">
            <span className="text-xs text-muted-foreground">Expected Win Rate</span>
            <p className="font-bold">{preset.expectedMetrics.winRate}</p>
          </div>
          <div className="p-2 rounded bg-muted/50">
            <span className="text-xs text-muted-foreground">Sharpe Ratio</span>
            <p className="font-bold">{preset.expectedMetrics.sharpeRatio}</p>
          </div>
          <div className="p-2 rounded bg-muted/50">
            <span className="text-xs text-muted-foreground">Max Drawdown</span>
            <p className="font-bold">{preset.expectedMetrics.maxDrawdown}</p>
          </div>
        </div>
        
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Regime Multipliers</span>
          <div className="flex gap-2 text-xs">
            <Badge variant="outline">
              Trend: {preset.regimeMultipliers.trending}×
            </Badge>
            <Badge variant="outline">
              Volatile: {preset.regimeMultipliers.volatile}×
            </Badge>
            <Badge variant="outline">
              Range: {preset.regimeMultipliers.ranging}×
            </Badge>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-1">
          {preset.suitableFor.map((tag: string) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
        
        {isSelected && (
          <Button 
            className="w-full" 
            onClick={(e) => { e.stopPropagation(); onRunBacktest(); }}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Run Backtest
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function Backtesting() {
  const [activeTab, setActiveTab] = useState('presets');
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [selectedPresetsForComparison, setSelectedPresetsForComparison] = useState<string[]>([]);
  
  // Backtest configuration state
  const [config, setConfig] = useState({
    name: 'Threshold Test',
    symbol: 'BTC-USD',
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    baseThreshold: 0.25,
    regimeMultipliers: {
      trending: 0.80,
      volatile: 1.40,
      ranging: 1.10,
    },
    initialCapital: 100000,
    holdingPeriodHours: 24,
    stopLossPercent: 0.05,
    takeProfitPercent: 0.10,
  });
  
  // Optimization settings
  const [optimizationSettings, setOptimizationSettings] = useState({
    thresholdMin: 0.15,
    thresholdMax: 0.45,
    thresholdStep: 0.05,
    optimizeFor: 'balanced' as 'sharpe' | 'return' | 'winRate' | 'balanced',
    maxIterations: 50,
  });
  
  // Queries
  const recommendedConfig = trpc.consensusBacktest.getRecommendedConfig.useQuery();
  const positionTiers = trpc.consensusBacktest.getPositionSizingTiers.useQuery();
  const thresholdPresets = trpc.consensusBacktest.getThresholdPresets.useQuery();
  
  // Mutations
  const runBacktest = trpc.consensusBacktest.runBacktest.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Backtest completed: ${data.metrics.totalTrades} trades, ${(data.metrics.winRate * 100).toFixed(1)}% win rate`);
      } else {
        toast.error(`Backtest ${data.status}: ${data.errorMessage || 'Unknown error'}`);
      }
    },
    onError: (error) => {
      toast.error(`Backtest failed: ${error.message}`);
    },
  });
  
  const runPresetBacktest = trpc.consensusBacktest.runPresetBacktest.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`${data.preset.name} backtest completed: ${data.metrics.totalTrades} trades, ${(data.metrics.winRate * 100).toFixed(1)}% win rate`);
      } else {
        toast.error(`Backtest ${data.status}: ${data.errorMessage || 'Unknown error'}`);
      }
    },
    onError: (error) => {
      toast.error(`Backtest failed: ${error.message}`);
    },
  });
  
  const comparePresets = trpc.consensusBacktest.comparePresets.useMutation({
    onSuccess: (data) => {
      toast.success(`Comparison complete: ${data.comparison.recommendation}`);
    },
    onError: (error) => {
      toast.error(`Comparison failed: ${error.message}`);
    },
  });
  
  const compareThresholds = trpc.consensusBacktest.compareThresholds.useMutation({
    onSuccess: (data) => {
      toast.success(`Comparison complete: ${data.comparison.recommendation}`);
    },
    onError: (error) => {
      toast.error(`Comparison failed: ${error.message}`);
    },
  });
  
  const optimizeThresholds = trpc.consensusBacktest.optimizeThresholds.useMutation({
    onSuccess: (data) => {
      if (data.optimal) {
        toast.success(`Optimization complete! Best threshold: ${(data.optimal.baseThreshold * 100).toFixed(0)}%`);
      } else {
        toast.warning('Optimization completed but no optimal configuration found');
      }
    },
    onError: (error) => {
      toast.error(`Optimization failed: ${error.message}`);
    },
  });
  
  const handleRunBacktest = () => {
    runBacktest.mutate({
      name: config.name,
      symbol: config.symbol,
      startDate: config.startDate,
      endDate: config.endDate,
      baseThreshold: config.baseThreshold,
      regimeMultipliers: config.regimeMultipliers,
      initialCapital: config.initialCapital,
      holdingPeriodHours: config.holdingPeriodHours,
      stopLossPercent: config.stopLossPercent,
      takeProfitPercent: config.takeProfitPercent,
    });
  };
  
  const handleRunPresetBacktest = (presetId: string) => {
    runPresetBacktest.mutate({
      presetId,
      symbol: config.symbol,
      startDate: config.startDate,
      endDate: config.endDate,
      initialCapital: config.initialCapital,
      holdingPeriodHours: config.holdingPeriodHours,
      stopLossPercent: config.stopLossPercent,
      takeProfitPercent: config.takeProfitPercent,
    });
  };
  
  const handleComparePresets = () => {
    if (selectedPresetsForComparison.length < 2) {
      toast.error('Select at least 2 presets to compare');
      return;
    }
    comparePresets.mutate({
      presetIds: selectedPresetsForComparison,
      symbol: config.symbol,
      startDate: config.startDate,
      endDate: config.endDate,
      initialCapital: config.initialCapital,
      holdingPeriodHours: config.holdingPeriodHours,
      stopLossPercent: config.stopLossPercent,
      takeProfitPercent: config.takeProfitPercent,
    });
  };
  
  const handleCompareConfigs = () => {
    compareThresholds.mutate({
      symbol: config.symbol,
      startDate: config.startDate,
      endDate: config.endDate,
      initialCapital: config.initialCapital,
      holdingPeriodHours: config.holdingPeriodHours,
      stopLossPercent: config.stopLossPercent,
      takeProfitPercent: config.takeProfitPercent,
      configurations: [
        {
          name: 'Conservative (35%)',
          baseThreshold: 0.35,
          regimeMultipliers: { trending: 0.90, volatile: 1.50, ranging: 1.20 },
        },
        {
          name: 'Standard (25%)',
          baseThreshold: 0.25,
          regimeMultipliers: { trending: 0.80, volatile: 1.40, ranging: 1.10 },
        },
        {
          name: 'Aggressive (20%)',
          baseThreshold: 0.20,
          regimeMultipliers: { trending: 0.70, volatile: 1.20, ranging: 1.00 },
        },
      ],
    });
  };
  
  const handleRunOptimization = () => {
    optimizeThresholds.mutate({
      symbol: config.symbol,
      startDate: config.startDate,
      endDate: config.endDate,
      initialCapital: config.initialCapital,
      holdingPeriodHours: config.holdingPeriodHours,
      stopLossPercent: config.stopLossPercent,
      takeProfitPercent: config.takeProfitPercent,
      thresholdRange: {
        min: optimizationSettings.thresholdMin,
        max: optimizationSettings.thresholdMax,
        step: optimizationSettings.thresholdStep,
      },
      optimizeFor: optimizationSettings.optimizeFor,
      maxIterations: optimizationSettings.maxIterations,
    });
  };
  
  const applyRecommendedConfig = () => {
    if (recommendedConfig.data?.recommended) {
      const rec = recommendedConfig.data.recommended;
      setConfig(prev => ({
        ...prev,
        baseThreshold: rec.baseThreshold,
        regimeMultipliers: rec.regimeMultipliers,
      }));
      toast.success('Applied recommended configuration');
    }
  };
  
  const togglePresetForComparison = (presetId: string) => {
    setSelectedPresetsForComparison(prev => {
      if (prev.includes(presetId)) {
        return prev.filter(id => id !== presetId);
      }
      if (prev.length >= 7) {
        toast.warning('Maximum 7 presets can be compared');
        return prev;
      }
      return [...prev, presetId];
    });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-3 sm:p-4 lg:p-6 space-y-4 lg:space-y-6">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Consensus Threshold Backtesting</h1>
            <p className="text-muted-foreground">
              Test and optimize consensus threshold configurations with historical data
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={applyRecommendedConfig}>
              <Settings className="w-4 h-4 mr-2" />
              Apply Recommended
            </Button>
          </div>
        </div>

        {/* Global Settings Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Backtest Settings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Symbol</Label>
                <Select
                  value={config.symbol}
                  onValueChange={(value) => setConfig(prev => ({ ...prev, symbol: value }))}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BTC-USD">BTC-USD</SelectItem>
                    <SelectItem value="ETH-USD">ETH-USD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Start Date</Label>
                <Input
                  type="date"
                  className="h-8"
                  value={config.startDate}
                  onChange={(e) => setConfig(prev => ({ ...prev, startDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">End Date</Label>
                <Input
                  type="date"
                  className="h-8"
                  value={config.endDate}
                  onChange={(e) => setConfig(prev => ({ ...prev, endDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Initial Capital</Label>
                <Input
                  type="number"
                  className="h-8"
                  value={config.initialCapital}
                  onChange={(e) => setConfig(prev => ({ ...prev, initialCapital: parseInt(e.target.value) || 100000 }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Holding (hrs)</Label>
                <Input
                  type="number"
                  className="h-8"
                  value={config.holdingPeriodHours}
                  onChange={(e) => setConfig(prev => ({ ...prev, holdingPeriodHours: parseInt(e.target.value) || 24 }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Stop Loss %</Label>
                <Input
                  type="number"
                  step="0.01"
                  className="h-8"
                  value={config.stopLossPercent}
                  onChange={(e) => setConfig(prev => ({ ...prev, stopLossPercent: parseFloat(e.target.value) || 0.05 }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Take Profit %</Label>
                <Input
                  type="number"
                  step="0.01"
                  className="h-8"
                  value={config.takeProfitPercent}
                  onChange={(e) => setConfig(prev => ({ ...prev, takeProfitPercent: parseFloat(e.target.value) || 0.10 }))}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="presets">
              <Sparkles className="w-4 h-4 mr-2" />
              Presets
            </TabsTrigger>
            <TabsTrigger value="custom">
              <Settings className="w-4 h-4 mr-2" />
              Custom
            </TabsTrigger>
            <TabsTrigger value="compare">
              <BarChart3 className="w-4 h-4 mr-2" />
              Compare
            </TabsTrigger>
            <TabsTrigger value="optimize">
              <Zap className="w-4 h-4 mr-2" />
              Optimize
            </TabsTrigger>
            <TabsTrigger value="results">
              <FileText className="w-4 h-4 mr-2" />
              Results
            </TabsTrigger>
          </TabsList>

          {/* Presets Tab */}
          <TabsContent value="presets" className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium">Threshold Presets</h3>
                <p className="text-sm text-muted-foreground">
                  Select a preset configuration to backtest or compare multiple presets
                </p>
              </div>
              {selectedPresetsForComparison.length >= 2 && (
                <Button onClick={handleComparePresets} disabled={comparePresets.isPending}>
                  {comparePresets.isPending ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Comparing...
                    </>
                  ) : (
                    <>
                      <BarChart3 className="w-4 h-4 mr-2" />
                      Compare {selectedPresetsForComparison.length} Presets
                    </>
                  )}
                </Button>
              )}
            </div>
            
            {thresholdPresets.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : thresholdPresets.data ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {thresholdPresets.data.map((preset) => (
                  <div key={preset.id} className="relative">
                    <div 
                      className="absolute top-2 right-2 z-10"
                      onClick={(e) => { e.stopPropagation(); togglePresetForComparison(preset.id); }}
                    >
                      <Checkbox 
                        checked={selectedPresetsForComparison.includes(preset.id)}
                        className="bg-background"
                      />
                    </div>
                    <PresetCard
                      preset={preset}
                      isSelected={selectedPresetId === preset.id}
                      onSelect={() => setSelectedPresetId(preset.id === selectedPresetId ? null : preset.id)}
                      onRunBacktest={() => handleRunPresetBacktest(preset.id)}
                      isLoading={runPresetBacktest.isPending && runPresetBacktest.variables?.presetId === preset.id}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                Failed to load presets
              </div>
            )}
            
            {/* Preset Comparison Results */}
            {comparePresets.data && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-yellow-400" />
                    Preset Comparison Results
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
                    <div className="flex items-center gap-2 mb-2">
                      <Info className="w-5 h-5 text-blue-400" />
                      <span className="font-medium text-blue-400">Recommendation</span>
                    </div>
                    <p>{comparePresets.data.comparison.recommendation}</p>
                  </div>
                  
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2">Preset</th>
                          <th className="text-right p-2">Threshold</th>
                          <th className="text-right p-2">Trades</th>
                          <th className="text-right p-2">Win Rate</th>
                          <th className="text-right p-2">Total Return</th>
                          <th className="text-right p-2">Sharpe</th>
                          <th className="text-right p-2">Max DD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparePresets.data.results.map((result) => (
                          <tr key={result.name} className="border-b">
                            <td className="p-2">
                              <div className="flex items-center gap-2">
                                {result.name}
                                {result.name === comparePresets.data?.comparison.bestBySharpe && (
                                  <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-400">Best Sharpe</Badge>
                                )}
                                {result.name === comparePresets.data?.comparison.bestByReturn && (
                                  <Badge variant="outline" className="text-xs text-green-400 border-green-400">Best Return</Badge>
                                )}
                              </div>
                            </td>
                            <td className="text-right p-2 font-mono">
                              {(result.baseThreshold * 100).toFixed(0)}%
                            </td>
                            <td className="text-right p-2">{result.metrics.totalTrades}</td>
                            <td className="text-right p-2 text-green-400">
                              {(result.metrics.winRate * 100).toFixed(1)}%
                            </td>
                            <td className={`text-right p-2 ${result.metrics.totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {result.metrics.totalReturn >= 0 ? '+' : ''}{result.metrics.totalReturn.toFixed(2)}%
                            </td>
                            <td className="text-right p-2">{result.metrics.sharpeRatio.toFixed(2)}</td>
                            <td className="text-right p-2 text-red-400">
                              -{result.metrics.maxDrawdown.toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Custom Tab */}
          <TabsContent value="custom" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Configuration Panel */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="w-5 h-5" />
                    Custom Configuration
                  </CardTitle>
                  <CardDescription>
                    Fine-tune threshold parameters for your backtest
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Threshold Settings */}
                  <div className="space-y-4">
                    <h4 className="font-medium flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      Threshold Settings
                    </h4>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <Label>Base Threshold</Label>
                        <span className="text-sm font-mono">{(config.baseThreshold * 100).toFixed(0)}%</span>
                      </div>
                      <Slider
                        value={[config.baseThreshold * 100]}
                        onValueChange={([value]) => setConfig(prev => ({ ...prev, baseThreshold: value / 100 }))}
                        min={5}
                        max={80}
                        step={5}
                      />
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs">Trending (×)</Label>
                        <Input
                          type="number"
                          step="0.05"
                          value={config.regimeMultipliers.trending}
                          onChange={(e) => setConfig(prev => ({
                            ...prev,
                            regimeMultipliers: { ...prev.regimeMultipliers, trending: parseFloat(e.target.value) }
                          }))}
                        />
                        <p className="text-xs text-muted-foreground">
                          = {(config.baseThreshold * config.regimeMultipliers.trending * 100).toFixed(0)}%
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Volatile (×)</Label>
                        <Input
                          type="number"
                          step="0.05"
                          value={config.regimeMultipliers.volatile}
                          onChange={(e) => setConfig(prev => ({
                            ...prev,
                            regimeMultipliers: { ...prev.regimeMultipliers, volatile: parseFloat(e.target.value) }
                          }))}
                        />
                        <p className="text-xs text-muted-foreground">
                          = {(config.baseThreshold * config.regimeMultipliers.volatile * 100).toFixed(0)}%
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Ranging (×)</Label>
                        <Input
                          type="number"
                          step="0.05"
                          value={config.regimeMultipliers.ranging}
                          onChange={(e) => setConfig(prev => ({
                            ...prev,
                            regimeMultipliers: { ...prev.regimeMultipliers, ranging: parseFloat(e.target.value) }
                          }))}
                        />
                        <p className="text-xs text-muted-foreground">
                          = {(config.baseThreshold * config.regimeMultipliers.ranging * 100).toFixed(0)}%
                        </p>
                      </div>
                    </div>
                  </div>

                  <Button 
                    className="w-full" 
                    onClick={handleRunBacktest}
                    disabled={runBacktest.isPending}
                  >
                    {runBacktest.isPending ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Running Backtest...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Run Custom Backtest
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Quick Results */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5" />
                    Quick Results
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {runBacktest.data ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg bg-muted/50 text-center">
                          <p className="text-sm text-muted-foreground">Total Trades</p>
                          <p className="text-2xl font-bold">{runBacktest.data.metrics.totalTrades}</p>
                        </div>
                        <div className="p-4 rounded-lg bg-green-500/10 text-center">
                          <p className="text-sm text-muted-foreground">Win Rate</p>
                          <p className="text-2xl font-bold text-green-400">
                            {(runBacktest.data.metrics.winRate * 100).toFixed(1)}%
                          </p>
                        </div>
                        <div className={`p-4 rounded-lg text-center ${runBacktest.data.metrics.totalReturn >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                          <p className="text-sm text-muted-foreground">Total Return</p>
                          <p className={`text-2xl font-bold ${runBacktest.data.metrics.totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {runBacktest.data.metrics.totalReturn >= 0 ? '+' : ''}{runBacktest.data.metrics.totalReturn.toFixed(2)}%
                          </p>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/50 text-center">
                          <p className="text-sm text-muted-foreground">Sharpe Ratio</p>
                          <p className="text-2xl font-bold">{runBacktest.data.metrics.sharpeRatio.toFixed(2)}</p>
                        </div>
                      </div>
                      
                      <div className="p-4 rounded-lg bg-red-500/10">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Max Drawdown</span>
                          <span className="font-bold text-red-400">-{runBacktest.data.metrics.maxDrawdown.toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Activity className="w-12 h-12 mb-4 opacity-50" />
                      <p>Run a backtest to see results</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Compare Tab */}
          <TabsContent value="compare" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" />
                  Compare Threshold Configurations
                </CardTitle>
                <CardDescription>
                  Compare Conservative, Standard, and Aggressive configurations
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex gap-4">
                  <Button onClick={handleCompareConfigs} disabled={compareThresholds.isPending}>
                    {compareThresholds.isPending ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Comparing...
                      </>
                    ) : (
                      <>
                        <BarChart3 className="w-4 h-4 mr-2" />
                        Compare Conservative vs Standard vs Aggressive
                      </>
                    )}
                  </Button>
                </div>

                {compareThresholds.data && (
                  <div className="space-y-6">
                    {/* Recommendation */}
                    <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
                      <div className="flex items-center gap-2 mb-2">
                        <Info className="w-5 h-5 text-blue-400" />
                        <span className="font-medium text-blue-400">Recommendation</span>
                      </div>
                      <p>{compareThresholds.data.comparison.recommendation}</p>
                    </div>

                    {/* Comparison Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-2">Configuration</th>
                            <th className="text-right p-2">Threshold</th>
                            <th className="text-right p-2">Trades</th>
                            <th className="text-right p-2">Win Rate</th>
                            <th className="text-right p-2">Total Return</th>
                            <th className="text-right p-2">Sharpe</th>
                            <th className="text-right p-2">Max DD</th>
                          </tr>
                        </thead>
                        <tbody>
                          {compareThresholds.data.results.map((result) => (
                            <tr key={result.name} className="border-b">
                              <td className="p-2">
                                <div className="flex items-center gap-2">
                                  {result.name}
                                  {result.name === compareThresholds.data?.comparison.bestBySharpe && (
                                    <Badge variant="outline" className="text-xs">Best Sharpe</Badge>
                                  )}
                                  {result.name === compareThresholds.data?.comparison.bestByReturn && (
                                    <Badge variant="outline" className="text-xs">Best Return</Badge>
                                  )}
                                </div>
                              </td>
                              <td className="text-right p-2 font-mono">
                                {(result.baseThreshold * 100).toFixed(0)}%
                              </td>
                              <td className="text-right p-2">{result.metrics.totalTrades}</td>
                              <td className="text-right p-2 text-green-400">
                                {(result.metrics.winRate * 100).toFixed(1)}%
                              </td>
                              <td className={`text-right p-2 ${result.metrics.totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {result.metrics.totalReturn >= 0 ? '+' : ''}{result.metrics.totalReturn.toFixed(2)}%
                              </td>
                              <td className="text-right p-2">{result.metrics.sharpeRatio.toFixed(2)}</td>
                              <td className="text-right p-2 text-red-400">
                                -{result.metrics.maxDrawdown.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Optimize Tab */}
          <TabsContent value="optimize" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-yellow-400" />
                    Threshold Optimization
                  </CardTitle>
                  <CardDescription>
                    Automatically find the optimal threshold configuration
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs">Min Threshold</Label>
                        <Input
                          type="number"
                          step="0.05"
                          value={optimizationSettings.thresholdMin}
                          onChange={(e) => setOptimizationSettings(prev => ({
                            ...prev,
                            thresholdMin: parseFloat(e.target.value) || 0.15
                          }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Max Threshold</Label>
                        <Input
                          type="number"
                          step="0.05"
                          value={optimizationSettings.thresholdMax}
                          onChange={(e) => setOptimizationSettings(prev => ({
                            ...prev,
                            thresholdMax: parseFloat(e.target.value) || 0.45
                          }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Step Size</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={optimizationSettings.thresholdStep}
                          onChange={(e) => setOptimizationSettings(prev => ({
                            ...prev,
                            thresholdStep: parseFloat(e.target.value) || 0.05
                          }))}
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs">Optimize For</Label>
                        <Select
                          value={optimizationSettings.optimizeFor}
                          onValueChange={(value: any) => setOptimizationSettings(prev => ({
                            ...prev,
                            optimizeFor: value
                          }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="balanced">Balanced</SelectItem>
                            <SelectItem value="sharpe">Sharpe Ratio</SelectItem>
                            <SelectItem value="return">Total Return</SelectItem>
                            <SelectItem value="winRate">Win Rate</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Max Iterations</Label>
                        <Input
                          type="number"
                          value={optimizationSettings.maxIterations}
                          onChange={(e) => setOptimizationSettings(prev => ({
                            ...prev,
                            maxIterations: parseInt(e.target.value) || 50
                          }))}
                        />
                      </div>
                    </div>
                  </div>

                  <Button 
                    className="w-full" 
                    onClick={handleRunOptimization}
                    disabled={optimizeThresholds.isPending}
                  >
                    {optimizeThresholds.isPending ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Optimizing...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 mr-2" />
                        Run Optimization
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Optimization Results */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-yellow-400" />
                    Optimization Results
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {optimizeThresholds.data ? (
                    <div className="space-y-4">
                      {optimizeThresholds.data.optimal ? (
                        <>
                          <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                            <h4 className="font-medium text-green-400 mb-2">Optimal Configuration Found</h4>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div>
                                <span className="text-muted-foreground">Base Threshold:</span>
                                <span className="ml-2 font-bold">{(optimizeThresholds.data.optimal.baseThreshold * 100).toFixed(0)}%</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Win Rate:</span>
                                <span className="ml-2 font-bold text-green-400">{(optimizeThresholds.data.optimal.metrics.winRate * 100).toFixed(1)}%</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Sharpe:</span>
                                <span className="ml-2 font-bold">{optimizeThresholds.data.optimal.metrics.sharpeRatio.toFixed(2)}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Total Return:</span>
                                <span className={`ml-2 font-bold ${optimizeThresholds.data.optimal.metrics.totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {optimizeThresholds.data.optimal.metrics.totalReturn >= 0 ? '+' : ''}{optimizeThresholds.data.optimal.metrics.totalReturn.toFixed(2)}%
                                </span>
                              </div>
                            </div>
                          </div>
                          
                          {optimizeThresholds.data.suggestions.length > 0 && (
                            <div className="space-y-2">
                              <h4 className="font-medium text-sm">Suggestions</h4>
                              {optimizeThresholds.data.suggestions.map((suggestion, i) => (
                                <div key={i} className="p-2 rounded bg-muted/50 text-sm flex items-start gap-2">
                                  <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                                  {suggestion}
                                </div>
                              ))}
                            </div>
                          )}
                          
                          <div className="text-xs text-muted-foreground">
                            Tested {optimizeThresholds.data.iterationsRun} configurations in {(optimizeThresholds.data.executionTimeMs / 1000).toFixed(1)}s
                          </div>
                        </>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                          <p>No optimal configuration found</p>
                          <p className="text-sm">Try adjusting the parameters</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Zap className="w-12 h-12 mb-4 opacity-50" />
                      <p>Run optimization to find the best configuration</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Results Tab */}
          <TabsContent value="results" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Position Tiers */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Layers className="w-5 h-5" />
                    Position Sizing Tiers
                  </CardTitle>
                  <CardDescription>
                    How position size scales with consensus strength
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {positionTiers.data ? (
                    <div className="space-y-3">
                      {positionTiers.data.tiers.map((tier) => (
                        <div key={tier.name} className="p-3 rounded-lg border">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <Badge variant={
                                tier.name === 'MAX' ? 'default' :
                                tier.name === 'HIGH' ? 'default' :
                                tier.name === 'STRONG' ? 'secondary' :
                                'outline'
                              }>
                                {tier.name}
                              </Badge>
                              <span className="font-bold">{tier.size}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {tier.confidenceRange}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{tier.description}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-12">
                      <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Risk Management */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Risk Management
                  </CardTitle>
                  <CardDescription>
                    Portfolio-level risk controls
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {positionTiers.data ? (
                    <div className="space-y-3">
                      {Object.entries(positionTiers.data.riskManagement).map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                          <span className="capitalize text-sm">
                            {key.replace(/([A-Z])/g, ' $1').trim()}
                          </span>
                          <span className="font-mono font-bold">{value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-12">
                      <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Recent Backtest Results */}
            {(runBacktest.data || runPresetBacktest.data) && (
              <Card>
                <CardHeader>
                  <CardTitle>Recent Backtest Results</CardTitle>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const data = runPresetBacktest.data || runBacktest.data;
                    if (!data?.tradeSummary) return null;
                    
                    return (
                      <div className="space-y-6">
                        <div className="grid grid-cols-4 gap-4">
                          <div className="p-4 rounded-lg bg-muted/50 text-center">
                            <p className="text-sm text-muted-foreground">Total Trades</p>
                            <p className="text-2xl font-bold">{data.tradeSummary.totalTrades}</p>
                          </div>
                          <div className="p-4 rounded-lg bg-green-500/10 text-center">
                            <p className="text-sm text-muted-foreground">Winning</p>
                            <p className="text-2xl font-bold text-green-400">{data.tradeSummary.winningTrades}</p>
                          </div>
                          <div className="p-4 rounded-lg bg-red-500/10 text-center">
                            <p className="text-sm text-muted-foreground">Losing</p>
                            <p className="text-2xl font-bold text-red-400">{data.tradeSummary.losingTrades}</p>
                          </div>
                          <div className="p-4 rounded-lg bg-muted/50 text-center">
                            <p className="text-sm text-muted-foreground">Avg P&L</p>
                            <p className={`text-2xl font-bold ${data.tradeSummary.avgPnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {data.tradeSummary.avgPnlPercent >= 0 ? '+' : ''}{data.tradeSummary.avgPnlPercent.toFixed(2)}%
                            </p>
                          </div>
                        </div>

                        {/* Last 10 Trades */}
                        {data.tradeSummary.lastTrades.length > 0 && (
                          <div>
                            <h4 className="font-medium mb-4">Last 10 Trades</h4>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b">
                                    <th className="text-left p-2">Time</th>
                                    <th className="text-left p-2">Direction</th>
                                    <th className="text-left p-2">Tier</th>
                                    <th className="text-left p-2">Regime</th>
                                    <th className="text-right p-2">P&L</th>
                                    <th className="text-center p-2">Outcome</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {data.tradeSummary.lastTrades.map((trade: any, i: number) => (
                                    <tr key={i} className="border-b">
                                      <td className="p-2 text-muted-foreground">
                                        {new Date(trade.timestamp).toLocaleDateString()}
                                      </td>
                                      <td className="p-2">
                                        <Badge variant={trade.direction === 'long' ? 'default' : 'destructive'}>
                                          {trade.direction === 'long' ? (
                                            <TrendingUp className="w-3 h-3 mr-1" />
                                          ) : (
                                            <TrendingDown className="w-3 h-3 mr-1" />
                                          )}
                                          {trade.direction.toUpperCase()}
                                        </Badge>
                                      </td>
                                      <td className="p-2 font-mono">{trade.positionTier}</td>
                                      <td className="p-2 capitalize">{trade.regime}</td>
                                      <td className={`p-2 text-right font-mono ${trade.pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        {trade.pnlPercent >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                                      </td>
                                      <td className="p-2 text-center">
                                        {trade.outcome === 'win' ? (
                                          <CheckCircle className="w-4 h-4 text-green-400 mx-auto" />
                                        ) : trade.outcome === 'loss' ? (
                                          <XCircle className="w-4 h-4 text-red-400 mx-auto" />
                                        ) : (
                                          <AlertTriangle className="w-4 h-4 text-yellow-400 mx-auto" />
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
