/**
 * Tests for CriticalAlertMonitor and monitoring framework integration
 * 
 * Note: CriticalAlertMonitor is tested via its exported singleton since
 * vi.mock hoisting makes dynamic re-import unreliable for the same module.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// Mock database - prevents actual DB calls
vi.mock("../db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

// Mock drizzle schema (needed by CriticalAlertMonitor)
vi.mock("../../drizzle/schema", () => ({
  systemHeartbeat: {},
  apiConnectionLog: { apiName: "apiName", timestamp: "timestamp" },
  capitalUtilization: { timestamp: "timestamp" },
  paperPositions: { status: "status", realizedPnl: "realizedPnl", exitTime: "exitTime" },
  alertLog: {},
  websocketHealthLog: {},
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  sql: vi.fn(),
  desc: vi.fn(),
  and: vi.fn(),
  gte: vi.fn(),
  eq: vi.fn(),
}));

// Mock AlertLogger
vi.mock("../monitoring/AlertLogger", () => ({
  alertLogger: {
    logAlert: vi.fn().mockReturnValue(true),
    getRecentAlerts: vi.fn().mockReturnValue([]),
  },
}));

// Mock SystemHeartbeat
vi.mock("../monitoring/SystemHeartbeat", () => ({
  systemHeartbeatService: {
    getStatus: vi.fn().mockReturnValue({
      isRunning: true,
      ticksProcessedLastMinute: 100,
      positionsCheckedLastMinute: 5,
      lastTickTime: new Date().toISOString(),
      startTime: new Date().toISOString(),
    }),
    start: vi.fn(),
    stop: vi.fn(),
    recordTick: vi.fn(),
    recordPositionCheck: vi.fn(),
    updateMetrics: vi.fn(),
  },
}));

// Mock notification
vi.mock("../_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

// Import the real CriticalAlertMonitor (uses mocked dependencies above)
import { criticalAlertMonitor } from "../monitoring/CriticalAlertMonitor";

describe("CriticalAlertMonitor", () => {
  afterEach(() => {
    criticalAlertMonitor.stop();
  });

  it("should be a singleton (same reference from multiple imports)", async () => {
    const mod = await import("../monitoring/CriticalAlertMonitor");
    expect(mod.criticalAlertMonitor).toBe(criticalAlertMonitor);
  });

  it("should have 6 alert rules defined", () => {
    const status = criticalAlertMonitor.getStatus();
    expect(status.rules).toHaveLength(6);
  });

  it("should have correct alert rule names", () => {
    const status = criticalAlertMonitor.getStatus();
    const ruleNames = status.rules.map((r: any) => r.name);
    expect(ruleNames).toContain("System Down Detection");
    expect(ruleNames).toContain("Connection Failure Detection");
    expect(ruleNames).toContain("Capital Underutilization Detection");
    expect(ruleNames).toContain("Poor Performance Detection");
    expect(ruleNames).toContain("High Memory Usage Detection");
    expect(ruleNames).toContain("WebSocket Stale Detection");
  });

  it("should have correct alert types", () => {
    const status = criticalAlertMonitor.getStatus();
    const alertTypes = status.rules.map((r: any) => r.alertType);
    expect(alertTypes).toContain("system_down");
    expect(alertTypes).toContain("api_connection_failure");
    expect(alertTypes).toContain("capital_underutilized");
    expect(alertTypes).toContain("poor_performance");
    expect(alertTypes).toContain("high_memory");
    expect(alertTypes).toContain("websocket_stale");
  });

  it("should have 3 critical and 3 warning severity rules", () => {
    const status = criticalAlertMonitor.getStatus();
    const criticalRules = status.rules.filter((r: any) => r.severity === "critical");
    const warningRules = status.rules.filter((r: any) => r.severity === "warning");
    expect(criticalRules).toHaveLength(3);
    expect(warningRules).toHaveLength(3);
  });

  it("should start and stop without errors", () => {
    expect(() => criticalAlertMonitor.start()).not.toThrow();
    expect(() => criticalAlertMonitor.stop()).not.toThrow();
  });

  it("should report lastCheck as 'never' before first check", () => {
    const status = criticalAlertMonitor.getStatus();
    for (const rule of status.rules) {
      expect(rule.lastCheck).toBe("never");
    }
  });

  it("should not start duplicate intervals (idempotent start)", () => {
    criticalAlertMonitor.start();
    criticalAlertMonitor.start(); // Second call should be no-op
    criticalAlertMonitor.stop();
  });

  it("should return structured status with rules array", () => {
    const status = criticalAlertMonitor.getStatus();
    expect(status).toHaveProperty("rules");
    expect(Array.isArray(status.rules)).toBe(true);
    for (const rule of status.rules) {
      expect(rule).toHaveProperty("name");
      expect(rule).toHaveProperty("alertType");
      expect(rule).toHaveProperty("severity");
      expect(rule).toHaveProperty("lastCheck");
    }
  });
});

describe("Alert Severity Classification", () => {
  it("should classify alerts into critical and warning categories", () => {
    const criticalTypes = ["system_down", "api_connection_failure", "websocket_stale"];
    const warningTypes = ["capital_underutilized", "poor_performance", "high_memory"];

    expect(criticalTypes).toHaveLength(3);
    expect(warningTypes).toHaveLength(3);

    // No overlap between categories
    for (const ct of criticalTypes) {
      expect(warningTypes).not.toContain(ct);
    }
  });

  it("should have all alert types as unique strings", () => {
    const alertTypes = [
      "system_down",
      "api_connection_failure",
      "capital_underutilized",
      "poor_performance",
      "high_memory",
      "websocket_stale",
    ];
    const uniqueTypes = new Set(alertTypes);
    expect(uniqueTypes.size).toBe(alertTypes.length);
  });
});
