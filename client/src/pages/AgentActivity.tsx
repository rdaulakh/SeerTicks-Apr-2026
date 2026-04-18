import { useState, useEffect } from "react";
import React from "react";
import { Activity, Clock, TrendingUp, TrendingDown, Minus, Zap, Brain, AlertCircle, Search, Layers } from "lucide-react";
import { SeerLoader } from "@/components/SeerLoader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";

interface AgentStatus {
  name: string;
  symbol: string; // Full symbol like "binance:BTCUSDT"
  exchange: string; // Exchange name like "binance"
  tradingPair: string; // Trading pair like "BTCUSDT"
  type: "fast" | "slow";
  status: "active" | "idle" | "error";
  lastUpdate: string;
  lastTickTime?: number; // Timestamp of last tick received (for fast agents)
  ticksReceived?: number; // Total ticks received (for fast agents)
  nextUpdate?: string;
  signal: "bullish" | "bearish" | "neutral";
  confidence: number;
  executionScore?: number; // 0-100 tactical timing score
  reasoning: string;
  metrics?: {
    accuracy: number;
    signals: number;
    uptime: number;
  };
}

interface ActivityEvent {
  id: string;
  timestamp: string;
  agent: string;
  type: "signal" | "recommendation" | "trade" | "error";
  message: string;
  data?: any;
}

// Helper functions (moved outside component for reusability)
const getStatusColor = (status: string) => {
  switch (status) {
    case "active":
      return "bg-green-500/10 text-green-400 border-green-500/20";
    case "idle":
      return "bg-gray-500/10 text-gray-400 border-gray-500/20";
    case "error":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    default:
      return "bg-gray-500/10 text-gray-400 border-gray-500/20";
  }
};

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

const formatTimeAgo = (timestamp: string, isFastAgent: boolean = false) => {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diffMs / 1000);
  
  if (isFastAgent) {
    if (diffMs < 1000) return `Last tick: ${diffMs}ms ago`;
    if (seconds < 60) return `Last tick: ${seconds}s ago`;
    return `Last tick: ${Math.floor(seconds / 60)}m ago`;
  }
  
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
};

// Format tick time with millisecond precision for fast agents
const formatTickTime = (lastTickTime: number | undefined, ticksReceived: number | undefined) => {
  if (!lastTickTime || lastTickTime === 0) {
    return 'Waiting for ticks...';
  }
  
  const diffMs = Date.now() - lastTickTime;
  const tickCount = ticksReceived || 0;
  
  if (diffMs < 1000) {
    return `Last tick: ${diffMs}ms ago (${tickCount.toLocaleString()} total)`;
  } else if (diffMs < 60000) {
    return `Last tick: ${Math.floor(diffMs / 1000)}s ago (${tickCount.toLocaleString()} total)`;
  } else {
    return `Last tick: ${Math.floor(diffMs / 60000)}m ago (${tickCount.toLocaleString()} total)`;
  }
};

const formatCountdown = (timestamp: string) => {
  const seconds = Math.floor((new Date(timestamp).getTime() - Date.now()) / 1000);
  if (seconds < 0) return "updating...";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
};

const truncateReasoning = (text: string, maxLength: number = 150) => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

