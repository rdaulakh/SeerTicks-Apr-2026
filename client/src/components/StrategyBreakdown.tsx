import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, TrendingDown, Minus, Target, Shield, Zap, Clock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface AgentVote {
  agentName: string;
  signal: "bullish" | "bearish" | "neutral";
  confidence: number;
  weight: number;
}

interface StrategyBreakdownProps {
  symbol: string;
  consensusScore: number; // -1 to +1
  confidence: number; // 0-1
  agentVotes: AgentVote[];
  action: "buy" | "sell" | "hold" | "reduce" | "exit";
  timestamp: number;
}

const FAST_AGENTS = ['TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst'];
const SLOW_AGENTS = ['SentimentAnalyst', 'NewsSentinel', 'MacroAnalyst', 'OnChainAnalyst'];

export function StrategyBreakdown({ 
  symbol, 
  consensusScore, 
  confidence, 
  agentVotes, 
  action,
  timestamp 
}: StrategyBreakdownProps) {
  // Separate fast and slow agents
  const fastVotes = agentVotes.filter(v => FAST_AGENTS.includes(v.agentName));
  const slowVotes = agentVotes.filter(v => SLOW_AGENTS.includes(v.agentName));

  // Calculate total weights
  const totalWeight = agentVotes.reduce((sum, v) => sum + v.weight, 0);
  const fastWeight = fastVotes.reduce((sum, v) => sum + v.weight, 0);
  const slowWeight = slowVotes.reduce((sum, v) => sum + v.weight, 0);

  // Calculate percentages
  const fastPercentage = totalWeight > 0 ? (fastWeight / totalWeight) * 100 : 0;
  const slowPercentage = totalWeight > 0 ? (slowWeight / totalWeight) * 100 : 0;

  // Consensus score to percentage (-1 to +1 → 0% to 100%)
  const consensusPercentage = ((consensusScore + 1) / 2) * 100;

  // Get action color and icon
  const getActionStyle = (action: string) => {
    switch (action) {
      case 'buy':
        return { color: 'text-green-600 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/30', icon: TrendingUp };
      case 'sell':
      case 'exit':
        return { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/30', icon: TrendingDown };
      default:
        return { color: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-900/30', icon: Minus };
    }
  };

  const actionStyle = getActionStyle(action);
  const ActionIcon = actionStyle.icon;

  // Get signal icon
  const getSignalIcon = (signal: string) => {
    switch (signal) {
      case 'bullish': return <TrendingUp className="h-3 w-3 text-green-600" />;
      case 'bearish': return <TrendingDown className="h-3 w-3 text-red-600" />;
      default: return <Minus className="h-3 w-3 text-gray-600" />;
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Strategy Consensus: {symbol}
            </CardTitle>
            <CardDescription>
              Multi-agent weighted consensus with execution score integration
            </CardDescription>
          </div>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${actionStyle.bg}`}>
            <ActionIcon className={`h-5 w-5 ${actionStyle.color}`} />
            <span className={`text-lg font-bold uppercase ${actionStyle.color}`}>
              {action}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Consensus Score */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Consensus Score</span>
            <span className="text-sm font-bold">
              {consensusScore > 0 ? '+' : ''}{consensusScore.toFixed(3)}
            </span>
          </div>
          <Progress 
            value={consensusPercentage} 
            className="h-3"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Bearish (-1.0)</span>
            <span>Neutral (0.0)</span>
            <span>Bullish (+1.0)</span>
          </div>
        </div>

        {/* Confidence */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Confidence
            </span>
            <span className="text-sm font-bold">{(confidence * 100).toFixed(1)}%</span>
          </div>
          <Progress 
            value={confidence * 100} 
            className="h-2"
          />
        </div>

        {/* Fast vs Slow Agent Contribution */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium">Fast Agents</span>
              </div>
              <div className="text-2xl font-bold text-blue-600">
                {fastPercentage.toFixed(1)}%
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {fastVotes.length} agents • 100% weight
              </div>
            </CardContent>
          </Card>

          <Card className="bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-purple-600" />
                <span className="text-sm font-medium">Slow Agents</span>
              </div>
              <div className="text-2xl font-bold text-purple-600">
                {slowPercentage.toFixed(1)}%
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {slowVotes.length} agents • 20% weight
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Agent Votes - Fast Agents */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-blue-600" />
            <h4 className="text-sm font-semibold">Fast Agents (Tick-Based)</h4>
          </div>
          <div className="space-y-2">
            {fastVotes.map((vote) => (
              <div key={vote.agentName} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  {getSignalIcon(vote.signal)}
                  <span className="text-sm font-medium">{vote.agentName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="outline" className="text-xs">
                        Conf: {(vote.confidence * 100).toFixed(1)}%
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Agent confidence in signal</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="secondary" className="text-xs font-bold">
                        Weight: {vote.weight.toFixed(4)}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Final weight = confidence × quality × accuracy × execution × 1.0 (fast)</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Agent Votes - Slow Agents */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-purple-600" />
            <h4 className="text-sm font-semibold">Slow Agents (Periodic)</h4>
          </div>
          <div className="space-y-2">
            {slowVotes.map((vote) => (
              <div key={vote.agentName} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  {getSignalIcon(vote.signal)}
                  <span className="text-sm font-medium">{vote.agentName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="outline" className="text-xs">
                        Conf: {(vote.confidence * 100).toFixed(1)}%
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Agent confidence in signal</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="secondary" className="text-xs font-bold">
                        Weight: {vote.weight.toFixed(4)}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Final weight = confidence × quality × accuracy × execution × 0.2 (slow)</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Timestamp */}
        <div className="text-xs text-muted-foreground text-center pt-2 border-t">
          Last updated: {new Date(timestamp).toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}
