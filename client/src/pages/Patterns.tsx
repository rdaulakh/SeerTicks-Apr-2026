/**
 * Patterns Page
 * 
 * AI-powered pattern detection and prediction visualization
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, TrendingDown, Minus, Brain, Target } from 'lucide-react';
import { toast } from 'sonner';

const SYMBOLS = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD'];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '6h', '1d'] as const;

export default function Patterns() {
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSD');
  const [selectedTimeframe, setSelectedTimeframe] = useState<typeof TIMEFRAMES[number]>('1h');
  const [selectedPattern, setSelectedPattern] = useState<string | null>(null);

  // Query patterns
  const { data: patternData, isLoading: patternsLoading, refetch } = trpc.pattern.detectPatterns.useQuery({
    symbol: selectedSymbol,
    timeframe: selectedTimeframe,
    limit: 100,
  });

  // Mutation for AI prediction
  const predictMutation = trpc.pattern.predictPattern.useMutation({
    onSuccess: (data) => {
      console.log('Prediction:', data);
      toast.success('AI prediction generated!');
    },
    onError: (error) => {
      toast.error(`Prediction failed: ${error.message}`);
    },
  });

  const handleGetPrediction = (patternName: string) => {
    setSelectedPattern(patternName);
    predictMutation.mutate({
      symbol: selectedSymbol,
      timeframe: selectedTimeframe,
      patternName,
    });
  };

  const getDirectionIcon = (direction: string) => {
    switch (direction) {
      case 'bullish':
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'bearish':
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      default:
        return <Minus className="h-4 w-4 text-gray-500" />;
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 75) return 'text-green-500';
    if (confidence >= 50) return 'text-yellow-500';
    return 'text-orange-500';
  };

  return (
    <div className="container mx-auto py-3 sm:py-4 md:py-6 px-3 sm:px-4 md:px-0 space-y-4 md:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">AI Pattern Detection</h1>
        <p className="text-muted-foreground mt-2">
          Real-time pattern recognition powered by 2 years of historical data and AI predictions
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Pattern Scanner</CardTitle>
          <CardDescription>Select symbol and timeframe to detect patterns</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium mb-2 block">Symbol</label>
            <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SYMBOLS.map((symbol) => (
                  <SelectItem key={symbol} value={symbol}>
                    {symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1">
            <label className="text-sm font-medium mb-2 block">Timeframe</label>
            <Select value={selectedTimeframe} onValueChange={(v) => setSelectedTimeframe(v as typeof TIMEFRAMES[number])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf} value={tf}>
                    {tf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end">
            <Button onClick={() => refetch()} disabled={patternsLoading}>
              {patternsLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Scan Patterns
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Detected Patterns */}
      <Card>
        <CardHeader>
          <CardTitle>Detected Patterns</CardTitle>
          <CardDescription>
            {patternData ? `Found ${patternData.patterns.length} patterns on ${selectedSymbol} ${selectedTimeframe}` : 'Loading...'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {patternsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : patternData?.patterns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No patterns detected. Try a different timeframe or symbol.
            </div>
          ) : (
            <div className="grid gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {patternData?.patterns.map((pattern, idx) => (
                <Card key={idx} className="border-2">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-lg">{pattern.name}</CardTitle>
                      <Badge variant="outline" className={getConfidenceColor(pattern.confidence * 100)}>
                        {(pattern.confidence * 100).toFixed(0)}%
                      </Badge>
                    </div>
                    <CardDescription className="text-xs">{pattern.timeframe}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">{pattern.description}</p>
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => handleGetPrediction(pattern.name)}
                      disabled={predictMutation.isPending && selectedPattern === pattern.name}
                    >
                      {predictMutation.isPending && selectedPattern === pattern.name ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <Brain className="h-4 w-4 mr-2" />
                          Get AI Prediction
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Prediction Result */}
      {predictMutation.data && (
        <Card className="border-2 border-primary">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  AI Prediction: {predictMutation.data.pattern.name}
                </CardTitle>
                <CardDescription className="mt-2">
                  Based on historical analysis and current market conditions
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-lg px-3 py-1">
                {predictMutation.data.prediction.confidence.toFixed(0)}% Confidence
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Prediction Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardDescription className="text-xs">Direction</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    {getDirectionIcon(predictMutation.data.prediction.direction)}
                    <span className="font-semibold capitalize">
                      {predictMutation.data.prediction.direction}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardDescription className="text-xs">Target Price</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary" />
                    <span className="font-semibold">
                      ${predictMutation.data.prediction.targetPrice.toFixed(2)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardDescription className="text-xs">Timeframe</CardDescription>
                </CardHeader>
                <CardContent>
                  <span className="font-semibold">{predictMutation.data.prediction.timeframe}</span>
                </CardContent>
              </Card>
            </div>

            {/* Reasoning */}
            <div>
              <h3 className="font-semibold mb-2">Analysis</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {predictMutation.data.prediction.reasoning}
              </p>
            </div>

            {/* Historical Context */}
            {predictMutation.data.historicalContext.similarPatterns > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Historical Context</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Similar Patterns:</span>
                    <span className="ml-2 font-semibold">
                      {predictMutation.data.historicalContext.similarPatterns}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Success Rate:</span>
                    <span className="ml-2 font-semibold">
                      {(predictMutation.data.historicalContext.successRate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Avg Move:</span>
                    <span className="ml-2 font-semibold">
                      {predictMutation.data.historicalContext.avgPriceMove.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
