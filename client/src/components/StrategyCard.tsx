import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, Pause, Square, Trash2, TrendingUp, TrendingDown, Settings } from "lucide-react";
import { Link } from "wouter";

interface StrategyCardProps {
  strategy: {
    id: number;
    name: string;
    strategyType: string;
    status: "active" | "paused" | "stopped";
    allocatedBalance: string;
    currentBalance: string;
    performance?: {
      totalPnL: string;
      winRate: string;
      totalTrades: number;
      openPositions: number;
    } | null;
    openPositionsCount: number;
  };
  onStart: (strategyId: number) => void;
  onPause: (strategyId: number) => void;
  onStop: (strategyId: number) => void;
  onDelete: (strategyId: number) => void;
}

export function StrategyCard({ strategy, onStart, onPause, onStop, onDelete }: StrategyCardProps) {
  const pnl = parseFloat(strategy.performance?.totalPnL || "0");
  const isProfitable = pnl >= 0;

  const getStatusBadge = () => {
    switch (strategy.status) {
      case "active":
        return <Badge className="bg-green-500">Active</Badge>;
      case "paused":
        return <Badge variant="secondary">Paused</Badge>;
      case "stopped":
        return <Badge variant="outline">Stopped</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="truncate">{strategy.name}</CardTitle>
            <CardDescription className="mt-1">
              {strategy.strategyType.charAt(0).toUpperCase() + strategy.strategyType.slice(1).replace("_", " ")}
            </CardDescription>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Performance Metrics */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">P&L</span>
            <div className="flex items-center gap-1">
              {isProfitable ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
              <span className={`font-semibold ${isProfitable ? "text-green-500" : "text-red-500"}`}>
                ${strategy.performance?.totalPnL || "0.00"}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Win Rate</span>
            <span className="font-medium">{strategy.performance?.winRate || "0.00"}%</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Trades</span>
            <span className="font-medium">{strategy.performance?.totalTrades || 0}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Open Positions</span>
            <span className="font-medium">{strategy.openPositionsCount}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Balance</span>
            <span className="font-medium">${strategy.currentBalance}</span>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex gap-2 pt-2 border-t">
          {strategy.status === "paused" && (
            <Button size="sm" variant="default" className="flex-1" onClick={() => onStart(strategy.id)}>
              <Play className="h-4 w-4 mr-1" />
              Start
            </Button>
          )}

          {strategy.status === "active" && (
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => onPause(strategy.id)}>
              <Pause className="h-4 w-4 mr-1" />
              Pause
            </Button>
          )}

          {(strategy.status === "active" || strategy.status === "paused") && (
            <Button size="sm" variant="outline" onClick={() => onStop(strategy.id)}>
              <Square className="h-4 w-4" />
            </Button>
          )}

          <Link href={`/strategy/${strategy.id}`}>
            <Button size="sm" variant="outline">
              <Settings className="h-4 w-4" />
            </Button>
          </Link>

          {strategy.status === "stopped" && (
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              onClick={() => onDelete(strategy.id)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
