/**
 * Position Size Recommendation Dialog
 * 
 * Pre-trade dialog showing Kelly criterion recommendations,
 * risk/reward analysis, and capital allocation guidance
 */

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export interface PositionSizeRecommendation {
  kellyFraction: number;
  adjustedFraction: number;
  positionSizeUSD: number;
  positionSizeUnits: number;
  riskPercentage: number;
  reasoning: string;
  winRate: number;
  profitFactor: number;
  confidence: number;
  currentPrice: number;
  accountBalance: number;
}

interface PositionSizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  recommendation: PositionSizeRecommendation;
  onConfirm: (adjustedSize: number) => void;
  onCancel: () => void;
}

export function PositionSizeDialog({
  open,
  onOpenChange,
  symbol,
  recommendation,
  onConfirm,
  onCancel,
}: PositionSizeDialogProps) {
  const [positionSizeMultiplier, setPositionSizeMultiplier] = useState(100); // 0-200% of Kelly
  const [customSize, setCustomSize] = useState(recommendation.positionSizeUSD);

  // Update custom size when slider changes
  useEffect(() => {
    const multiplier = positionSizeMultiplier / 100;
    setCustomSize(recommendation.positionSizeUSD * multiplier);
  }, [positionSizeMultiplier, recommendation.positionSizeUSD]);

  const handleConfirm = () => {
    onConfirm(customSize);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onCancel();
    onOpenChange(false);
  };

  // Calculate risk metrics
  const customRiskPercentage = (customSize / recommendation.accountBalance) * 100;
  const customUnits = customSize / recommendation.currentPrice;
  
  // Determine risk level
  const getRiskLevel = (riskPct: number): { level: string; color: string; icon: React.ReactNode } => {
    if (riskPct < 5) {
      return { level: "Low Risk", color: "text-green-500", icon: <CheckCircle2 className="h-4 w-4" /> };
    } else if (riskPct < 15) {
      return { level: "Moderate Risk", color: "text-yellow-500", icon: <Info className="h-4 w-4" /> };
    } else if (riskPct < 25) {
      return { level: "High Risk", color: "text-orange-500", icon: <AlertTriangle className="h-4 w-4" /> };
    } else {
      return { level: "Extreme Risk", color: "text-red-500", icon: <AlertTriangle className="h-4 w-4" /> };
    }
  };

  const riskLevel = getRiskLevel(customRiskPercentage);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Position Size Recommendation
          </DialogTitle>
          <DialogDescription>
            Kelly Criterion analysis for {symbol}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Kelly Recommendation Card */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Recommended Position Size</p>
                    <p className="text-3xl font-bold">${recommendation.positionSizeUSD.toFixed(2)}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {recommendation.positionSizeUnits.toFixed(6)} {symbol}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-lg px-4 py-2">
                    {recommendation.riskPercentage.toFixed(2)}% Risk
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-4 pt-4 border-t">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="text-center cursor-help">
                          <p className="text-xs text-muted-foreground">Win Rate</p>
                          <p className="text-lg font-semibold">{(recommendation.winRate * 100).toFixed(1)}%</p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Historical probability of winning trades</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="text-center cursor-help">
                          <p className="text-xs text-muted-foreground">Profit Factor</p>
                          <p className="text-lg font-semibold">{recommendation.profitFactor.toFixed(2)}x</p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Average win / average loss ratio</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="text-center cursor-help">
                          <p className="text-xs text-muted-foreground">Confidence</p>
                          <p className="text-lg font-semibold">{(recommendation.confidence * 100).toFixed(0)}%</p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Agent consensus confidence level</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Kelly Reasoning */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Kelly Criterion Analysis</Label>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {recommendation.reasoning}
            </p>
          </div>

          {/* Position Size Adjustment */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Adjust Position Size</Label>
              <Badge variant={positionSizeMultiplier === 100 ? "default" : "secondary"}>
                {positionSizeMultiplier}% of Kelly
              </Badge>
            </div>

            <Slider
              value={[positionSizeMultiplier]}
              onValueChange={(value) => setPositionSizeMultiplier(value[0])}
              min={0}
              max={200}
              step={5}
              className="w-full"
            />

            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0% (No trade)</span>
              <span>100% (Kelly optimal)</span>
              <span>200% (2x Kelly)</span>
            </div>
          </div>

          {/* Custom Position Details */}
          <Card className={`border-2 ${customRiskPercentage > 25 ? 'border-red-500/50 bg-red-500/5' : 'border-border'}`}>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Your Position Size</p>
                    <p className="text-2xl font-bold">${customSize.toFixed(2)}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {customUnits.toFixed(6)} {symbol}
                    </p>
                  </div>
                  <div className={`flex items-center gap-2 ${riskLevel.color}`}>
                    {riskLevel.icon}
                    <span className="font-semibold">{riskLevel.level}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                  <div>
                    <p className="text-xs text-muted-foreground">Risk Percentage</p>
                    <p className="text-lg font-semibold">{customRiskPercentage.toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Account Balance</p>
                    <p className="text-lg font-semibold">${recommendation.accountBalance.toFixed(2)}</p>
                  </div>
                </div>

                {customRiskPercentage > 25 && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-red-500">
                      Warning: Position size exceeds 25% of account balance. This represents extreme risk and may lead to significant losses.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Risk/Reward Summary */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-green-500/20 bg-green-500/5">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <p className="text-sm font-medium text-green-500">Potential Profit</p>
                </div>
                <p className="text-2xl font-bold text-green-500">
                  ${(customSize * recommendation.profitFactor).toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Based on {recommendation.profitFactor.toFixed(2)}x profit factor
                </p>
              </CardContent>
            </Card>

            <Card className="border-red-500/20 bg-red-500/5">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingDown className="h-4 w-4 text-red-500" />
                  <p className="text-sm font-medium text-red-500">Potential Loss</p>
                </div>
                <p className="text-2xl font-bold text-red-500">
                  ${customSize.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Maximum risk if trade fails
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm}
            disabled={customSize <= 0 || customSize > recommendation.accountBalance}
          >
            Confirm Position
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
