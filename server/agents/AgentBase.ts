import { EventEmitter } from "events";
import { getActiveClock } from '../_core/clock';
import { invokeLLM } from "../_core/llm";
import { getDb } from "../db";
import { agentSignals } from "../../drizzle/schema";

/**
 * Agent Base Class
 * Foundation for all intelligence agents with standardized signal format,
 * health monitoring, and multi-model fallback
 */

/**
 * Standardized agent signal format
 */
export interface AgentSignal {
  agentName: string;
  symbol: string;
  timestamp: number;
  
  // Signal strength and direction
  signal: "bullish" | "bearish" | "neutral";
  confidence: number; // 0-1 scale
  strength: number; // 0-1 scale (how strong the signal is)
  executionScore: number; // 0-100 scale (tactical timing quality - proximity to key levels, volume, momentum)
  
  // Reasoning and context
  reasoning: string; // Human-readable explanation
  evidence: Record<string, any>; // Supporting data
  
  // Quality and metadata
  qualityScore: number; // 0-1 scale (agent's self-assessment)
  processingTime: number; // milliseconds
  dataFreshness: number; // seconds since data was collected
  isSyntheticData?: boolean; // true if signal is based on mock/simulated data (NOT real market data)
  
  // Recommended action (optional)
  recommendation?: {
    action: "buy" | "sell" | "hold" | "reduce" | "exit";
    urgency: "low" | "medium" | "high" | "critical";
    targetPrice?: number;
    stopLoss?: number;
  };
  
  // Exit recommendation for open positions (Phase 3 Enhancement)
  exitRecommendation?: {
    action: 'hold' | 'partial_exit' | 'full_exit';
    urgency: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
    exitPercent?: number; // For partial exits (0-100)
    confidence: number; // 0-1 scale
  };
}

/**
 * Agent health status
 */
export interface AgentHealth {
  agentName: string;
  status: "healthy" | "degraded" | "offline";
  lastSignalTime: number;
  lastTickTime: number; // Timestamp of last tick received (for fast agents)
  ticksReceived: number; // Total ticks received since start
  successRate: number; // 0-1 scale
  avgProcessingTime: number; // milliseconds
  errorCount: number;
  uptime: number; // seconds
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  name: string;
  enabled: boolean;
  updateInterval: number; // milliseconds
  timeout: number; // milliseconds
  maxRetries: number;
  llmModel?: string;
}

/**
 * Abstract Agent Base Class
 */
export abstract class AgentBase extends EventEmitter {
  protected config: AgentConfig;
  protected health: AgentHealth;
  protected startTime: number;
  protected signalHistory: AgentSignal[] = [];
  protected isRunning: boolean = false;
  protected updateTimer: NodeJS.Timeout | null = null;

  constructor(config: AgentConfig) {
    super();
    this.config = config;
    this.startTime = getActiveClock().now();
    this.health = {
      agentName: config.name,
      status: "healthy",
      lastSignalTime: 0,
      lastTickTime: 0,
      ticksReceived: 0,
      successRate: 1.0,
      avgProcessingTime: 0,
      errorCount: 0,
      uptime: 0,
    };
  }

