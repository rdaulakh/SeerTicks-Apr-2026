/**
 * Candle Cache Monitor Widget
 * 
 * Real-time monitoring of the WebSocket candle cache status
 * for each symbol and timeframe. Shows data availability
 * and health status for fast agent analysis.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Database,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  BarChart3,
  Clock,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

interface CandleCacheMonitorProps {
  className?: string;
  compact?: boolean;
}

export function CandleCacheMonitor({ className, compact = false }: CandleCacheMonitorProps) {
  const [expanded, setExpanded] = useState(!compact);
  
  const { data, isLoading, refetch, isFetching } = trpc.health.getCandleCacheStatus.useQuery(undefined, {
    refetchInterval: 10000, // Refresh every 10 seconds
    staleTime: 5000,
  });

  const getStatusIcon = (status: 'healthy' | 'low' | 'empty' | 'degraded' | 'critical') => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
      case 'low':
      case 'degraded':
        return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
      case 'empty':
      case 'critical':
        return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    }
  };

  const getStatusColor = (status: 'healthy' | 'low' | 'empty' | 'degraded' | 'critical') => {
    switch (status) {
      case 'healthy':
        return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
      case 'low':
      case 'degraded':
        return "bg-amber-500/10 text-amber-500 border-amber-500/20";
      case 'empty':
      case 'critical':
        return "bg-red-500/10 text-red-500 border-red-500/20";
    }
  };

  const getOverallHealthColor = (health: string) => {
    switch (health) {
      case 'healthy':
        return "text-emerald-500";
      case 'degraded':
        return "text-amber-500";
      case 'critical':
        return "text-red-500";
      default:
        return "text-muted-foreground";
    }
  };

  if (isLoading) {
    return (
      <Card className={cn("", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="h-4 w-4" />
            Candle Cache
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className={cn("", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="h-4 w-4" />
            Candle Cache
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Unable to load cache status</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="h-4 w-4" />
            Candle Cache
            <Badge 
              variant="outline" 
              className={cn("text-[10px] px-1.5 py-0", getStatusColor(data.summary.overallHealth as any))}
            >
              {data.summary.overallHealth.toUpperCase()}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <div className="text-center">
            <div className="text-lg font-semibold">{data.summary.totalCandles.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground">Total Candles</div>
          </div>
          <div className="text-center">
            <div className={cn("text-lg font-semibold", "text-emerald-500")}>{data.summary.healthySymbols}</div>
            <div className="text-[10px] text-muted-foreground">Healthy</div>
          </div>
          <div className="text-center">
            <div className={cn("text-lg font-semibold", "text-amber-500")}>{data.summary.degradedSymbols}</div>
            <div className="text-[10px] text-muted-foreground">Degraded</div>
          </div>
          <div className="text-center">
            <div className={cn("text-lg font-semibold", "text-red-500")}>{data.summary.criticalSymbols}</div>
            <div className="text-[10px] text-muted-foreground">Critical</div>
          </div>
        </div>

        {expanded && (
          <div className="space-y-3 mt-4">
            {/* Symbol Details */}
            {data.symbols.map((symbol) => (
              <div key={symbol.symbol} className="border rounded-lg p-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{symbol.symbol}</span>
                    {getStatusIcon(symbol.overallStatus)}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {symbol.totalCandles.toLocaleString()} candles
                  </span>
                </div>
                
                {/* Timeframe Grid */}
                <div className="grid grid-cols-6 gap-1">
                  {symbol.timeframes.map((tf) => (
                    <Tooltip key={tf.timeframe}>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "text-center p-1 rounded text-[10px] border cursor-help",
                            getStatusColor(tf.status)
                          )}
                        >
                          <div className="font-medium">{tf.timeframe}</div>
                          <div className="opacity-80">{tf.candleCount}</div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <div className="space-y-1 text-xs">
                          <div className="font-medium">{symbol.symbol} - {tf.timeframe}</div>
                          <div className="flex items-center gap-1">
                            <BarChart3 className="h-3 w-3" />
                            <span>{tf.candleCount} candles ({tf.coverage} coverage)</span>
                          </div>
                          {tf.oldestCandle && (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              <span>From: {tf.oldestCandle}</span>
                            </div>
                          )}
                          {tf.newestCandle && (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              <span>To: {tf.newestCandle}</span>
                            </div>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>
            ))}

            {/* Aggregator Status */}
            <div className="border rounded-lg p-2 bg-muted/30">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Tick Aggregator</span>
                <div className="flex items-center gap-2">
                  {data.aggregatorStatus.isRunning ? (
                    <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                      Running
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/20">
                      Idle
                    </Badge>
                  )}
                  <span className="text-muted-foreground">
                    {data.aggregatorStatus.ticksProcessed.toLocaleString()} ticks
                  </span>
                </div>
              </div>
              {data.aggregatorStatus.lastTickTime && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  Last tick: {data.aggregatorStatus.lastTickTime}
                </div>
              )}
            </div>

            {/* Last Updated */}
            <div className="text-[10px] text-muted-foreground text-right">
              Updated: {data.timestampIST}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
