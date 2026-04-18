/**
 * Position Consensus Card Component
 * 
 * Displays real-time agent consensus visualization for a position
 * and provides emergency manual override capability.
 */

import { useState } from "react";
import {
  Activity,
  Bot,
  Shield,
  AlertTriangle,
  LogOut,
  ChevronDown,
  ChevronUp,
  Users,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface AgentVote {
  agentName: string;
  signal: 'exit' | 'hold' | 'add';
  confidence: number;
  reasoning?: string;
  timestamp: number;
}

interface PositionConsensusData {
  positionId: number;
  symbol: string;
  exitPercentage: number;
  holdPercentage: number;
  addPercentage: number;
  consensusAction: 'exit' | 'hold' | 'add' | 'neutral';
  consensusStrength: number;
  confidenceScore: number;
  agentVotes: AgentVote[];
  totalAgents: number;
  agentsVotingExit: number;
  agentsVotingHold: number;
  agentsVotingAdd: number;
  exitThreshold: number;
  lastUpdated: number;
}

interface PositionConsensusCardProps {
  positionId: number | string;
  symbol: string;
  side: 'long' | 'short';
  isProfit: boolean;
  pnlPercent: number;
  onPositionClosed?: () => void;
}

export function PositionConsensusCard({
  positionId,
  symbol,
  side,
  isProfit,
  pnlPercent,
  onPositionClosed,
}: PositionConsensusCardProps) {
  const [showAgentBreakdown, setShowAgentBreakdown] = useState(false);
  const [manualExitReason, setManualExitReason] = useState("");
  const [isExitDialogOpen, setIsExitDialogOpen] = useState(false);

  // Convert positionId to number for API call
  const numericPositionId = typeof positionId === 'string' ? parseInt(positionId, 10) : positionId;

  // Fetch consensus data
  const { data: consensusData, isLoading, refetch } = trpc.positionConsensus.getPositionConsensus.useQuery(
    { positionId: numericPositionId },
    { 
      refetchInterval: 5000, // Refresh every 5 seconds
      staleTime: 3000,
    }
  );

  // Manual exit mutation
  const manualExitMutation = trpc.positionConsensus.emergencyManualExit.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      setIsExitDialogOpen(false);
      setManualExitReason("");
      onPositionClosed?.();
    },
    onError: (error) => {
      toast.error(`Failed to close position: ${error.message}`);
    },
  });

  const handleManualExit = () => {
    if (!manualExitReason.trim()) {
      toast.error("Please provide a reason for the manual exit");
      return;
    }
    manualExitMutation.mutate({
      positionId: numericPositionId,
      reason: manualExitReason.trim(),
      confirmOverride: true,
    });
  };

  const getSignalIcon = (signal: 'exit' | 'hold' | 'add') => {
    switch (signal) {
      case 'exit':
        return <TrendingDown className="w-3 h-3 text-red-400" />;
      case 'hold':
        return <Minus className="w-3 h-3 text-yellow-400" />;
      case 'add':
        return <TrendingUp className="w-3 h-3 text-green-400" />;
    }
  };

  const getSignalColor = (signal: 'exit' | 'hold' | 'add') => {
    switch (signal) {
      case 'exit':
        return 'text-red-400 bg-red-500/10 border-red-500/20';
      case 'hold':
        return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
      case 'add':
        return 'text-green-400 bg-green-500/10 border-green-500/20';
    }
  };

  const getConsensusActionColor = (action: string) => {
    switch (action) {
      case 'exit':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'hold':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'add':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 bg-gray-800/30 rounded-xl border border-gray-700/50 animate-pulse">
        <div className="h-4 bg-gray-700 rounded w-1/3 mb-3"></div>
        <div className="h-8 bg-gray-700 rounded mb-2"></div>
        <div className="h-4 bg-gray-700 rounded w-2/3"></div>
      </div>
    );
  }

  // Default values if no consensus data
  const data: PositionConsensusData = consensusData || {
    positionId: numericPositionId,
    symbol,
    exitPercentage: 0,
    holdPercentage: 100,
    addPercentage: 0,
    consensusAction: 'hold',
    consensusStrength: 50,
    confidenceScore: 50,
    agentVotes: [],
    totalAgents: 0,
    agentsVotingExit: 0,
    agentsVotingHold: 0,
    agentsVotingAdd: 0,
    exitThreshold: 60,
    lastUpdated: Date.now(),
  };

  const isNearExitThreshold = data.exitPercentage >= data.exitThreshold * 0.8;
  const isAtExitThreshold = data.exitPercentage >= data.exitThreshold;

  return (
    <div className="space-y-4">
      {/* Consensus Visualization */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 bg-gray-800/30 rounded-xl border border-gray-700/50">
        {/* Exit vs Hold Consensus */}
        <div className="col-span-2 md:col-span-1">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-3.5 h-3.5 text-blue-400" />
            <p className="text-xs text-gray-400">Agent Consensus</p>
            <Badge className={cn("text-[10px]", getConsensusActionColor(data.consensusAction))}>
              {data.consensusAction.toUpperCase()}
            </Badge>
          </div>
          
          {/* Consensus Bar */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full flex">
                  <div 
                    className="bg-red-500 transition-all duration-500"
                    style={{ width: `${data.exitPercentage}%` }}
                  />
                  <div 
                    className="bg-yellow-500 transition-all duration-500"
                    style={{ width: `${data.holdPercentage}%` }}
                  />
                  <div 
                    className="bg-green-500 transition-all duration-500"
                    style={{ width: `${data.addPercentage}%` }}
                  />
                </div>
              </div>
            </div>
            
            {/* Legend */}
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-red-400 flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                Exit {data.exitPercentage}%
              </span>
              <span className="text-yellow-400 flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                Hold {data.holdPercentage}%
              </span>
              <span className="text-green-400 flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                Add {data.addPercentage}%
              </span>
            </div>
          </div>
        </div>

        {/* Agent Agreement */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Bot className="w-3.5 h-3.5 text-purple-400" />
            <p className="text-xs text-gray-400">Agent Agreement</p>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={cn(
              "text-xl font-mono font-bold",
              data.consensusStrength >= 70 ? "text-green-400" :
              data.consensusStrength >= 50 ? "text-yellow-400" : "text-gray-400"
            )}>
              {data.consensusStrength}%
            </span>
            <span className="text-xs text-gray-500">strength</span>
          </div>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {data.totalAgents} agents voting
          </p>
        </div>

        {/* Exit Threshold Status */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield className={cn(
              "w-3.5 h-3.5",
              isAtExitThreshold ? "text-red-400" :
              isNearExitThreshold ? "text-yellow-400" : "text-green-400"
            )} />
            <p className="text-xs text-gray-400">Exit Threshold</p>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={cn(
              "text-xl font-mono font-bold",
              isAtExitThreshold ? "text-red-400" :
              isNearExitThreshold ? "text-yellow-400" : "text-green-400"
            )}>
              {data.exitPercentage}%
            </span>
            <span className="text-xs text-gray-500">/ {data.exitThreshold}%</span>
          </div>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {isAtExitThreshold ? "Exit triggered" :
             isNearExitThreshold ? "Approaching threshold" : "Holding position"}
          </p>
        </div>
      </div>

      {/* Agent Breakdown Collapsible */}
      <Collapsible open={showAgentBreakdown} onOpenChange={setShowAgentBreakdown}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full flex items-center justify-between text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-800/50"
          >
            <span className="flex items-center gap-2">
              <Users className="w-3.5 h-3.5" />
              View Agent Breakdown ({data.agentVotes.length} agents)
            </span>
            {showAgentBreakdown ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <div className="bg-gray-800/20 rounded-lg border border-gray-700/30 p-3 space-y-2">
            {data.agentVotes.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-2">
                No agent signals available yet
              </p>
            ) : (
              data.agentVotes.map((vote, index) => (
                <div
                  key={`${vote.agentName}-${index}`}
                  className="flex items-center justify-between p-2 bg-gray-800/40 rounded-lg"
                >
                  <div className="flex items-center gap-2">
                    <Bot className="w-3.5 h-3.5 text-purple-400" />
                    <span className="text-xs font-medium text-gray-300">
                      {vote.agentName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={cn("text-[10px]", getSignalColor(vote.signal))}>
                      {getSignalIcon(vote.signal)}
                      <span className="ml-1">{vote.signal.toUpperCase()}</span>
                    </Badge>
                    <span className="text-xs text-gray-400">
                      {vote.confidence.toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Emergency Manual Override */}
      <div className="flex items-center justify-between p-3 bg-gradient-to-r from-orange-500/5 via-red-500/5 to-orange-500/5 rounded-lg border border-orange-500/20">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-orange-400" />
          <span className="text-xs text-orange-400">
            Emergency Override Available
          </span>
        </div>
        
        <Dialog open={isExitDialogOpen} onOpenChange={setIsExitDialogOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-orange-500/30 text-orange-400 hover:bg-orange-500/10 hover:text-orange-300"
            >
              <LogOut className="w-3.5 h-3.5 mr-1" />
              Manual Exit
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-gray-900 border-gray-700">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-white">
                <AlertCircle className="w-5 h-5 text-orange-400" />
                Emergency Manual Exit
              </DialogTitle>
              <DialogDescription className="text-gray-400">
                This will immediately close the position for <strong className="text-white">{symbol}</strong> ({side.toUpperCase()}), 
                bypassing the agent consensus system. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              {/* Current Position Status */}
              <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400">Current P&L</span>
                  <span className={cn(
                    "text-sm font-mono font-bold",
                    isProfit ? "text-green-400" : "text-red-400"
                  )}>
                    {isProfit ? '+' : ''}{pnlPercent.toFixed(2)}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Agent Consensus</span>
                  <Badge className={cn("text-[10px]", getConsensusActionColor(data.consensusAction))}>
                    {data.consensusAction.toUpperCase()} ({data.consensusStrength}%)
                  </Badge>
                </div>
              </div>
              
              {/* Warning */}
              <div className="p-3 bg-orange-500/10 rounded-lg border border-orange-500/20">
                <p className="text-xs text-orange-400">
                  <strong>Warning:</strong> Manual exits bypass the AI consensus system. 
                  Only use this for edge cases where you need to override the agents' decision.
                </p>
              </div>
              
              {/* Reason Input */}
              <div className="space-y-2">
                <label className="text-sm text-gray-300">
                  Reason for Manual Exit <span className="text-red-400">*</span>
                </label>
                <Textarea
                  placeholder="Explain why you're overriding the agent consensus..."
                  value={manualExitReason}
                  onChange={(e) => setManualExitReason(e.target.value)}
                  className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 min-h-[80px]"
                />
                <p className="text-[10px] text-gray-500">
                  This will be logged for audit purposes
                </p>
              </div>
            </div>
            
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setIsExitDialogOpen(false)}
                className="border-gray-700 text-gray-300"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleManualExit}
                disabled={!manualExitReason.trim() || manualExitMutation.isPending}
                className="bg-red-600 hover:bg-red-700"
              >
                {manualExitMutation.isPending ? (
                  <>
                    <Activity className="w-4 h-4 mr-2 animate-spin" />
                    Closing...
                  </>
                ) : (
                  <>
                    <LogOut className="w-4 h-4 mr-2" />
                    Confirm Exit
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