  /**
   * Start the agent
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(`[${this.config.name}] Already running`);
      return;
    }

    console.log(`[${this.config.name}] Starting agent...`);
    this.isRunning = true;

    // Initialize agent-specific resources with timeout to prevent startup hang
    const INIT_TIMEOUT_MS = 15_000; // 15 seconds max for initialization
    try {
      await Promise.race([
        this.initialize(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`initialize() timed out after ${INIT_TIMEOUT_MS}ms`)), INIT_TIMEOUT_MS)
        ),
      ]);
    } catch (err) {
      // Agent starts even if initialize() fails/times out — it will fetch data on demand
      console.warn(`[${this.config.name}] initialize() failed (agent will still run):`, (err as Error)?.message);
    }

    // Start periodic updates if interval is set
    if (this.config.updateInterval > 0) {
      this.scheduleNextUpdate();
    }

    console.log(`[${this.config.name}] Agent started successfully`);
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log(`[${this.config.name}] Stopping agent...`);
    this.isRunning = false;

    // Clear update timer
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }

    // Cleanup agent-specific resources
    await this.cleanup();

    console.log(`[${this.config.name}] Agent stopped`);
  }

  /**
   * Generate a signal for a given symbol
   */
  async generateSignal(symbol: string, context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();

    try {
      // Phase 33: Inject agent-specific task directive from MarketRegimeAI
      // MarketRegimeAI generates per-agent guidance (focus, questions, priority)
      // that was previously ignored. Now we enrich the context so each agent's
      // analyze() method can access its specific directive.
      let enrichedContext = context;
      if (context?.agentGuidance) {
        const myDirective = context.agentGuidance[this.config.name];
        if (myDirective) {
          enrichedContext = {
            ...context,
            // Inject agent-specific fields at top level for easy access
            taskFocus: myDirective.focus,
            taskQuestions: myDirective.questions || [],
            taskPriority: myDirective.priority,
            regimeWeightMultiplier: myDirective.weightMultiplier,
          };
        }
      }

      // Phase 35: Inject cross-cycle memory summary for this agent
      // Provides historical context: signal persistence, conviction, flips
      if (enrichedContext?.crossCycleMemory) {
        try {
          const { getCrossCycleMemory } = await import('../services/CrossCycleMemory');
          const memorySummary = getCrossCycleMemory().getSummaryForAgent(symbol, this.config.name);
          enrichedContext = {
            ...enrichedContext,
            crossCycleSummary: memorySummary,
            signalPersistence: enrichedContext.crossCycleMemory?.signalPersistence?.[this.config.name] || null,
          };
        } catch { /* memory not available, continue without it */ }
      }

      // Analyze and generate signal (implemented by subclass)
      const signal = await this.analyze(symbol, enrichedContext);

      // Inject userId from context into signal evidence for persistence
      if (context?.userId) {
        signal.evidence = { ...signal.evidence, userId: context.userId };
      }

      // Update health metrics
      const processingTime = getActiveClock().now() - startTime;
      this.updateHealthMetrics(true, processingTime);

      // Store signal in history
      this.signalHistory.push(signal);
      if (this.signalHistory.length > 100) {
        this.signalHistory.shift(); // Keep last 100 signals
      }

      // Persist signal to database (async, don't block)
      this.persistSignal(signal).catch(err => {
        console.error(`[${this.config.name}] Failed to persist signal:`, err);
      });

      // Emit signal event
      this.emit("signal", signal);

      return signal;
    } catch (error) {
      console.error(`[${this.config.name}] Error generating signal:`, error);
      
      // Update health metrics
      this.updateHealthMetrics(false, getActiveClock().now() - startTime);

      // Create neutral signal on error and STORE it in signalHistory
      // Critical fix: without this, getLatestSignal() returns null when analyze() throws,
      // causing the frontend to show 0% confidence for agents that encounter errors.
      const neutralSignal = this.createNeutralSignal(symbol, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.signalHistory.push(neutralSignal);
      if (this.signalHistory.length > 100) {
        this.signalHistory.shift();
      }
      return neutralSignal;
    }
  }

  /**
   * Get agent health status
   */
  getHealth(): AgentHealth {
    this.health.uptime = Math.floor((getActiveClock().now() - this.startTime) / 1000);
    return { ...this.health };
  }

  /**
   * Get the latest signal
   */
  getLatestSignal(): AgentSignal | null {
    return this.signalHistory.length > 0 ? this.signalHistory[this.signalHistory.length - 1] : null;
  }

  /**
   * Get recent signals
   */
  getRecentSignals(count: number = 10): AgentSignal[] {
    return this.signalHistory.slice(-count);
  }

  /**
   * Called when a new tick is received (for fast agents)
   * Updates lastTickTime to track real-time data flow
   */
  onTick(tick: { price: number; timestamp: number; symbol?: string }): void {
    this.health.lastTickTime = getActiveClock().now();
    this.health.ticksReceived++;
  }

  /**
   * Call LLM with retry logic, circuit breaker awareness, and fallback.
   * 
   * The circuit breaker in invokeLLM handles quota exhaustion automatically:
   * - On 412 errors, it opens the circuit and routes to Anthropic fallback
   * - When circuit is OPEN, primary calls are blocked (fallback only)
   * - Agent retries are only for transient errors, not quota exhaustion
   */
  protected async callLLM(messages: any[], options?: any): Promise<string> {
    const { getLLMCircuitBreaker } = await import('../utils/LLMCircuitBreaker');
    const circuitBreaker = getLLMCircuitBreaker();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const response = await invokeLLM({
          messages,
          ...options,
        });

        const content = response.choices[0]?.message?.content;
        if (typeof content === 'string') {
          return content;
        } else if (Array.isArray(content)) {
          return content
            .filter(item => item.type === 'text')
            .map(item => (item as any).text)
            .join('');
        }
        return "";
      } catch (error) {
        lastError = error as Error;
        
        // If circuit breaker detected quota exhaustion, don't retry —
        // invokeLLM already tried the fallback and it failed too
        if (circuitBreaker.isQuotaExhausted(lastError)) {
          console.warn(`[${this.config.name}] LLM quota exhausted — skipping retries (circuit: ${circuitBreaker.getState()})`);
          break;
        }

        console.error(`[${this.config.name}] LLM call failed (attempt ${attempt + 1}):`, error);
        
        // Wait before retry (exponential backoff) — only for transient errors
        if (attempt < this.config.maxRetries - 1) {
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError || new Error("LLM call failed after all retries");
  }

  /**
   * Update health metrics
   */
  private updateHealthMetrics(success: boolean, processingTime: number): void {
    this.health.lastSignalTime = getActiveClock().now();

    // Update success rate (exponential moving average)
    const alpha = 0.1;
    this.health.successRate = alpha * (success ? 1 : 0) + (1 - alpha) * this.health.successRate;

    // Update average processing time
    this.health.avgProcessingTime = alpha * processingTime + (1 - alpha) * this.health.avgProcessingTime;

    // Update error count
    if (!success) {
      this.health.errorCount++;
    }

    // Update status based on success rate
    if (this.health.successRate < 0.5) {
      this.health.status = "degraded";
    } else if (this.health.successRate < 0.2) {
      this.health.status = "offline";
    } else {
      this.health.status = "healthy";
    }
  }

  /**
   * Schedule next update
   */
  private scheduleNextUpdate(): void {
    if (!this.isRunning) {
      return;
    }

    this.updateTimer = setTimeout(async () => {
      try {
        await this.periodicUpdate();
      } catch (error) {
        console.error(`[${this.config.name}] Periodic update failed:`, error);
      }

      // Schedule next update
      this.scheduleNextUpdate();
    }, this.config.updateInterval);
  }

  /**
   * Create a neutral signal (used for errors or no opinion)
   */
  protected createNeutralSignal(symbol: string, reasoning: string): AgentSignal {
    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal: "neutral",
      confidence: 0,
      strength: 0,
      executionScore: 50, // Neutral execution score
      reasoning,
      evidence: {},
      qualityScore: 0,
      processingTime: 0,
      dataFreshness: 0,
    };
  }

  /**
   * Sleep utility
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Persist signal to database
   */
  private async persistSignal(signal: AgentSignal): Promise<void> {
    try {
      const db = await getDb();
      if (!db) {
        console.warn(`[${this.config.name}] Database not available, skipping signal persistence`);
        return;
      }

      // Extract userId from signal's evidence (passed through context)
      // The userId is injected into the signal's evidence during generation
      const userId = (signal.evidence as any)?.userId || 1;

      await db.insert(agentSignals).values({
        userId,
        agentName: signal.agentName,
        signalType: signal.signal,
        signalData: signal as any, // Store full signal as JSON
        confidence: signal.confidence.toString(),
        executionScore: signal.executionScore,
        marketConditions: signal.evidence as any,
        timestamp: new Date(signal.timestamp),
      });

      console.log(`[${this.config.name}] ✅ Signal persisted to database`);
    } catch (error) {
      console.error(`[${this.config.name}] Failed to persist signal:`, error);
      // Don't throw - signal persistence is non-critical
    }
  }

  // Abstract methods to be implemented by subclasses

  /**
   * Initialize agent-specific resources
   */
  protected abstract initialize(): Promise<void>;

  /**
   * Cleanup agent-specific resources
   */
  protected abstract cleanup(): Promise<void>;

  /**
   * Analyze market conditions and generate signal
   */
  protected abstract analyze(symbol: string, context?: any): Promise<AgentSignal>;

  /**
   * Periodic update (optional, called at updateInterval)
   */
  protected abstract periodicUpdate(): Promise<void>;
}

/**
 * Agent Manager
 * Manages multiple agents and coordinates their signals
 */
export class AgentManager extends EventEmitter {
  private agents: Map<string, AgentBase> = new Map();
  private lastSignalTime: number = 0;
  
