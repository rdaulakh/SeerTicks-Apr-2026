/**
 * Intelligence Agents Index
 * Exports all agents and the agent manager
 */

export { AgentBase, AgentSignal, AgentConfig, AgentHealth, AgentManager, getAgentManager } from "./AgentBase";
export { NewsSentinel } from "./NewsSentinel";
export { TechnicalAnalyst } from "./TechnicalAnalyst";
export { SentimentAnalyst } from "./SentimentAnalyst";
export { PatternMatcher } from "./PatternMatcher";
export { OrderFlowAnalyst } from "./OrderFlowAnalyst";
export { MacroAnalyst } from "./MacroAnalyst";
export { PositionManager } from "../PositionManager";
export { OnChainAnalyst } from "./OnChainAnalyst";

// Phase 2: New Agents
export { WhaleTracker, whaleTracker } from "./WhaleTracker";
export { FundingRateAnalyst, fundingRateAnalyst } from "./FundingRateAnalyst";
export { LiquidationHeatmap, liquidationHeatmap } from "./LiquidationHeatmap";
export { OnChainFlowAnalyst, onChainFlowAnalyst } from "./OnChainFlowAnalyst";
export { VolumeProfileAnalyzer, volumeProfileAnalyzer } from "./VolumeProfileAnalyzer";
export { ForexCorrelationAgent } from "./ForexCorrelationAgent";

// Phase 2: Deterministic Fallback System
export { 
  DeterministicFallback,
  SentimentDeterministicFallback,
  NewsDeterministicFallback,
  MacroDeterministicFallback,
  FallbackManager,
  fallbackManager,
  MarketDataInput,
  FallbackResult,
} from "./DeterministicFallback";
