import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, TrendingUp, Target, Zap, Award } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface AgentPerformance {
  name: string;
  symbol: string;
  exchange: string;
  tradingPair: string;
  accuracy: number;
  signals: number;
  uptime: number;
  avgConfidence: number;
  successRate: number;
}

export function AgentPerformanceLeaderboard() {
  const { data: agentsData, isLoading } = trpc.seerMulti.getAllAgents.useQuery(undefined, {
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <Card className="glass p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 border-4 border-gray-700 border-t-blue-500 rounded-full animate-spin mx-auto" />
            <p className="text-muted-foreground">Loading agent performance data...</p>
          </div>
        </div>
      </Card>
    );
  }

  if (!agentsData || agentsData.length === 0) {
    return (
      <Card className="glass p-8">
        <div className="text-center space-y-4">
          <Trophy className="w-16 h-16 text-gray-400 mx-auto" />
          <h3 className="text-xl font-semibold">No Performance Data</h3>
          <p className="text-muted-foreground">
            Start the engine to begin tracking agent performance metrics
          </p>
        </div>
      </Card>
    );
  }

  // Calculate performance metrics
  const agentPerformance: AgentPerformance[] = agentsData.map((agent: any) => ({
    name: agent.name,
    symbol: agent.symbol,
    exchange: agent.exchange,
    tradingPair: agent.tradingPair,
    accuracy: agent.metrics?.accuracy || 0,
    signals: agent.metrics?.signals || 0,
    uptime: agent.metrics?.uptime || 0,
    avgConfidence: agent.confidence || 0,
    successRate: agent.metrics?.accuracy || 0,
  }));

  // Sort by accuracy (descending)
  const sortedByAccuracy = [...agentPerformance].sort((a, b) => b.accuracy - a.accuracy);

  // Sort by signal count (descending)
  const sortedBySignals = [...agentPerformance].sort((a, b) => b.signals - a.signals);

  // Sort by uptime (descending)
  const sortedByUptime = [...agentPerformance].sort((a, b) => b.uptime - a.uptime);

  const getMedalColor = (rank: number) => {
    switch (rank) {
      case 0:
        return "text-yellow-400";
      case 1:
        return "text-gray-300";
      case 2:
        return "text-orange-400";
      default:
        return "text-gray-500";
    }
  };

  const getMedalIcon = (rank: number) => {
    if (rank < 3) {
      return <Trophy className={`w-5 h-5 ${getMedalColor(rank)}`} />;
    }
    return <span className="w-5 h-5 flex items-center justify-center text-gray-500 font-bold">{rank + 1}</span>;
  };

  const getPerformanceColor = (value: number) => {
    if (value >= 80) return "text-green-400";
    if (value >= 60) return "text-blue-400";
    if (value >= 40) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <div className="space-y-6">
      {/* Top Performers Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="glass p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-yellow-500/10">
              <Trophy className="w-6 h-6 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Top Accuracy</p>
              <p className="text-lg font-bold">{sortedByAccuracy[0]?.name || "N/A"}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-2xl font-mono font-bold text-yellow-400">
              {sortedByAccuracy[0]?.accuracy.toFixed(1) || 0}%
            </span>
            <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
              #{1}
            </Badge>
          </div>
        </Card>

        <Card className="glass p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Zap className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Most Active</p>
              <p className="text-lg font-bold">{sortedBySignals[0]?.name || "N/A"}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-2xl font-mono font-bold text-blue-400">
              {sortedBySignals[0]?.signals.toLocaleString() || 0}
            </span>
            <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">
              signals
            </Badge>
          </div>
        </Card>

        <Card className="glass p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-green-500/10">
              <Target className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Most Reliable</p>
              <p className="text-lg font-bold">{sortedByUptime[0]?.name || "N/A"}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-2xl font-mono font-bold text-green-400">
              {sortedByUptime[0]?.uptime.toFixed(1) || 0}%
            </span>
            <Badge className="bg-green-500/10 text-green-400 border-green-500/20">
              uptime
            </Badge>
          </div>
        </Card>
      </div>

      {/* Accuracy Leaderboard */}
      <Card className="glass p-6">
        <div className="flex items-center gap-3 mb-6">
          <Trophy className="w-6 h-6 text-yellow-400" />
          <h2 className="text-2xl font-bold">Accuracy Leaderboard</h2>
        </div>
        <div className="space-y-3">
          {sortedByAccuracy.map((agent, index) => (
            <div
              key={`${agent.exchange}-${agent.tradingPair}-${agent.name}`}
              className="flex items-center gap-4 p-4 rounded-lg bg-gray-800/30 border border-gray-700/50 animate-fadeInUp"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              <div className="flex-shrink-0 w-8">
                {getMedalIcon(index)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-semibold">{agent.name}</h4>
                  <Badge variant="outline" className="text-xs bg-gray-500/10 text-gray-400 border-gray-500/20">
                    {agent.exchange}
                  </Badge>
                  <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/20 font-mono">
                    {agent.tradingPair}
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 transition-all duration-500"
                      style={{ width: `${agent.accuracy}%` }}
                    />
                  </div>
                  <span className={`text-sm font-mono font-bold ${getPerformanceColor(agent.accuracy)}`}>
                    {agent.accuracy.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-xs text-muted-foreground">Signals</p>
                <p className="text-sm font-mono font-semibold">{agent.signals.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Signal Activity Leaderboard */}
      <Card className="glass p-6">
        <div className="flex items-center gap-3 mb-6">
          <Zap className="w-6 h-6 text-blue-400" />
          <h2 className="text-2xl font-bold">Signal Activity Leaderboard</h2>
        </div>
        <div className="space-y-3">
          {sortedBySignals.map((agent, index) => (
            <div
              key={`${agent.exchange}-${agent.tradingPair}-${agent.name}-signals`}
              className="flex items-center gap-4 p-4 rounded-lg bg-gray-800/30 border border-gray-700/50"
            >
              <div className="flex-shrink-0 w-8">
                {getMedalIcon(index)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-semibold">{agent.name}</h4>
                  <Badge variant="outline" className="text-xs bg-gray-500/10 text-gray-400 border-gray-500/20">
                    {agent.exchange}
                  </Badge>
                  <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/20 font-mono">
                    {agent.tradingPair}
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>Signal Count</span>
                      <span className="font-mono">{agent.signals.toLocaleString()}</span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-500"
                        style={{
                          width: `${Math.min((agent.signals / Math.max(...sortedBySignals.map(a => a.signals))) * 100, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-xs text-muted-foreground">Accuracy</p>
                <p className={`text-sm font-mono font-semibold ${getPerformanceColor(agent.accuracy)}`}>
                  {agent.accuracy.toFixed(1)}%
                </p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Reliability Leaderboard */}
      <Card className="glass p-6">
        <div className="flex items-center gap-3 mb-6">
          <Target className="w-6 h-6 text-green-400" />
          <h2 className="text-2xl font-bold">Reliability Leaderboard</h2>
        </div>
        <div className="space-y-3">
          {sortedByUptime.map((agent, index) => (
            <div
              key={`${agent.exchange}-${agent.tradingPair}-${agent.name}-uptime`}
              className="flex items-center gap-4 p-4 rounded-lg bg-gray-800/30 border border-gray-700/50"
            >
              <div className="flex-shrink-0 w-8">
                {getMedalIcon(index)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-semibold">{agent.name}</h4>
                  <Badge variant="outline" className="text-xs bg-gray-500/10 text-gray-400 border-gray-500/20">
                    {agent.exchange}
                  </Badge>
                  <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/20 font-mono">
                    {agent.tradingPair}
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-500"
                      style={{ width: `${agent.uptime}%` }}
                    />
                  </div>
                  <span className={`text-sm font-mono font-bold ${getPerformanceColor(agent.uptime)}`}>
                    {agent.uptime.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-xs text-muted-foreground">Signals</p>
                <p className="text-sm font-mono font-semibold">{agent.signals.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Performance Insights */}
      <Card className="glass p-6 bg-purple-500/5 border-purple-500/20">
        <div className="flex items-center gap-3 mb-4">
          <Award className="w-6 h-6 text-purple-400" />
          <h3 className="text-lg font-bold text-purple-400">Performance Insights</h3>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="text-purple-400 font-semibold">Top Performer:</span>{" "}
            {sortedByAccuracy[0]?.name} leads with {sortedByAccuracy[0]?.accuracy.toFixed(1)}% accuracy
          </p>
          <p>
            <span className="text-purple-400 font-semibold">Most Active:</span>{" "}
            {sortedBySignals[0]?.name} generated {sortedBySignals[0]?.signals.toLocaleString()} signals
          </p>
          <p>
            <span className="text-purple-400 font-semibold">Most Reliable:</span>{" "}
            {sortedByUptime[0]?.name} maintains {sortedByUptime[0]?.uptime.toFixed(1)}% uptime
          </p>
          <p className="mt-4 text-xs">
            <span className="text-yellow-400">💡 Tip:</span> Agents with high accuracy and uptime contribute more weight to the final consensus
          </p>
        </div>
      </Card>
    </div>
  );
}
