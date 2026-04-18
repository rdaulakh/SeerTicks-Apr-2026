/**
 * Agent Accuracy Tracker Service
 * Tracks accuracy and performance of AI trading agents
 */

export interface AgentAccuracy {
  agentName: string;
  totalSignals: number;
  correctSignals: number;
  accuracy: number;
  averageConfidence: number;
  lastUpdated: Date;
}

class AgentAccuracyTracker {
  private accuracyData: Map<string, AgentAccuracy> = new Map();

  /**
   * Get accuracy for all agents
   */
  getAllAccuracy(): AgentAccuracy[] {
    return Array.from(this.accuracyData.values());
  }

  /**
   * Get accuracy for specific agent
   */
  getAccuracy(agentName: string): AgentAccuracy | undefined {
    return this.accuracyData.get(agentName);
  }

  /**
   * Record agent signal
   */
  recordSignal(agentName: string, correct: boolean, confidence: number): void {
    const existing = this.accuracyData.get(agentName) || {
      agentName,
      totalSignals: 0,
      correctSignals: 0,
      accuracy: 0,
      averageConfidence: 0,
      lastUpdated: new Date(),
    };

    existing.totalSignals++;
    if (correct) {
      existing.correctSignals++;
    }
    existing.accuracy = (existing.correctSignals / existing.totalSignals) * 100;
    existing.averageConfidence = 
      (existing.averageConfidence * (existing.totalSignals - 1) + confidence) / existing.totalSignals;
    existing.lastUpdated = new Date();

    this.accuracyData.set(agentName, existing);
  }

  /**
   * Clear all accuracy data
   */
  clear(): void {
    this.accuracyData.clear();
  }
}

const agentAccuracyTracker = new AgentAccuracyTracker();

export function getAgentAccuracyTracker(): AgentAccuracyTracker {
  return agentAccuracyTracker;
}

export { AgentAccuracyTracker };
