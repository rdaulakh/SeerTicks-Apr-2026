import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, Brain, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface AgentVote {
  name: string;
  weight: number;
  signal: string;
  confidence: number;
}

interface OrchestratorState {
  fastAgents: AgentVote[];
  slowAgents: AgentVote[];
  fastScore: number;
  slowBonus: number;
  totalConfidence: number;
  threshold: number;
  recommendation: string;
}

export function StrategyOrchestratorViz() {
  const { data: orchestratorData, isLoading } = trpc.seerMulti.getOrchestratorState.useQuery(undefined, {
    refetchInterval: 2000, // Update every 2 seconds
  });

  if (isLoading) {
    return (
      <Card className="glass p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 border-4 border-gray-700 border-t-blue-500 rounded-full animate-spin mx-auto" />
            <p className="text-muted-foreground">Loading orchestrator data...</p>
          </div>
        </div>
      </Card>
    );
  }

  if (!orchestratorData) {
    return (
      <Card className="glass p-8">
        <div className="text-center space-y-4">
          <Brain className="w-16 h-16 text-gray-400 mx-auto" />
          <h3 className="text-xl font-semibold">No Data Available</h3>
          <p className="text-muted-foreground">
            Start the engine to see Strategy Orchestrator consensus calculations
          </p>
        </div>
      </Card>
    );
  }

  const orchestrator = orchestratorData as OrchestratorState;

  const getSignalIcon = (signal: string) => {
    switch (signal) {
      case "bullish":
        return <TrendingUp className="w-4 h-4" />;
      case "bearish":
        return <TrendingDown className="w-4 h-4" />;
      default:
        return <Minus className="w-4 h-4" />;
    }
  };

  const getSignalColor = (signal: string) => {
    switch (signal) {
      case "bullish":
        return "text-green-400 bg-green-500/10 border-green-500/20";
      case "bearish":
        return "text-red-400 bg-red-500/10 border-red-500/20";
      default:
        return "text-gray-400 bg-gray-500/10 border-gray-500/20";
    }
  };

  const getRecommendationColor = (rec: string) => {
    switch (rec) {
      case "BUY":
        return "bg-gradient-to-r from-green-600 to-emerald-600";
      case "SELL":
        return "bg-gradient-to-r from-red-600 to-rose-600";
      default:
        return "bg-gradient-to-r from-gray-600 to-gray-700";
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card className="glass p-8">
        <div className="flex items-center gap-3 mb-6">
          <Brain className="w-8 h-8 text-purple-400" />
          <h2 className="text-2xl font-bold">Weighted Consensus Breakdown</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div>
            <p className="text-sm text-muted-foreground mb-2">Fast Agent Score</p>
            <p className="text-3xl font-bold font-mono text-blue-400">
              {orchestrator.fastScore}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">Base (100%)</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-2">Slow Agent Bonus</p>
            <p className="text-3xl font-bold font-mono text-purple-400">
              {orchestrator.slowBonus >= 0 ? "+" : ""}
              {orchestrator.slowBonus}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">Bonus (20%)</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-2">Total Confidence</p>
            <p className="text-3xl font-bold font-mono text-green-400">
              {orchestrator.totalConfidence}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">Combined</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-2">Threshold</p>
            <p className="text-3xl font-bold font-mono text-yellow-400">
              {orchestrator.threshold}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">Minimum to execute</p>
          </div>
        </div>

        {/* Confidence Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Confidence vs Threshold</span>
            <span className="text-sm font-mono">
              {orchestrator.totalConfidence}% / {orchestrator.threshold}%
            </span>
          </div>
          <div className="h-4 bg-gray-800 rounded-full overflow-hidden relative">
            <div
              className="absolute top-0 left-0 h-full border-r-2 border-yellow-400 z-10"
              style={{ left: `${orchestrator.threshold}%` }}
            />
            <div
              className={`h-full ${
                orchestrator.totalConfidence >= orchestrator.threshold
                  ? "bg-gradient-to-r from-green-600 to-emerald-600"
                  : "bg-gradient-to-r from-gray-600 to-gray-700"
              } transition-all duration-500`}
              style={{ width: `${Math.min(orchestrator.totalConfidence, 100)}%` }}
            />
          </div>
        </div>

        {/* Final Recommendation */}
        <div className="p-6 rounded-lg bg-gray-800/50 border border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-6 h-6 text-yellow-400" />
              <div>
                <p className="text-sm text-muted-foreground mb-1">Final Recommendation</p>
                <p className="text-2xl font-bold">{orchestrator.recommendation}</p>
              </div>
            </div>
            <div
              className={`px-6 py-3 rounded-lg ${getRecommendationColor(
                orchestrator.recommendation
              )} text-white font-bold text-xl`}
            >
              {orchestrator.recommendation}
            </div>
          </div>
        </div>
      </Card>

      {/* Fast Agents Breakdown */}
      <Card className="glass p-6">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-5 h-5 text-blue-400" />
          <h3 className="text-xl font-bold">Fast Agents (100% Weight)</h3>
          <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">
            Tick-based
          </Badge>
        </div>
        <div className="space-y-4">
          {orchestrator.fastAgents.map((agent, index) => (
            <div
              key={index}
              className="p-4 rounded-lg bg-gray-800/30 border border-gray-700/50"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h4 className="font-semibold">{agent.name}</h4>
                  <Badge className={`${getSignalColor(agent.signal)} border`}>
                    <span className="flex items-center gap-1">
                      {getSignalIcon(agent.signal)}
                      {agent.signal}
                    </span>
                  </Badge>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Weight</p>
                  <p className="text-lg font-mono font-bold">{agent.weight.toFixed(1)}%</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex-1 mr-4">
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        agent.signal === "bullish"
                          ? "bg-green-500"
                          : agent.signal === "bearish"
                          ? "bg-red-500"
                          : "bg-gray-500"
                      } transition-all duration-500`}
                      style={{ width: `${agent.confidence}%` }}
                    />
                  </div>
                </div>
                <span className="text-sm font-mono font-semibold">
                  {agent.confidence.toFixed(1)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Slow Agents Breakdown */}
      <Card className="glass p-6">
        <div className="flex items-center gap-2 mb-4">
          <Brain className="w-5 h-5 text-purple-400" />
          <h3 className="text-xl font-bold">Slow Agents (20% Bonus Weight)</h3>
          <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20">
            Periodic
          </Badge>
        </div>
        <div className="space-y-4">
          {orchestrator.slowAgents.map((agent, index) => (
            <div
              key={index}
              className="p-4 rounded-lg bg-gray-800/30 border border-gray-700/50"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h4 className="font-semibold">{agent.name}</h4>
                  <Badge className={`${getSignalColor(agent.signal)} border`}>
                    <span className="flex items-center gap-1">
                      {getSignalIcon(agent.signal)}
                      {agent.signal}
                    </span>
                  </Badge>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Weight</p>
                  <p className="text-lg font-mono font-bold">{agent.weight.toFixed(1)}%</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex-1 mr-4">
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        agent.signal === "bullish"
                          ? "bg-green-500"
                          : agent.signal === "bearish"
                          ? "bg-red-500"
                          : "bg-gray-500"
                      } transition-all duration-500`}
                      style={{ width: `${agent.confidence}%` }}
                    />
                  </div>
                </div>
                <span className="text-sm font-mono font-semibold">
                  {agent.confidence.toFixed(1)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Formula Explanation */}
      <Card className="glass p-6 bg-blue-500/5 border-blue-500/20">
        <h3 className="text-lg font-bold mb-4 text-blue-400">Consensus Formula</h3>
        <div className="space-y-2 font-mono text-sm">
          <p className="text-muted-foreground">
            <span className="text-blue-400">Fast Score</span> = Weighted average of fast agents (100% weight)
          </p>
          <p className="text-muted-foreground">
            <span className="text-purple-400">Slow Bonus</span> = Weighted average of slow agents (20% weight)
          </p>
          <p className="text-muted-foreground">
            <span className="text-green-400">Total Confidence</span> = |Fast Score + Slow Bonus|
          </p>
          <p className="text-muted-foreground mt-4">
            <span className="text-yellow-400">Recommendation</span>:
          </p>
          <ul className="list-disc list-inside ml-4 text-muted-foreground">
            <li>BUY if (Fast Score + Slow Bonus) &gt; {orchestrator.threshold}%</li>
            <li>SELL if (Fast Score + Slow Bonus) &lt; -{orchestrator.threshold}%</li>
            <li>HOLD otherwise</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}