// AgentCard Component
function AgentCard({ agent, index }: { agent: AgentStatus; index: number }) {
  return (
    <Card
      className="glass p-6 animate-fadeInUp"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold">{agent.name}</h3>
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-xs bg-gray-500/10 text-gray-400 border-gray-500/20">
                {agent.exchange}
              </Badge>
              <span className="text-xs text-muted-foreground">•</span>
              <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/20 font-mono">
                {agent.tradingPair}
              </Badge>
            </div>
          </div>
          {agent.type === 'fast' ? (
            <p className="text-xs text-green-400 font-mono">
              {formatTickTime(agent.lastTickTime, agent.ticksReceived)}
            </p>
          ) : (
            agent.nextUpdate ? (
              <p className="text-xs text-blue-400">
                Next update in {formatCountdown(agent.nextUpdate)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Waiting for update...
              </p>
            )
          )}
        </div>
        <Badge className={getStatusColor(agent.status)}>
          <span className="flex items-center gap-1">
            {agent.status === "active" && (
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            )}
            {agent.status}
          </span>
        </Badge>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Badge className={`${getSignalColor(agent.signal)} border`}>
            <span className="flex items-center gap-1">
              {getSignalIcon(agent.signal)}
              {agent.signal}
            </span>
          </Badge>
          <span className="text-sm font-mono font-semibold">
            {agent.confidence.toFixed(1)}% confidence
          </span>
        </div>

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

        <div className="mt-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Zap className="w-3 h-3" />
              Execution Score
            </span>
            <span className={`text-xs font-mono font-semibold ${
              agent.executionScore === undefined ? "text-gray-600" : ""
            }`}>
              {agent.executionScore !== undefined ? agent.executionScore.toFixed(0) : "0"}/100
            </span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                agent.executionScore === undefined
                  ? "bg-gray-700"
                  : agent.executionScore >= 70
                  ? "bg-blue-500"
                  : agent.executionScore >= 50
                  ? "bg-yellow-500"
                  : "bg-gray-500"
              }`}
              style={{ width: `${agent.executionScore ?? 0}%` }}
            />
          </div>
        </div>

        <p className="text-sm text-muted-foreground line-clamp-2">
          {truncateReasoning(agent.reasoning)}
        </p>

        {agent.metrics && (
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Accuracy</p>
              <p className="text-sm font-mono font-semibold">
                {agent.metrics.accuracy}%
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Signals</p>
              <p className="text-sm font-mono font-semibold">
                {agent.metrics.signals.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Uptime</p>
              <p className="text-sm font-mono font-semibold">
                {agent.metrics.uptime}%
              </p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

interface OrchestratorState {
  fastAgents: { name: string; weight: number; signal: string; confidence: number }[];
  slowAgents: { name: string; weight: number; signal: string; confidence: number }[];
  fastScore: number;
  slowBonus: number;
  totalConfidence: number;
  threshold: number;
  recommendation: string;
}

export default function AgentActivity() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [orchestrator, setOrchestrator] = useState<OrchestratorState | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch real agent data
  const { data: agentsData, isLoading: agentsLoading } = trpc.seerMulti.getAllAgents.useQuery(undefined, {
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Fetch orchestrator consensus data
  const { data: orchestratorData } = trpc.seerMulti.getOrchestratorState.useQuery(undefined, {
    refetchInterval: 5000,
  });

  // Fetch activity feed
  const { data: activityData } = trpc.seerMulti.getActivityFeed.useQuery({ limit: 50 }, {
    refetchInterval: 3000, // More frequent for activity feed
  });

  useEffect(() => {
    if (agentsData) {
      console.log('[AgentActivity] Received agents data:', agentsData);
      
      // Deduplicate agents (safety measure in case backend returns duplicates)
      const agentMap = new Map<string, AgentStatus>();
      agentsData.forEach(agent => {
        const uniqueKey = `${agent.symbol}-${agent.name}`;
        if (!agentMap.has(uniqueKey)) {
          agentMap.set(uniqueKey, agent);
          console.log(`[AgentActivity] ${agent.name} (${agent.symbol}): executionScore = ${agent.executionScore}`);
        } else {
          console.warn(`[AgentActivity] ⚠️ Skipping duplicate agent: ${uniqueKey}`);
        }
      });
      
      const uniqueAgents = Array.from(agentMap.values());
      console.log(`[AgentActivity] Total agents: ${agentsData.length}, Unique agents: ${uniqueAgents.length}`);
      
      setAgents(uniqueAgents);
      setLoading(false);
    }
  }, [agentsData]);

  useEffect(() => {
    if (orchestratorData) {
      setOrchestrator(orchestratorData);
    }
  }, [orchestratorData]);

  useEffect(() => {
    if (activityData) {
      setActivities(activityData as unknown as ActivityEvent[]);
    }
  }, [activityData]);

  // Old mock data removed - now using real data from tRPC above
  // Keeping this useEffect commented for reference
  /*
  useEffect(() => {
    const mockAgents: AgentStatus[] = [
      {
        name: "Technical Analyst",
        type: "fast",
        status: "active",
        lastUpdate: new Date().toISOString(),
        signal: "bullish",
        confidence: 75,
        reasoning: "RSI oversold at 28, MACD bullish crossover detected, price above SMA(20)",
        metrics: { accuracy: 68, signals: 1247, uptime: 99.8 },
      },
      {
        name: "Pattern Matcher",
        type: "fast",
        status: "active",
        lastUpdate: new Date().toISOString(),
        signal: "neutral",
        confidence: 45,
        reasoning: "No clear historical pattern match found in recent price action",
        metrics: { accuracy: 72, signals: 892, uptime: 99.5 },
      },
      {
        name: "Order Flow Analyst",
        type: "fast",
        status: "active",
        lastUpdate: new Date().toISOString(),
        signal: "bullish",
        confidence: 68,
        reasoning: "Large buy orders detected at $42,500 support level, bid-ask spread tightening",
        metrics: { accuracy: 65, signals: 2341, uptime: 99.9 },
      },
      {
        name: "Sentiment Analyst",
        type: "slow",
        status: "active",
        lastUpdate: new Date(Date.now() - 300000).toISOString(),
        nextUpdate: new Date(Date.now() + 300000).toISOString(),
        signal: "bullish",
        confidence: 82,
        reasoning: "Strong positive sentiment on Reddit (r/cryptocurrency), Fear & Greed Index at 72 (Greed)",
        metrics: { accuracy: 61, signals: 456, uptime: 98.2 },
      },
      {
        name: "News Sentinel",
        type: "slow",
        status: "active",
        lastUpdate: new Date(Date.now() - 180000).toISOString(),
        nextUpdate: new Date(Date.now() + 420000).toISOString(),
        signal: "bearish",
        confidence: 60,
        reasoning: "Negative regulatory news from SEC, concerns about exchange scrutiny",
        metrics: { accuracy: 58, signals: 234, uptime: 97.5 },
      },
      {
        name: "Macro Analyst",
        type: "slow",
        status: "active",
        lastUpdate: new Date(Date.now() - 240000).toISOString(),
        nextUpdate: new Date(Date.now() + 360000).toISOString(),
        signal: "neutral",
        confidence: 50,
        reasoning: "Mixed signals: DXY down, VIX stable, S&P 500 flat",
        metrics: { accuracy: 64, signals: 189, uptime: 99.1 },
      },
      {
        name: "OnChain Analyst",
        type: "slow",
        status: "active",
        lastUpdate: new Date(Date.now() - 120000).toISOString(),
        nextUpdate: new Date(Date.now() + 480000).toISOString(),
        signal: "bullish",
        confidence: 70,
        reasoning: "Whale accumulation detected, exchange outflows increasing, active addresses up 15%",
        metrics: { accuracy: 69, signals: 312, uptime: 98.8 },
      },
      {
        name: "Position Manager",
        type: "fast",
        status: "idle",
        lastUpdate: new Date().toISOString(),
        signal: "neutral",
        confidence: 0,
        reasoning: "No active positions to manage",
        metrics: { accuracy: 0, signals: 0, uptime: 100 },
      },
    ];

    const mockActivities: ActivityEvent[] = [
      {
        id: "1",
        timestamp: new Date().toISOString(),
        agent: "Technical Analyst",
        type: "signal",
        message: "Generated BULLISH signal with 75% confidence",
      },
      {
        id: "2",
        timestamp: new Date(Date.now() - 5000).toISOString(),
        agent: "Order Flow Analyst",
        type: "signal",
        message: "Detected large buy orders at support level",
      },
      {
        id: "3",
        timestamp: new Date(Date.now() - 12000).toISOString(),
        agent: "Strategy Orchestrator",
        type: "recommendation",
        message: "Final recommendation: BUY with 72% confidence",
      },
      {
        id: "4",
        timestamp: new Date(Date.now() - 25000).toISOString(),
        agent: "Sentiment Analyst",
        type: "signal",
        message: "Social sentiment strongly positive (82% confidence)",
      },
      {
        id: "5",
        timestamp: new Date(Date.now() - 38000).toISOString(),
        agent: "News Sentinel",
        type: "signal",
        message: "Negative regulatory news detected",
      },
    ];

    const mockOrchestrator: OrchestratorState = {
      fastAgents: [
        { name: "Technical Analyst", weight: 40, signal: "bullish", confidence: 75 },
        { name: "Pattern Matcher", weight: 35, signal: "neutral", confidence: 45 },
        { name: "Order Flow Analyst", weight: 25, signal: "bullish", confidence: 68 },
      ],
      slowAgents: [
        { name: "Sentiment Analyst", weight: 33.33, signal: "bullish", confidence: 82 },
        { name: "News Sentinel", weight: 33.33, signal: "bearish", confidence: 60 },
        { name: "Macro Analyst", weight: 33.33, signal: "neutral", confidence: 50 },
      ],
      fastScore: 65,
      slowBonus: 7,
      totalConfidence: 72,
      threshold: 60,
      recommendation: "BUY",
    };

    // setAgents(mockAgents);
    // setActivities(mockActivities);
    // setOrchestrator(mockOrchestrator);
    // setLoading(false);
  }, []);
  */

  // Helper functions moved outside component

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

  // formatTimeAgo and truncateReasoning moved outside component

  // Live countdown timer state
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  
  // Update countdown every second
  React.useEffect(() => {
    const interval = setInterval(() => {
      forceUpdate();
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  
  // formatCountdown moved outside component

  // Filter state
  const [selectedExchange, setSelectedExchange] = React.useState<string>('all');
  const [selectedSymbol, setSelectedSymbol] = React.useState<string>('all');
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [groupBy, setGroupBy] = React.useState<'none' | 'exchange' | 'symbol' | 'type'>('none');

  // Compute unique exchanges and symbols
  const uniqueExchanges = Array.from(new Set(agents.map(a => a.exchange)));
  const uniqueSymbols = Array.from(new Set(agents.map(a => a.tradingPair)));

  // Use tRPC loading state instead of manual loading state to prevent infinite loading
  if (agentsLoading && agents.length === 0) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center space-y-6">
          <SeerLoader size="lg" />
          <p className="text-muted-foreground">Loading Agent Activity...</p>
        </div>
      </div>
    );
  }

  // Apply filters
  const filteredAgents = agents.filter((a) => {
    if (selectedExchange !== 'all' && a.exchange !== selectedExchange) return false;
    if (selectedSymbol !== 'all' && a.tradingPair !== selectedSymbol) return false;
    
    // Apply search filter (searches agent name, exchange, and trading pair)
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesName = a.name.toLowerCase().includes(query);
      const matchesExchange = a.exchange.toLowerCase().includes(query);
      const matchesPair = a.tradingPair.toLowerCase().includes(query);
      const matchesSymbol = a.symbol.toLowerCase().includes(query);
      if (!matchesName && !matchesExchange && !matchesPair && !matchesSymbol) return false;
    }
    
    return true;
  });

  // Group agents if grouping is enabled
  const groupedAgents: Record<string, AgentStatus[]> = {};
  if (groupBy !== 'none') {
    filteredAgents.forEach((agent) => {
      let key = '';
      if (groupBy === 'exchange') key = agent.exchange;
      else if (groupBy === 'symbol') key = agent.tradingPair;
      else if (groupBy === 'type') key = agent.type === 'fast' ? 'Fast Agents' : 'Slow Agents';
      
      if (!groupedAgents[key]) groupedAgents[key] = [];
      groupedAgents[key].push(agent);
    });
  }

  const fastAgents = filteredAgents.filter((a) => a.type === "fast");
  const slowAgents = filteredAgents.filter((a) => a.type === "slow");

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Header */}
      <div className="border-b border-gray-800/50">
        <div className="container px-3 sm:px-4 lg:px-6 py-4 lg:py-6">
          <h1 className="text-2xl lg:text-3xl font-bold text-white mb-2 flex items-center gap-2 lg:gap-3">
            <div className="p-1.5 lg:p-2 rounded-lg lg:rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/20">
              <Activity className="w-5 h-5 lg:w-7 lg:h-7 text-purple-400" />
            </div>
            <span className="hidden sm:inline">Agent Activity Monitor</span>
            <span className="sm:hidden">Agent Monitor</span>
          </h1>
          <p className="text-gray-400 text-sm lg:text-base">
            <span className="hidden sm:inline">Real-time monitoring of all intelligence agents and strategy orchestration</span>
            <span className="sm:hidden">Real-time agent monitoring</span>
          </p>
        </div>
      </div>

      <div className="container px-3 sm:px-4 lg:px-6 py-4 lg:py-8">
        {/* Search Bar */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search agents by name, exchange, or symbol (e.g., 'TechnicalAnalyst', 'binance', 'BTCUSDT')..."
              className="glass w-full pl-10 pr-4 py-2.5 rounded-lg text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Grouping Toggle + Filters */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 lg:gap-4 mb-4 lg:mb-6">
          {/* Grouping Toggle */}
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-muted-foreground shrink-0" />
            <label className="text-xs lg:text-sm font-medium shrink-0">Group:</label>
            <div className="flex gap-0.5 lg:gap-1 glass rounded-lg p-0.5 lg:p-1 overflow-x-auto">
              <button
                onClick={() => setGroupBy('none')}
                className={`px-2 lg:px-3 py-1 lg:py-1.5 rounded text-[10px] lg:text-xs font-medium transition-colors whitespace-nowrap ${
                  groupBy === 'none'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                None
              </button>
              <button
                onClick={() => setGroupBy('exchange')}
                className={`px-2 lg:px-3 py-1 lg:py-1.5 rounded text-[10px] lg:text-xs font-medium transition-colors whitespace-nowrap ${
                  groupBy === 'exchange'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Exchange
              </button>
              <button
                onClick={() => setGroupBy('symbol')}
                className={`px-2 lg:px-3 py-1 lg:py-1.5 rounded text-[10px] lg:text-xs font-medium transition-colors whitespace-nowrap ${
                  groupBy === 'symbol'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Symbol
              </button>
              <button
                onClick={() => setGroupBy('type')}
                className={`px-2 lg:px-3 py-1 lg:py-1.5 rounded text-[10px] lg:text-xs font-medium transition-colors whitespace-nowrap ${
                  groupBy === 'type'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Type
              </button>
            </div>
          </div>

          {/* Existing Filters */}
          <div className="flex flex-wrap items-center gap-2 lg:gap-4">
            <div className="flex items-center gap-1 lg:gap-2">
              <label className="text-xs lg:text-sm font-medium hidden sm:inline">Exchange:</label>
              <select
                className="glass px-2 lg:px-3 py-1.5 lg:py-2 rounded-md text-xs lg:text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                value={selectedExchange}
                onChange={(e) => setSelectedExchange(e.target.value)}
              >
                <option value="all">All Exchanges</option>
                {uniqueExchanges.map((ex) => (
                  <option key={ex} value={ex}>{ex}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1 lg:gap-2">
              <label className="text-xs lg:text-sm font-medium hidden sm:inline">Symbol:</label>
              <select
                className="glass px-2 lg:px-3 py-1.5 lg:py-2 rounded-md text-xs lg:text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
              >
                <option value="all">All Symbols</option>
                {uniqueSymbols.map((sym) => (
                  <option key={sym} value={sym}>{sym}</option>
                ))}
              </select>
            </div>
            {(selectedExchange !== 'all' || selectedSymbol !== 'all') && (
              <button
                onClick={() => { setSelectedExchange('all'); setSelectedSymbol('all'); }}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <Tabs defaultValue="agents" className="space-y-4 lg:space-y-6">
          <TabsList className="glass w-full sm:w-auto">
            <TabsTrigger value="agents" className="text-xs lg:text-sm">Agents</TabsTrigger>
            <TabsTrigger value="comparison" className="text-xs lg:text-sm">Comparison</TabsTrigger>
            <TabsTrigger value="activity" className="text-xs lg:text-sm">Activity</TabsTrigger>
          </TabsList>

          {/* Agent Status Tab */}
          <TabsContent value="agents" className="space-y-6">
            {groupBy !== 'none' ? (
              // Grouped view
              <div className="space-y-8">
                {Object.keys(groupedAgents).sort().map((groupKey) => (
                  <div key={groupKey}>
                    <div className="flex items-center gap-2 mb-4">
                      <h2 className="text-xl font-bold capitalize">{groupKey}</h2>
                      <Badge className="bg-primary/10 text-primary border-primary/20">
                        {groupedAgents[groupKey].length} agents
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {groupedAgents[groupKey].map((agent, index) => (
                        <AgentCard key={`${groupKey}-${index}-${agent.name}-${agent.symbol}`} agent={agent} index={index} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              // Default view (Fast/Slow separation)
              <>
                {/* Fast Agents */}
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Zap className="w-5 h-5 text-yellow-400" />
                    <h2 className="text-xl font-bold">Fast Agents</h2>
                    <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
                      Tick-based
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {fastAgents.map((agent, index) => (
                      <AgentCard key={`fast-${index}-${agent.name}-${agent.symbol}`} agent={agent} index={index} />
                    ))}
              </div>
            </div>

            {/* Slow Agents */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-5 h-5 text-blue-400" />
                <h2 className="text-xl font-bold">Slow Agents</h2>
                <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">
                  Periodic updates
                </Badge>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {slowAgents.map((agent, index) => (
                      <AgentCard key={`slow-${index}-${agent.name}-${agent.symbol}`} agent={agent} index={index + fastAgents.length} />
                    ))}
              </div>
            </div>
              </>
            )}
          </TabsContent>

          {/* Signal Comparison Tab - Before/After Agent Fix Analysis */}
          <TabsContent value="comparison" className="space-y-6">
            <Card className="glass p-6">
              <div className="flex items-center gap-2 mb-6">
                <Layers className="w-5 h-5 text-purple-400" />
                <h2 className="text-xl font-bold">Agent Signal Distribution Comparison</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-6">
                Compare signal distributions before and after agent fixes to measure improvement.
              </p>
              
              {/* Agent Fix Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                {/* SentimentAnalyst Fix Card */}
                <Card className="p-4 border border-green-500/20 bg-green-500/5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-green-400">SentimentAnalyst</h3>
                    <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Fixed</Badge>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Before:</span>
                      <span className="text-red-400">99.8% bullish bias</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">After:</span>
                      <span className="text-green-400">Z-score normalized</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fix:</span>
                      <span>Z-score model</span>
                    </div>
                  </div>
                </Card>

                {/* TechnicalAnalyst Fix Card */}
                <Card className="p-4 border border-green-500/20 bg-green-500/5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-green-400">TechnicalAnalyst</h3>
                    <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Fixed</Badge>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Before:</span>
                      <span className="text-red-400">76.5% bullish bias</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">After:</span>
                      <span className="text-green-400">Trend confirmation</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fix:</span>
                      <span>SuperTrend 2.5, 2+ confirm</span>
                    </div>
                  </div>
                </Card>

                {/* NewsSentinel Pending Card */}
                <Card className="p-4 border border-yellow-500/20 bg-yellow-500/5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-yellow-400">NewsSentinel</h3>
                    <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Pending</Badge>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Current:</span>
                      <span className="text-red-400">96.9% bearish bias</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Target:</span>
                      <span className="text-yellow-400">Balanced scoring</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ETA:</span>
                      <span>Week 2</span>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Signal Distribution by Agent */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Current Signal Distribution</h3>
                {agents.length > 0 ? (
                  <div className="space-y-3">
                    {/* Group by unique agent names */}
                    {Array.from(new Set(agents.map(a => a.name))).map((agentName) => {
                      const agentSignals = agents.filter(a => a.name === agentName);
                      const bullish = agentSignals.filter(a => a.signal === 'bullish').length;
                      const bearish = agentSignals.filter(a => a.signal === 'bearish').length;
                      const neutral = agentSignals.filter(a => a.signal === 'neutral').length;
                      const total = agentSignals.length;
                      
                      return (
                        <div key={agentName} className="p-4 rounded-lg bg-secondary/30">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium">{agentName}</span>
                            <span className="text-xs text-muted-foreground">{total} signals</span>
                          </div>
                          <div className="flex h-4 rounded-full overflow-hidden bg-gray-800">
                            <div 
                              className="bg-green-500 transition-all" 
                              style={{ width: `${(bullish / total) * 100}%` }}
                              title={`Bullish: ${((bullish / total) * 100).toFixed(1)}%`}
                            />
                            <div 
                              className="bg-gray-500 transition-all" 
                              style={{ width: `${(neutral / total) * 100}%` }}
                              title={`Neutral: ${((neutral / total) * 100).toFixed(1)}%`}
                            />
                            <div 
                              className="bg-red-500 transition-all" 
                              style={{ width: `${(bearish / total) * 100}%` }}
                              title={`Bearish: ${((bearish / total) * 100).toFixed(1)}%`}
                            />
                          </div>
                          <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                            <span className="text-green-400">{((bullish / total) * 100).toFixed(1)}% bullish</span>
                            <span className="text-gray-400">{((neutral / total) * 100).toFixed(1)}% neutral</span>
                            <span className="text-red-400">{((bearish / total) * 100).toFixed(1)}% bearish</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No agent signals available yet.</p>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* Activity Feed Tab */}
          <TabsContent value="activity">
            <Card className="glass p-6">
              <h2 className="text-xl font-bold mb-4">Real-time Activity Feed</h2>
              <div className="space-y-3">
                {activities.map((activity, index) => (
                  <div
                    key={activity.id}
                    className="flex items-start gap-4 p-4 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors animate-fadeInUp"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                      {getActivityIcon(activity.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold">{activity.agent}</span>
                        <Badge className="text-xs">{activity.type}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{activity.message}</p>
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {formatTimeAgo(activity.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
