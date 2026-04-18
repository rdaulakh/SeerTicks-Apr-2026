/**
 * Monitoring Framework - Central Entry Point
 * 
 * Initializes and manages all monitoring services:
 * - SystemHeartbeat: Proves system is alive (60s intervals)
 * - ServiceEventLogger: Logs lifecycle events (start/stop/crash)
 * - APIConnectionMonitor: Tracks API call health and performance
 * - WebSocketHealthMonitor: Monitors WebSocket connection health
 * - ExitDecisionLogger: Logs exit decision analysis
 * - CapitalUtilizationLogger: Tracks capital deployment
 * - PositionSizingLogger: Logs position sizing decisions
 * - EntryValidationLogger: Logs entry validation decisions
 * - AlertLogger: Centralized alert logging
 */

import { systemHeartbeatService } from "./SystemHeartbeat";
import { serviceEventLogger } from "./ServiceEventLogger";
import { apiConnectionMonitor } from "./APIConnectionMonitor";
import { wsHealthMonitor } from "./WebSocketHealthMonitor";
import { exitDecisionLogger } from "./ExitDecisionLogger";
import { capitalUtilizationLogger } from "./CapitalUtilizationLogger";
import { positionSizingLogger } from "./PositionSizingLogger";
import { entryValidationLogger } from "./EntryValidationLogger";
import { alertLogger } from "./AlertLogger";
import { criticalAlertMonitor } from "./CriticalAlertMonitor";
import { startAgentHealthMonitor, stopAgentHealthMonitor, getLastHealthReport } from "./AgentHealthMonitor";

let isStarted = false;

/**
 * Start all monitoring services.
 * Safe to call multiple times - idempotent.
 */
export async function startMonitoringFramework(restartReason?: string): Promise<void> {
  if (isStarted) {
    console.log("[MonitoringFramework] Already started, skipping");
    return;
  }

  console.log("[MonitoringFramework] ========================================");
  console.log("[MonitoringFramework] Starting Complete Logging Framework...");
  console.log("[MonitoringFramework] ========================================");

  try {
    // Phase 1 - CRITICAL
    systemHeartbeatService.start(restartReason || "Engine startup");
    await serviceEventLogger.logStart("MonitoringFramework", "Complete logging framework initialized");
    apiConnectionMonitor.start();
    wsHealthMonitor.start();
    exitDecisionLogger.start();

    // Phase 2 - HIGH
    capitalUtilizationLogger.start();
    positionSizingLogger.start();

    // Phase 3 - OPTIMIZATION
    entryValidationLogger.start();
    alertLogger.start();

    // Critical Alert Monitor - runs periodic health checks
    criticalAlertMonitor.start();

    // Phase 4 - AGENT HEALTH (hourly bias detection)
    startAgentHealthMonitor(60); // Check every 60 minutes

    isStarted = true;
    console.log("[MonitoringFramework] ✅ All 10 monitoring services started (including AgentHealthMonitor)");
  } catch (error: any) {
    console.error("[MonitoringFramework] Failed to start some services:", error.message);
    // Don't throw - partial monitoring is better than none
  }
}

/**
 * Stop all monitoring services gracefully.
 */
export async function stopMonitoringFramework(): Promise<void> {
  if (!isStarted) return;

  console.log("[MonitoringFramework] Stopping all monitoring services...");

  try {
    await serviceEventLogger.logStop("MonitoringFramework", "Engine shutdown");
  } catch (e) {}

  systemHeartbeatService.stop();
  await apiConnectionMonitor.stop();
  wsHealthMonitor.stop();
  exitDecisionLogger.stop();
  capitalUtilizationLogger.stop();
  positionSizingLogger.stop();
  entryValidationLogger.stop();
  alertLogger.stop();
  criticalAlertMonitor.stop();
  stopAgentHealthMonitor();

  isStarted = false;
  console.log("[MonitoringFramework] All monitoring services stopped");
}

/**
 * Get comprehensive health status from all monitors.
 */
export function getMonitoringStatus(): Record<string, any> {
  return {
    heartbeat: systemHeartbeatService.getStatus(),
    apiConnections: apiConnectionMonitor.getStats(),
    webSockets: wsHealthMonitor.getStatus(),
    capitalUtilization: capitalUtilizationLogger.getLatestSnapshot(),
    criticalAlerts: criticalAlertMonitor.getStatus(),
    agentHealth: getLastHealthReport(),
    isRunning: isStarted,
  };
}

// Re-export all services for direct access
export {
  systemHeartbeatService,
  serviceEventLogger,
  apiConnectionMonitor,
  wsHealthMonitor,
  exitDecisionLogger,
  capitalUtilizationLogger,
  positionSizingLogger,
  entryValidationLogger,
  alertLogger,
  criticalAlertMonitor,
  startAgentHealthMonitor,
  stopAgentHealthMonitor,
  getLastHealthReport,
};
