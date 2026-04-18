/**
 * Risk-Reward Analyzer Component
 * Analyzes trade setups and provides recommendations based on risk-reward metrics
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  TrendingUp,
  TrendingDown,
  Target,
  AlertCircle,
  CheckCircle2,
  XCircle,
  BarChart3,
} from 'lucide-react';

interface RiskRewardAnalysis {
  riskAmount: number;
  rewardAmount: number;
  riskRewardRatio: number;
  riskPercent: number;
  rewardPercent: number;
  breakEvenWinRate: number;
  expectedValue: number;
  recommendation: 'excellent' | 'good' | 'acceptable' | 'poor' | 'reject';
  reasoning: string[];
}

interface RiskRewardAnalyzerProps {
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  onAnalyze?: (analysis: RiskRewardAnalysis) => void;
}

export function RiskRewardAnalyzer({
  entryPrice: initialEntry,
  stopLoss: initialStopLoss,
  takeProfit: initialTakeProfit,
  onAnalyze,
}: RiskRewardAnalyzerProps) {
  const [entryPrice, setEntryPrice] = useState(initialEntry || 0);
  const [stopLossPrice, setStopLossPrice] = useState(initialStopLoss || 0);
  const [takeProfitPrice, setTakeProfitPrice] = useState(initialTakeProfit || 0);
  const [winRate, setWinRate] = useState(50);

  const [analysis, setAnalysis] = useState<RiskRewardAnalysis | null>(null);

  useEffect(() => {
    if (entryPrice > 0 && stopLossPrice > 0 && takeProfitPrice > 0) {
      analyzeRiskReward();
    }
  }, [entryPrice, stopLossPrice, takeProfitPrice, winRate]);

  const analyzeRiskReward = () => {
    // Calculate risk and reward amounts
    const riskAmount = Math.abs(entryPrice - stopLossPrice);
    const rewardAmount = Math.abs(takeProfitPrice - entryPrice);

    // Calculate percentages
    const riskPercent = (riskAmount / entryPrice) * 100;
    const rewardPercent = (rewardAmount / entryPrice) * 100;

    // Calculate risk-reward ratio
    const riskRewardRatio = rewardAmount / riskAmount;

    // Calculate break-even win rate
    const breakEvenWinRate = (1 / (1 + riskRewardRatio)) * 100;

    // Calculate expected value
    const expectedValue = (winRate / 100) * rewardAmount - ((100 - winRate) / 100) * riskAmount;

    // Determine recommendation
    let recommendation: RiskRewardAnalysis['recommendation'] = 'acceptable';
    const reasoning: string[] = [];

    if (riskRewardRatio >= 3) {
      recommendation = 'excellent';
      reasoning.push('Excellent risk-reward ratio (3:1 or better)');
    } else if (riskRewardRatio >= 2) {
      recommendation = 'good';
      reasoning.push('Good risk-reward ratio (2:1 or better)');
    } else if (riskRewardRatio >= 1.5) {
      recommendation = 'acceptable';
      reasoning.push('Acceptable risk-reward ratio (1.5:1)');
    } else if (riskRewardRatio >= 1) {
      recommendation = 'poor';
      reasoning.push('Poor risk-reward ratio (below 1.5:1)');
    } else {
      recommendation = 'reject';
      reasoning.push('Unacceptable risk-reward ratio (below 1:1)');
    }

    if (winRate > breakEvenWinRate) {
      reasoning.push(`Win rate (${winRate}%) exceeds break-even (${breakEvenWinRate.toFixed(1)}%)`);
    } else {
      reasoning.push(`Win rate (${winRate}%) below break-even (${breakEvenWinRate.toFixed(1)}%)`);
      if (recommendation === 'excellent' || recommendation === 'good') {
        recommendation = 'acceptable';
      } else if (recommendation === 'acceptable') {
        recommendation = 'poor';
      }
    }

    if (expectedValue > 0) {
      reasoning.push(`Positive expected value: $${expectedValue.toFixed(2)} per trade`);
    } else {
      reasoning.push(`Negative expected value: $${expectedValue.toFixed(2)} per trade`);
      recommendation = 'reject';
    }

    if (riskPercent > 5) {
      reasoning.push('⚠ Risk exceeds 5% - consider tighter stop-loss');
    }

    const calculatedAnalysis: RiskRewardAnalysis = {
      riskAmount,
      rewardAmount,
      riskRewardRatio,
      riskPercent,
      rewardPercent,
      breakEvenWinRate,
      expectedValue,
      recommendation,
      reasoning,
    };

    setAnalysis(calculatedAnalysis);
    onAnalyze?.(calculatedAnalysis);
  };

  const getRecommendationColor = (rec: RiskRewardAnalysis['recommendation']) => {
    switch (rec) {
      case 'excellent':
        return 'bg-green-600';
      case 'good':
        return 'bg-green-500';
      case 'acceptable':
        return 'bg-yellow-500';
      case 'poor':
        return 'bg-orange-500';
      case 'reject':
        return 'bg-red-600';
    }
  };

  const getRecommendationIcon = (rec: RiskRewardAnalysis['recommendation']) => {
    switch (rec) {
      case 'excellent':
      case 'good':
        return <CheckCircle2 className="w-5 h-5" />;
      case 'acceptable':
        return <AlertCircle className="w-5 h-5" />;
      case 'poor':
      case 'reject':
        return <XCircle className="w-5 h-5" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          <CardTitle>Risk-Reward Analyzer</CardTitle>
        </div>
        <CardDescription>
          Analyze trade setup and calculate expected value
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Price Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="entry-price">Entry Price</Label>
            <div className="relative">
              <Target className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="entry-price"
                type="number"
                value={entryPrice || ''}
                onChange={(e) => setEntryPrice(parseFloat(e.target.value) || 0)}
                className="pl-9"
                step="0.01"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="stop-loss-price">Stop Loss</Label>
            <div className="relative">
              <TrendingDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />
              <Input
                id="stop-loss-price"
                type="number"
                value={stopLossPrice || ''}
                onChange={(e) => setStopLossPrice(parseFloat(e.target.value) || 0)}
                className="pl-9"
                step="0.01"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="take-profit-price">Take Profit</Label>
            <div className="relative">
              <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
              <Input
                id="take-profit-price"
                type="number"
                value={takeProfitPrice || ''}
                onChange={(e) => setTakeProfitPrice(parseFloat(e.target.value) || 0)}
                className="pl-9"
                step="0.01"
                placeholder="0.00"
              />
            </div>
          </div>
        </div>

        {/* Win Rate Input */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Expected Win Rate</Label>
            <Badge variant="outline">{winRate}%</Badge>
          </div>
          <input
            type="range"
            min="10"
            max="90"
            step="5"
            value={winRate}
            onChange={(e) => setWinRate(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
          />
          <p className="text-xs text-muted-foreground">
            Adjust based on your historical win rate or strategy backtest results
          </p>
        </div>

        {/* Visual Price Chart */}
        {analysis && (
          <div className="space-y-2">
            <Label>Price Levels</Label>
            <div className="relative h-32 bg-muted rounded-lg p-4">
              <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-border" />
              
              {/* Entry Price Line */}
              <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2">
                <div className="flex flex-col items-center">
                  <Target className="w-4 h-4 text-blue-500" />
                  <div className="text-xs font-mono mt-1">${entryPrice.toFixed(2)}</div>
                  <Badge variant="outline" className="mt-1 text-xs">Entry</Badge>
                </div>
              </div>

              {/* Stop Loss Line */}
              <div className="absolute left-1/4 -translate-x-1/2 bottom-4">
                <div className="flex flex-col items-center">
                  <TrendingDown className="w-4 h-4 text-red-500" />
                  <div className="text-xs font-mono mt-1">${stopLossPrice.toFixed(2)}</div>
                  <Badge variant="destructive" className="mt-1 text-xs">Stop Loss</Badge>
                </div>
              </div>

              {/* Take Profit Line */}
              <div className="absolute right-1/4 translate-x-1/2 top-4">
                <div className="flex flex-col items-center">
                  <TrendingUp className="w-4 h-4 text-green-500" />
                  <div className="text-xs font-mono mt-1">${takeProfitPrice.toFixed(2)}</div>
                  <Badge className="mt-1 text-xs bg-green-600">Take Profit</Badge>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Analysis Results */}
        {analysis && (
          <div className="space-y-4 pt-4 border-t">
            {/* Recommendation Badge */}
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">Analysis Result</h4>
              <Badge className={getRecommendationColor(analysis.recommendation)}>
                {getRecommendationIcon(analysis.recommendation)}
                <span className="ml-1 capitalize">{analysis.recommendation}</span>
              </Badge>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Risk-Reward Ratio</div>
                <div className="text-2xl font-bold font-mono">
                  1:{analysis.riskRewardRatio.toFixed(2)}
                </div>
              </div>

              <div className="p-3 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Break-Even Win Rate</div>
                <div className="text-2xl font-bold font-mono">
                  {analysis.breakEvenWinRate.toFixed(1)}%
                </div>
              </div>

              <div className="p-3 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Risk Amount</div>
                <div className="text-xl font-bold font-mono text-red-500">
                  ${analysis.riskAmount.toFixed(2)}
                  <span className="text-sm ml-1">({analysis.riskPercent.toFixed(2)}%)</span>
                </div>
              </div>

              <div className="p-3 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Reward Amount</div>
                <div className="text-xl font-bold font-mono text-green-500">
                  ${analysis.rewardAmount.toFixed(2)}
                  <span className="text-sm ml-1">({analysis.rewardPercent.toFixed(2)}%)</span>
                </div>
              </div>

              <div className="p-3 bg-muted rounded-lg col-span-2">
                <div className="text-sm text-muted-foreground mb-1">Expected Value (per trade)</div>
                <div className={`text-2xl font-bold font-mono ${analysis.expectedValue > 0 ? 'text-green-500' : 'text-red-500'}`}>
                  ${analysis.expectedValue.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Win Rate Progress Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Win Rate vs Break-Even</span>
                <span className={winRate > analysis.breakEvenWinRate ? 'text-green-500' : 'text-red-500'}>
                  {winRate > analysis.breakEvenWinRate ? 'Above' : 'Below'} Break-Even
                </span>
              </div>
              <Progress 
                value={Math.min((winRate / 100) * 100, 100)} 
                className="h-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Your Win Rate: {winRate}%</span>
                <span>Break-Even: {analysis.breakEvenWinRate.toFixed(1)}%</span>
              </div>
            </div>

            {/* Reasoning */}
            <div className="space-y-2">
              <h5 className="font-semibold text-sm">Analysis Details</h5>
              <ul className="space-y-1">
                {analysis.reasoning.map((reason, index) => (
                  <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-primary mt-0.5">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Action Recommendation */}
            <div className={`p-4 rounded-lg ${
              analysis.recommendation === 'excellent' || analysis.recommendation === 'good' 
                ? 'bg-green-500/10 border border-green-500/20' 
                : analysis.recommendation === 'acceptable'
                ? 'bg-yellow-500/10 border border-yellow-500/20'
                : 'bg-red-500/10 border border-red-500/20'
            }`}>
              <div className="font-semibold mb-1">
                {analysis.recommendation === 'excellent' && '✓ Excellent Trade Setup'}
                {analysis.recommendation === 'good' && '✓ Good Trade Setup'}
                {analysis.recommendation === 'acceptable' && '⚠ Acceptable Trade Setup'}
                {analysis.recommendation === 'poor' && '⚠ Poor Trade Setup'}
                {analysis.recommendation === 'reject' && '✗ Reject This Trade'}
              </div>
              <p className="text-sm text-muted-foreground">
                {analysis.recommendation === 'excellent' && 'This trade has excellent risk-reward characteristics. Proceed with confidence.'}
                {analysis.recommendation === 'good' && 'This trade meets professional standards. Good setup to execute.'}
                {analysis.recommendation === 'acceptable' && 'This trade is acceptable but not optimal. Consider if you have better opportunities.'}
                {analysis.recommendation === 'poor' && 'This trade has poor risk-reward. Consider adjusting targets or skipping.'}
                {analysis.recommendation === 'reject' && 'This trade does not meet minimum standards. Do not execute.'}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
