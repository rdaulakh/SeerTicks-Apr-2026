import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

interface TimeframeSignal {
  timeframe: string;
  signal: "bullish" | "bearish" | "neutral";
  strength: number; // 0-100
  indicators: string[];
}

interface TimeframeAlignmentIndicatorProps {
  signals: TimeframeSignal[];
  consensusThreshold?: number; // How many timeframes need to align (default 2)
}

export function TimeframeAlignmentIndicator({
  signals,
  consensusThreshold = 2,
}: TimeframeAlignmentIndicatorProps) {
  // Calculate alignment
  const bullishCount = signals.filter((s) => s.signal === "bullish").length;
  const bearishCount = signals.filter((s) => s.signal === "bearish").length;
  const neutralCount = signals.filter((s) => s.signal === "neutral").length;

  const hasConsensus =
    bullishCount >= consensusThreshold || bearishCount >= consensusThreshold;
  const consensusDirection =
    bullishCount >= consensusThreshold
      ? "bullish"
      : bearishCount >= consensusThreshold
        ? "bearish"
        : "neutral";

  const avgStrength =
    signals.reduce((sum, s) => sum + s.strength, 0) / signals.length;

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">
            Multi-Timeframe Analysis
          </CardTitle>
          <div className="flex items-center gap-2">
            {hasConsensus ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <AlertCircle className="h-5 w-5 text-yellow-500" />
            )}
            <Badge
              variant={hasConsensus ? "default" : "secondary"}
              className={
                hasConsensus
                  ? consensusDirection === "bullish"
                    ? "bg-green-500/10 text-green-600 border-green-500/20"
                    : "bg-red-500/10 text-red-600 border-red-500/20"
                  : ""
              }
            >
              {hasConsensus
                ? `${consensusDirection.toUpperCase()} CONSENSUS`
                : "NO CONSENSUS"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Consensus Summary */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Alignment Status:</span>
          <span className="font-medium">
            {bullishCount}/{signals.length} Bullish · {bearishCount}/
            {signals.length} Bearish · {neutralCount}/{signals.length} Neutral
          </span>
        </div>

        {/* Average Signal Strength */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Signal Strength:</span>
            <span className="font-medium">{avgStrength.toFixed(0)}%</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                avgStrength >= 70
                  ? "bg-green-500"
                  : avgStrength >= 40
                    ? "bg-yellow-500"
                    : "bg-red-500"
              }`}
              style={{ width: `${avgStrength}%` }}
            />
          </div>
        </div>

        {/* Individual Timeframe Signals */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Timeframe Breakdown:
          </div>
          <div className="grid gap-2">
            {signals.map((signal, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 rounded-lg bg-secondary/30 border border-border/40"
              >
                <div className="flex items-center gap-2">
                  {signal.signal === "bullish" ? (
                    <TrendingUp className="h-4 w-4 text-green-500" />
                  ) : signal.signal === "bearish" ? (
                    <TrendingDown className="h-4 w-4 text-red-500" />
                  ) : (
                    <Minus className="h-4 w-4 text-gray-500" />
                  )}
                  <span className="font-medium text-sm">
                    {signal.timeframe}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {signal.strength}%
                  </span>
                  <Badge
                    variant="outline"
                    className={
                      signal.signal === "bullish"
                        ? "bg-green-500/10 text-green-600 border-green-500/20"
                        : signal.signal === "bearish"
                          ? "bg-red-500/10 text-red-600 border-red-500/20"
                          : "bg-gray-500/10 text-gray-600 border-gray-500/20"
                    }
                  >
                    {signal.signal.toUpperCase()}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Consensus Requirement Info */}
        <div className="pt-2 border-t border-border/40">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Consensus Threshold:</span> Requires{" "}
            {consensusThreshold} of {signals.length} timeframes to align for
            trade signal
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