  /**
   * Update health state for agents
   */
  private updateAgentHealthState(): void {
    import('../routers/healthRouter').then(({ updateHealthState }) => {
      updateHealthState('agents', {
        active: this.agents.size,
        total: 12, // Total expected agents
        lastSignal: this.lastSignalTime > 0 ? this.lastSignalTime : getActiveClock().now()
      });
    }).catch(() => {
      // Silently ignore if healthRouter not available
    });
  }

  /**
   * Register an agent
   */
  registerAgent(agent: AgentBase): void {
    this.agents.set(agent.getHealth().agentName, agent);

    // Forward agent signals
    agent.on("signal", (signal: AgentSignal) => {
      this.emit("signal", signal);
    });

    console.log(`[AgentManager] Registered agent: ${agent.getHealth().agentName}`);
  }

  /**
   * Start all agents
   */
  async startAll(): Promise<void> {
    console.log("[AgentManager] Starting all agents...");

    const startPromises = Array.from(this.agents.values()).map(agent => agent.start());
    await Promise.all(startPromises);

    console.log("[AgentManager] All agents started");
    
    // Update health state when agents start
    this.updateAgentHealthState();
  }

  /**
   * Stop all agents
   */
  async stopAll(): Promise<void> {
    console.log("[AgentManager] Stopping all agents...");

    const stopPromises = Array.from(this.agents.values()).map(agent => agent.stop());
    await Promise.all(stopPromises);

    console.log("[AgentManager] All agents stopped");
  }

