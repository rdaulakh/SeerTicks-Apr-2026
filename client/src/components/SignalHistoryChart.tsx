import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, Clock } from "lucide-react";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";

interface SignalDataPoint {
  timestamp: number;
  agent: string;
  signal: "bullish" | "bearish" | "neutral";
  confidence: number;
}

export function SignalHistoryChart() {
  const [signalHistory, setSignalHistory] = useState<SignalDataPoint[]>([]);
  const [timeWindow, setTimeWindow] = useState<"1h" | "6h" | "24h">("1h");

  // Fetch activity feed which contains signal history
  const { data: activityData } = trpc.seerMulti.getActivityFeed.useQuery(
    { limit: 100 },
    {
      refetchInterval: 3000,
    }
  );

  useEffect(() => {
    if (activityData) {
      // Convert activity feed to signal data points
      const signals: SignalDataPoint[] = activityData
        .filter((event: any) => event.type === "signal")
        .map((event: any) => ({
          timestamp: new Date(event.timestamp).getTime(),
          agent: event.agent,
          signal: event.data?.signal || "neutral",
          confidence: (event.data?.confidence || 0) * 100,
        }));

      setSignalHistory(signals);
    }
  }, [activityData]);

  const getTimeWindowMs = () => {
    switch (timeWindow) {
      case "1h":
        return 60 * 60 * 1000;
      case "6h":
        return 6 * 60 * 60 * 1000;
      case "24h":
        return 24 * 60 * 60 * 1000;
    }
  };

  const now = Date.now();
  const windowStart = now - getTimeWindowMs();
  const filteredSignals = signalHistory.filter((s) => s.timestamp >= windowStart);

  // Group signals by agent
  const agentGroups = filteredSignals.reduce((acc, signal) => {
    if (!acc[signal.agent]) {
      acc[signal.agent] = [];
    }
    acc[signal.agent].push(signal);
    return acc;
  }, {} as Record<string, SignalDataPoint[]>);

  const getSignalColor = (signal: string) => {
    switch (signal) {
      case "bullish":
        return "bg-green-500";
      case "bearish":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const getSignalIcon = (signal: string) => {
    switch (signal) {
      case "bullish":
        return <TrendingUp className="w-3 h-3" />;
      case "bearish":
        return <TrendingDown className="w-3 h-3" />;
      default:
        return <Minus className="w-3 h-3" />;
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Calculate average confidence per agent
  const agentStats = Object.entries(agentGroups).map(([agent, signals]) => {
    const avgConfidence =
      signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length;
    const latestSignal = signals[signals.length - 1];
    return {
      agent,
      avgConfidence,
      signalCount: signals.length,
      latestSignal: latestSignal?.signal || "neutral",
      latestConfidence: latestSignal?.confidence || 0,
    };
  });

  return (
    <div className="space-y-6">
      {/* Time Window Selector */}
      <Card className="glass p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Clock className="w-6 h-6 text-blue-400" />
            <h2 className="text-2xl font-bold">Signal History</h2>
          </div>
          <div className="flex gap-2">
            {(["1h", "6h", "24h"] as const).map((window) => (
              <button
                key={window}
                onClick={() => setTimeWindow(window)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  timeWindow === window
                    ? "bg-blue-500 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {window}
              </button>
            ))}
          </div>
        </div>

        {filteredSignals.length === 0 ? (
          <div className="text-center py-12">
            <Clock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Signal History</h3>
            <p className="text-muted-foreground">
              Start the engine to begin tracking agent signals over time
            </p>
          </div>
        ) : (
          <>
            {/* Agent Statistics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {agentStats.map((stat) => (
                <Card key={stat.agent} className="glass p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className="font-semibold text-sm mb-1">{stat.agent}</h4>
                      <Badge
                        className={`${
                          stat.latestSignal === "bullish"
                            ? "bg-green-500/10 text-green-400 border-green-500/20"
                            : stat.latestSignal === "bearish"
                            ? "bg-red-500/10 text-red-400 border-red-500/20"
                            : "bg-gray-500/10 text-gray-400 border-gray-500/20"
                        } text-xs`}
                      >
                        <span className="flex items-center gap-1">
                          {getSignalIcon(stat.latestSignal)}
                          {stat.latestSignal}
                        </span>
                      </Badge>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Signals</p>
                      <p className="text-lg font-mono font-bold">{stat.signalCount}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Avg Confidence</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-all duration-500"
                            style={{ width: `${stat.avgConfidence}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono">
                          {stat.avgConfidence.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Latest Confidence</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${
                              stat.latestSignal === "bullish"
                                ? "bg-green-500"
                                : stat.latestSignal === "bearish"
                                ? "bg-red-500"
                                : "bg-gray-500"
                            }`}
                            style={{ width: `${stat.latestConfidence}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono">
                          {stat.latestConfidence.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Timeline View */}
            <div className="space-y-3">
              <h3 className="text-lg font-bold mb-4">Signal Timeline</h3>
              {filteredSignals
                .slice()
                .reverse()
                .slice(0, 20)
                .map((signal, index) => (
                  <div
                    key={`${signal.agent}-${signal.timestamp}-${index}`}
                    className="flex items-center gap-4 p-3 rounded-lg bg-gray-800/30 border border-gray-700/50 animate-fadeInUp"
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    <div className="flex-shrink-0">
                      <div
                        className={`w-3 h-3 rounded-full ${getSignalColor(
                          signal.signal
                        )}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm">{signal.agent}</span>
                        <Badge
                          className={`${
                            signal.signal === "bullish"
                              ? "bg-green-500/10 text-green-400 border-green-500/20"
                              : signal.signal === "bearish"
                              ? "bg-red-500/10 text-red-400 border-red-500/20"
                              : "bg-gray-500/10 text-gray-400 border-gray-500/20"
                          } text-xs`}
                        >
                          {signal.signal}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${getSignalColor(signal.signal)}`}
                            style={{ width: `${signal.confidence}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-muted-foreground">
                          {signal.confidence.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className="text-xs text-muted-foreground">
                        {formatTime(signal.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
