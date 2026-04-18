/**
 * Position Sizing Calculator Component
 * Calculates optimal position size based on risk management parameters
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Calculator,
  TrendingUp,
  TrendingDown,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

interface PositionSizeResult {
  positionSize: number;
  riskAmount: number;
  positionValue: number;
  marginRequired: number;
  stopLossDistance: number;
  takeProfitDistance: number;
  riskRewardRatio: number;
  recommendation: 'good' | 'acceptable' | 'risky';
}

interface PositionSizingCalculatorProps {
  accountBalance?: number;
  onCalculate?: (result: PositionSizeResult) => void;
}

export function PositionSizingCalculator({ 
  accountBalance: initialBalance, 
  onCalculate 
}: PositionSizingCalculatorProps) {
  const [accountBalance, setAccountBalance] = useState(initialBalance || 10000);
  const [riskPercent, setRiskPercent] = useState(2);
  const [entryPrice, setEntryPrice] = useState(0);
  const [stopLossPrice, setStopLossPrice] = useState(0);
  const [takeProfitPrice, setTakeProfitPrice] = useState(0);
  const [leverage, setLeverage] = useState(1);

  const [result, setResult] = useState<PositionSizeResult | null>(null);

  useEffect(() => {
    if (entryPrice > 0 && stopLossPrice > 0 && entryPrice !== stopLossPrice) {
      calculatePositionSize();
    }
  }, [accountBalance, riskPercent, entryPrice, stopLossPrice, takeProfitPrice, leverage]);

  const calculatePositionSize = () => {
    // Calculate risk amount
    const riskAmount = (accountBalance * riskPercent) / 100;

    // Calculate stop-loss distance
    const stopLossDistance = Math.abs(entryPrice - stopLossPrice);
    const stopLossPercent = (stopLossDistance / entryPrice) * 100;

    // Calculate position size based on risk
    const positionSize = riskAmount / stopLossDistance;

    // Calculate position value
    const positionValue = positionSize * entryPrice;

    // Calculate margin required (with leverage)
    const marginRequired = positionValue / leverage;

    // Calculate take-profit distance and R:R ratio
    let takeProfitDistance = 0;
    let riskRewardRatio = 0;
    if (takeProfitPrice > 0) {
      takeProfitDistance = Math.abs(takeProfitPrice - entryPrice);
      riskRewardRatio = takeProfitDistance / stopLossDistance;
    }

    // Determine recommendation
    let recommendation: 'good' | 'acceptable' | 'risky' = 'acceptable';
    if (riskRewardRatio >= 2 && riskPercent <= 2) {
      recommendation = 'good';
    } else if (riskPercent > 3 || riskRewardRatio < 1) {
      recommendation = 'risky';
    }

    const calculatedResult: PositionSizeResult = {
      positionSize,
      riskAmount,
      positionValue,
      marginRequired,
      stopLossDistance,
      takeProfitDistance,
      riskRewardRatio,
      recommendation,
    };

    setResult(calculatedResult);
    onCalculate?.(calculatedResult);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatNumber = (value: number, decimals: number = 4) => {
    return value.toFixed(decimals);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Calculator className="w-5 h-5" />
          <CardTitle>Position Sizing Calculator</CardTitle>
        </div>
        <CardDescription>
          Calculate optimal position size based on your risk tolerance
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Input Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Account Balance */}
          <div className="space-y-2">
            <Label htmlFor="balance">Account Balance</Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="balance"
                type="number"
                value={accountBalance}
                onChange={(e) => setAccountBalance(parseFloat(e.target.value) || 0)}
                className="pl-9"
                step="100"
              />
            </div>
          </div>

          {/* Entry Price */}
          <div className="space-y-2">
            <Label htmlFor="entry">Entry Price</Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="entry"
                type="number"
                value={entryPrice || ''}
                onChange={(e) => setEntryPrice(parseFloat(e.target.value) || 0)}
                className="pl-9"
                step="0.01"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Stop Loss Price */}
          <div className="space-y-2">
            <Label htmlFor="stopLoss">Stop Loss Price</Label>
            <div className="relative">
              <TrendingDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />
              <Input
                id="stopLoss"
                type="number"
                value={stopLossPrice || ''}
                onChange={(e) => setStopLossPrice(parseFloat(e.target.value) || 0)}
                className="pl-9"
                step="0.01"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Take Profit Price */}
          <div className="space-y-2">
            <Label htmlFor="takeProfit">Take Profit Price (Optional)</Label>
            <div className="relative">
              <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
              <Input
                id="takeProfit"
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

        {/* Risk Percentage Slider */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Risk Per Trade</Label>
            <Badge variant={riskPercent <= 2 ? 'default' : riskPercent <= 3 ? 'secondary' : 'destructive'}>
              {riskPercent}%
            </Badge>
          </div>
          <Slider
            value={[riskPercent]}
            onValueChange={([v]) => setRiskPercent(v)}
            min={0.5}
            max={5}
            step={0.5}
          />
          <p className="text-xs text-muted-foreground">
            {riskPercent <= 1 && 'Very Conservative'}
            {riskPercent > 1 && riskPercent <= 2 && 'Conservative (Recommended)'}
            {riskPercent > 2 && riskPercent <= 3 && 'Moderate Risk'}
            {riskPercent > 3 && 'High Risk - Not Recommended'}
          </p>
        </div>

        {/* Leverage Slider */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Leverage</Label>
            <Badge variant="outline">{leverage}x</Badge>
          </div>
          <Slider
            value={[leverage]}
            onValueChange={([v]) => setLeverage(v)}
            min={1}
            max={10}
            step={1}
          />
          <p className="text-xs text-muted-foreground">
            {leverage === 1 && 'No Leverage (Safest)'}
            {leverage > 1 && leverage <= 3 && 'Low Leverage'}
            {leverage > 3 && leverage <= 5 && 'Moderate Leverage'}
            {leverage > 5 && 'High Leverage - Increased Risk'}
          </p>
        </div>

        {/* Results Section */}
        {result && (
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">Calculation Results</h4>
              {result.recommendation === 'good' && (
                <Badge className="bg-green-600">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Good Setup
                </Badge>
              )}
              {result.recommendation === 'acceptable' && (
                <Badge variant="secondary">Acceptable</Badge>
              )}
              {result.recommendation === 'risky' && (
                <Badge variant="destructive">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  High Risk
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Position Size</div>
                <div className="text-xl font-bold font-mono">
                  {formatNumber(result.positionSize, 6)}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Position Value</div>
                <div className="text-xl font-bold font-mono">
                  {formatCurrency(result.positionValue)}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Risk Amount</div>
                <div className="text-xl font-bold font-mono text-red-500">
                  {formatCurrency(result.riskAmount)}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Margin Required</div>
                <div className="text-xl font-bold font-mono">
                  {formatCurrency(result.marginRequired)}
                </div>
              </div>

              {result.riskRewardRatio > 0 && (
                <div className="space-y-1 col-span-2">
                  <div className="text-sm text-muted-foreground">Risk-Reward Ratio</div>
                  <div className="text-2xl font-bold font-mono">
                    1:{formatNumber(result.riskRewardRatio, 2)}
                  </div>
                </div>
              )}
            </div>

            {/* Warnings and Recommendations */}
            {result.marginRequired > accountBalance && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Insufficient balance! Required margin ({formatCurrency(result.marginRequired)}) exceeds account balance.
                </AlertDescription>
              </Alert>
            )}

            {result.riskRewardRatio > 0 && result.riskRewardRatio < 1.5 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Low risk-reward ratio. Consider adjusting your take-profit target to at least 2:1 ratio.
                </AlertDescription>
              </Alert>
            )}

            {riskPercent > 3 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  High risk per trade! Professional traders typically risk 1-2% per trade.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Kelly Criterion Calculator */}
        {result && result.riskRewardRatio > 0 && (
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <h4 className="font-semibold text-sm">Kelly Criterion (Advanced)</h4>
            <p className="text-xs text-muted-foreground">
              Assuming 50% win rate, optimal position size is approximately{' '}
              <span className="font-mono font-bold">
                {formatNumber((0.5 - (0.5 / result.riskRewardRatio)) * 100, 1)}%
              </span>{' '}
              of account balance
            </p>
            <p className="text-xs text-muted-foreground">
              Your current position: {formatNumber((result.positionValue / accountBalance) * 100, 1)}% of account
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