  /**
   * Get signals from specific agents by name
   * Runs specified agents in parallel for maximum speed
   */
  async getSignalsFromAgents(symbol: string, agentNames: string[], context?: any): Promise<AgentSignal[]> {
    const startTime = performance.now();
    
    // Filter to only requested agents
    const requestedAgents = Array.from(this.agents.values()).filter(agent => 
      agentNames.includes(agent.getHealth().agentName)
    );
    
    // Wrap each agent call in error handling
    const signalPromises = requestedAgents.map(async agent => {
      try {
        return await agent.generateSignal(symbol, context);
      } catch (error) {
        console.error(`[AgentManager] Agent ${agent.getHealth().agentName} failed to generate signal:`, error);
        // Return null signal on error, filter out later
        return null;
      }
    });

    const results = await Promise.all(signalPromises);
    
    // Filter out null signals from failed agents
    const signals = results.filter((s): s is AgentSignal => s !== null);
    
    const duration = performance.now() - startTime;
    console.log(`[AgentManager] ⚡ Collected ${signals.length} signals from ${agentNames.join(', ')} in ${duration.toFixed(2)}ms (parallel execution)`);
    
    return signals;
  }

  /**
   * Get signals from all agents for a symbol
   * Runs all agents in parallel for maximum speed
   */
  async getAllSignals(symbol: string, context?: any): Promise<AgentSignal[]> {
    const startTime = performance.now();
    
    // Wrap each agent call in error handling
    const signalPromises = Array.from(this.agents.values()).map(async agent => {
      try {
        return await agent.generateSignal(symbol, context);
      } catch (error) {
        console.error(`[AgentManager] Agent ${agent.getHealth().agentName} failed to generate signal:`, error);
        // Return null signal on error, filter out later
        return null;
      }
    });

    const results = await Promise.all(signalPromises);
    
    // Filter out null signals from failed agents
    const signals = results.filter((s): s is AgentSignal => s !== null);
    
    const duration = performance.now() - startTime;
    console.log(`[AgentManager] ⚡ Collected ${signals.length} signals in ${duration.toFixed(2)}ms (parallel execution)`);
    
    // Update health state with latest signal time
    if (signals.length > 0) {
      this.lastSignalTime = getActiveClock().now();
      this.updateAgentHealthState();
    }
    
    return signals;
  }

  /**
   * Get health status of all agents
   */
  getAllHealth(): AgentHealth[] {
    return Array.from(this.agents.values()).map(agent => agent.getHealth());
  }

  /**
   * Get all agents with their latest signals and health
   */
  getAllAgentsWithSignals() {
    return Array.from(this.agents.values()).map(agent => {
      const health = agent.getHealth();
      const latestSignal = agent.getLatestSignal();
      return {
        ...health,
        latestSignal,
        signalCount: agent.getRecentSignals(100).length,
      };
    });
  }

  /**
   * Get a specific agent
   */
  getAgent(name: string): AgentBase | undefined {
    return this.agents.get(name);
  }

  /**
   * Get all agent names
   */
  getAgentNames(): string[] {
    return Array.from(this.agents.keys());
  }
}

// Singleton instance
let agentManagerInstance: AgentManager | null = null;

/**
 * Get Agent Manager singleton instance
 */
export function getAgentManager(): AgentManager {
  if (!agentManagerInstance) {
    agentManagerInstance = new AgentManager();
  }
  return agentManagerInstance;
}
