import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Brain, Zap, AlertCircle, TrendingUp, TrendingDown } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";

interface ActivityEvent {
  id: string;
  timestamp: string;
  agent: string;
  type: "signal" | "recommendation" | "trade" | "error";
  message: string;
  data?: any;
}

export function ActivityFeedStream() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "signal" | "recommendation" | "trade" | "error">("all");

  const { data: activityData } = trpc.seerMulti.getActivityFeed.useQuery(
    { limit: 50 },
    {
      refetchInterval: 2000, // Update every 2 seconds
    }
  );

  useEffect(() => {
    if (activityData) {
      setEvents(activityData as unknown as ActivityEvent[]);
    }
  }, [activityData]);

  const filteredEvents = filter === "all" ? events : events.filter((e) => e.type === filter);

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "signal":
        return <Activity className="w-4 h-4" />;
      case "recommendation":
        return <Brain className="w-4 h-4" />;
      case "trade":
        return <Zap className="w-4 h-4" />;
      case "error":
        return <AlertCircle className="w-4 h-4" />;
      default:
        return <Activity className="w-4 h-4" />;
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case "signal":
        return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      case "recommendation":
        return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      case "trade":
        return "bg-green-500/10 text-green-400 border-green-500/20";
      case "error":
        return "bg-red-500/10 text-red-400 border-red-500/20";
      default:
        return "bg-gray-500/10 text-gray-400 border-gray-500/20";
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    if (diffSecs < 60) return `${diffSecs}s ago`;
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const getSignalIcon = (signal: string) => {
    if (signal === "bullish") return <TrendingUp className="w-3 h-3 text-green-400" />;
    if (signal === "bearish") return <TrendingDown className="w-3 h-3 text-red-400" />;
    return null;
  };

  return (
    <div className="space-y-4">
      {/* Filter Buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "signal", "recommendation", "trade", "error"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === type
                ? "bg-blue-500 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
            {type !== "all" && (
              <span className="ml-1.5 text-xs opacity-70">
                ({events.filter((e) => e.type === type).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Activity Feed */}
      <Card className="glass p-6">
        <div className="flex items-center gap-3 mb-6">
          <Activity className="w-6 h-6 text-blue-400" />
          <h2 className="text-2xl font-bold">Live Activity Feed</h2>
          <Badge className="bg-green-500/10 text-green-400 border-green-500/20">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Live
            </span>
          </Badge>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="text-center py-12">
            <Activity className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Activity Yet</h3>
            <p className="text-muted-foreground">
              Start the engine to see real-time events and agent activity
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
            {filteredEvents.map((event, index) => (
              <div
                key={event.id}
                className="flex items-start gap-3 p-3 rounded-lg bg-gray-800/30 border border-gray-700/50 hover:bg-gray-800/50 transition-colors animate-fadeInUp"
                style={{ animationDelay: `${index * 20}ms` }}
              >
                <div className="flex-shrink-0 mt-0.5">
                  <div
                    className={`p-1.5 rounded-lg ${getActivityColor(event.type).replace(
                      "text-",
                      "bg-"
                    ).replace("border-", "")}`}
                  >
                    {getActivityIcon(event.type)}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{event.agent}</span>
                    <Badge className={`${getActivityColor(event.type)} text-xs`}>
                      {event.type}
                    </Badge>
                    {event.data?.signal && getSignalIcon(event.data.signal)}
                  </div>
                  <p className="text-sm text-muted-foreground">{event.message}</p>
                  {event.data && event.data.confidence && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden max-w-[200px]">
                        <div
                          className={`h-full ${
                            event.data.signal === "bullish"
                              ? "bg-green-500"
                              : event.data.signal === "bearish"
                              ? "bg-red-500"
                              : "bg-blue-500"
                          }`}
                          style={{ width: `${event.data.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">
                        {(event.data.confidence * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex-shrink-0 text-right">
                  <p className="text-xs text-muted-foreground">{formatTime(event.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
