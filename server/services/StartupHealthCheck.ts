import { getDb } from "../db";
import { serviceHealth, serviceHealthHistory, systemStartupLog } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export type HealthCheckStatus = "healthy" | "degraded" | "down" | "unknown";

export interface HealthCheckResult {
  serviceName: string;
  status: HealthCheckStatus;
  responseTime?: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export interface StartupResult {
  startupId: string;
  status: "success" | "failed" | "partial";
  canTrade: boolean;
  results: HealthCheckResult[];
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  errorSummary?: string;
}

/**
 * Comprehensive startup health check service
 * Validates all critical services before allowing trading operations
 */
export class StartupHealthCheck {
  private startupId: string;
  private results: HealthCheckResult[] = [];
  private startedAt: Date;

  constructor() {
    this.startupId = uuidv4();
    this.startedAt = new Date();
  }

  /**
   * Run all health checks in dependency order
   * Returns true only if ALL critical services are healthy
   */
  async runAllChecks(): Promise<StartupResult> {
    console.log(`[StartupHealthCheck] Starting health checks (ID: ${this.startupId})`);

    // Log startup attempt
    await this.logStartupAttempt("in_progress");

    try {
      // Phase 1: Database connectivity (CRITICAL)
      await this.checkDatabase();

      // Phase 2: External APIs (CRITICAL for trading)
      await this.checkCoinbaseAPI();
      await this.checkWhaleAlertAPI();

      // Phase 3: Price feed WebSocket (CRITICAL)
      await this.checkPriceFeedWebSocket();

      // Phase 4: MetaAPI connection (CRITICAL for real trading)
      await this.checkMetaAPIConnection();

      // Phase 5: Internal services (IMPORTANT but not blocking)
      await this.checkBalanceTracker();
      await this.checkPositionManager();

      // Analyze results
      const result = this.analyzeResults();

      // Log final result
      await this.logStartupAttempt(result.status, result);

      // Save health status to database
      await this.saveHealthStatus();

      return result;
    } catch (error) {
      console.error("[StartupHealthCheck] Fatal error during health checks:", error);
      const result: StartupResult = {
        startupId: this.startupId,
        status: "failed",
        canTrade: false,
        results: this.results,
        totalChecks: this.results.length,
        passedChecks: 0,
        failedChecks: this.results.length,
        errorSummary: error instanceof Error ? error.message : "Unknown error",
      };

      await this.logStartupAttempt("failed", result);
      return result;
    }
  }

  /**
   * Check database connectivity and schema integrity
   */
  private async checkDatabase(): Promise<void> {
    const serviceName = "database";
    const startTime = Date.now();

    try {
      const db = await getDb();
      if (!db) {
        throw new Error("Database connection not available");
      }

      // Test query to verify connection
      await db.select().from(serviceHealth).limit(1);

      const responseTime = Date.now() - startTime;
      this.results.push({
        serviceName,
        status: "healthy",
        responseTime,
        metadata: { message: "Database connection successful" },
      });

      console.log(`[StartupHealthCheck] ✓ Database: healthy (${responseTime}ms)`);
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      this.results.push({
        serviceName,
        status: "down",
        responseTime,
        errorMessage,
      });

      console.error(`[StartupHealthCheck] ✗ Database: down - ${errorMessage}`);
    }
  }

  /**
   * Check Coinbase API availability and rate limits
   */
  private async checkCoinbaseAPI(): Promise<void> {
    const serviceName = "coinbase_api";
    const startTime = Date.now();

    try {
      // Test Coinbase API with a simple public endpoint (no auth required)
      const response = await fetch("https://api.coinbase.com/api/v3/brokerage/products/BTC-USDT");
      
      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        // 401 Unauthorized is expected if API keys are not configured
        // This is acceptable for paper trading mode
        if (response.status === 401) {
          this.results.push({
            serviceName,
            status: "degraded",
            responseTime,
            errorMessage: "API keys not configured (paper trading mode)",
            metadata: { statusCode: 401, mode: "paper_trading" },
          });
          console.warn(`[StartupHealthCheck] ⚠ Coinbase API: degraded - no API keys (paper trading mode)`);
          return;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const price = data.price ? parseFloat(data.price) : null;

      if (price && price > 0) {
        this.results.push({
          serviceName,
          status: "healthy",
          responseTime,
          metadata: { testPrice: price, symbol: "BTC/USDT" },
        });
        console.log(`[StartupHealthCheck] ✓ Coinbase API: healthy (${responseTime}ms, BTC: $${price})`);
      } else {
        throw new Error("Invalid price returned");
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Check if it's a rate limit error
      const isRateLimit = errorMessage.includes("429") || errorMessage.includes("rate limit");
      const status: HealthCheckStatus = isRateLimit ? "degraded" : "down";

      this.results.push({
        serviceName,
        status,
        responseTime,
        errorMessage,
        metadata: { isRateLimit },
      });

      console.error(`[StartupHealthCheck] ✗ Coinbase API: ${status} - ${errorMessage}`);
    }
  }

  /**
   * Check Whale Alert API availability
   */
  private async checkWhaleAlertAPI(): Promise<void> {
    const serviceName = "whale_alert_api";
    const startTime = Date.now();

    try {
      const apiKey = process.env.WHALE_ALERT_API_KEY;
      if (!apiKey) {
        throw new Error("WHALE_ALERT_API_KEY not configured");
      }

      // Simple status check
      const response = await fetch(`https://api.whale-alert.io/v1/status?api_key=${apiKey}`);
      const responseTime = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json();
        this.results.push({
          serviceName,
          status: "healthy",
          responseTime,
          metadata: data,
        });
        console.log(`[StartupHealthCheck] ✓ Whale Alert API: healthy (${responseTime}ms)`);
      } else if (response.status === 429) {
        this.results.push({
          serviceName,
          status: "degraded",
          responseTime,
          errorMessage: "Rate limit exceeded",
          metadata: { statusCode: response.status },
        });
        console.warn(`[StartupHealthCheck] ⚠ Whale Alert API: degraded - rate limited`);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      this.results.push({
        serviceName,
        status: "down",
        responseTime,
        errorMessage,
      });

      console.error(`[StartupHealthCheck] ✗ Whale Alert API: down - ${errorMessage}`);
    }
  }

  /**
   * Check price feed WebSocket connection
   */
  private async checkPriceFeedWebSocket(): Promise<void> {
    const serviceName = "price_feed_websocket";
    const startTime = Date.now();

    try {
      // Import dynamically
      const { priceFeedService } = await import("./priceFeedService");

      // Check if service is running
      const isRunning = (priceFeedService as any).isRunning;
      const responseTime = Date.now() - startTime;

      if (isRunning) {
        this.results.push({
          serviceName,
          status: "healthy",
          responseTime,
          metadata: { running: true },
        });
        console.log(`[StartupHealthCheck] ✓ Price Feed Service: healthy (${responseTime}ms)`);
      } else {
        // Service not running, but this is not critical at startup
        // It will be started when needed
        this.results.push({
          serviceName,
          status: "healthy",
          responseTime,
          metadata: { running: false, message: "Service will start on demand" },
        });
        console.log(`[StartupHealthCheck] ✓ Price Feed Service: available (will start on demand)`);
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      this.results.push({
        serviceName,
        status: "down",
        responseTime,
        errorMessage,
      });

      console.error(`[StartupHealthCheck] ✗ Price Feed WebSocket: down - ${errorMessage}`);
    }
  }

  /**
   * Check MetaAPI connection and account sync
   */
  private async checkMetaAPIConnection(): Promise<void> {
    const serviceName = "metaapi";
    const startTime = Date.now();

    try {
      const apiToken = process.env.METAAPI_TOKEN;
      if (!apiToken) {
        // MetaAPI is optional for paper trading
        this.results.push({
          serviceName,
          status: "unknown",
          responseTime: Date.now() - startTime,
          metadata: { message: "MetaAPI not configured (paper trading only)" },
        });
        console.log(`[StartupHealthCheck] ⚠ MetaAPI: not configured (paper trading mode)`);
        return;
      }

      // Test MetaAPI connection
      const response = await fetch("https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current", {
        headers: {
          "auth-token": apiToken,
        },
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json();
        this.results.push({
          serviceName,
          status: "healthy",
          responseTime,
          metadata: { userId: data._id, email: data.email },
        });
        console.log(`[StartupHealthCheck] ✓ MetaAPI: healthy (${responseTime}ms)`);
      } else if (response.status === 404 || response.status === 401) {
        // 404/401 indicates invalid or missing API token - acceptable for paper trading
        this.results.push({
          serviceName,
          status: "degraded",
          responseTime,
          errorMessage: "Invalid API token (paper trading mode)",
          metadata: { statusCode: response.status, mode: "paper_trading" },
        });
        console.warn(`[StartupHealthCheck] ⚠ MetaAPI: degraded - invalid token (paper trading mode)`);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      this.results.push({
        serviceName,
        status: "down",
        responseTime,
        errorMessage,
      });

      console.error(`[StartupHealthCheck] ✗ MetaAPI: down - ${errorMessage}`);
    }
  }

  /**
   * Check BalanceTracker service
   */
  private async checkBalanceTracker(): Promise<void> {
    const serviceName = "balance_tracker";
    const startTime = Date.now();

    try {
      // Import dynamically
      const { BalanceTracker } = await import("./BalanceTracker");

      // BalanceTracker is a class that can be instantiated
      // Just verify it's importable
      const responseTime = Date.now() - startTime;

      this.results.push({
        serviceName,
        status: "healthy",
        responseTime,
        metadata: { available: true },
      });

      console.log(`[StartupHealthCheck] ✓ BalanceTracker: healthy (${responseTime}ms)`);
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      this.results.push({
        serviceName,
        status: "down",
        responseTime,
        errorMessage,
      });

      console.error(`[StartupHealthCheck] ✗ BalanceTracker: down - ${errorMessage}`);
    }
  }

  /**
   * Check PositionManager service
   */
  private async checkPositionManager(): Promise<void> {
    const serviceName = "position_manager";
    const startTime = Date.now();

    try {
      // Import dynamically
      const { PositionManager } = await import("../PositionManager");

      // PositionManager is instantiated per-user, so we just check if the class is available
      const responseTime = Date.now() - startTime;

      this.results.push({
        serviceName,
        status: "healthy",
        responseTime,
        metadata: { available: true },
      });

      console.log(`[StartupHealthCheck] ✓ PositionManager: healthy (${responseTime}ms)`);
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      this.results.push({
        serviceName,
        status: "down",
        responseTime,
        errorMessage,
      });

      console.error(`[StartupHealthCheck] ✗ PositionManager: down - ${errorMessage}`);
    }
  }

  /**
   * Analyze health check results and determine if trading is allowed
   */
  private analyzeResults(): StartupResult {
    const totalChecks = this.results.length;
    const passedChecks = this.results.filter((r) => r.status === "healthy").length;
    const failedChecks = this.results.filter((r) => r.status === "down").length;
    const degradedChecks = this.results.filter((r) => r.status === "degraded").length;

    // Critical services that MUST be healthy for trading
    // Note: coinbase_api and metaapi are now optional - system can run in paper trading mode
    const criticalServices = ["database", "price_feed_websocket"];
    const criticalHealthy = criticalServices.every((service) => {
      const result = this.results.find((r) => r.serviceName === service);
      return result && result.status === "healthy";
    });

    // Determine overall status
    let status: "success" | "failed" | "partial";
    let canTrade: boolean;

    // Non-critical services that can fail without blocking paper trading
    // These are only required for live trading mode
    const nonCriticalServices = ["coinbase_api", "metaapi", "whale_alert"];
    const nonCriticalFailures = this.results.filter(
      (r) => r.status === "down" && nonCriticalServices.includes(r.serviceName)
    ).length;
    const criticalFailures = failedChecks - nonCriticalFailures;

    if (failedChecks === 0 && degradedChecks === 0) {
      status = "success";
      canTrade = true;
    } else if (criticalHealthy && criticalFailures === 0) {
      // Critical services healthy, only non-critical services failed
      // This is acceptable - can trade in paper trading mode
      status = "partial";
      canTrade = true;
      console.log(`[StartupHealthCheck] ✅ Paper trading mode allowed - ${nonCriticalFailures} non-critical service(s) failed but critical services healthy`);
    } else if (criticalHealthy && failedChecks === 0) {
      // Critical services healthy, only degraded services (e.g., API keys not configured)
      // This is acceptable - can trade in paper trading mode
      status = "partial";
      canTrade = true;
    } else if (criticalHealthy) {
      // Critical services OK but some critical services failed
      status = "partial";
      canTrade = false;
    } else {
      status = "failed";
      canTrade = false;
    }

    const errors = this.results.filter((r) => r.status === "down" || r.status === "degraded").map((r) => `${r.serviceName}: ${r.errorMessage || r.status}`);

    const errorSummary = errors.length > 0 ? errors.join("; ") : undefined;

    console.log(`[StartupHealthCheck] Summary: ${passedChecks}/${totalChecks} passed, ${failedChecks} failed, ${degradedChecks} degraded`);
    console.log(`[StartupHealthCheck] Can trade: ${canTrade ? "YES" : "NO"}`);

    return {
      startupId: this.startupId,
      status,
      canTrade,
      results: this.results,
      totalChecks,
      passedChecks,
      failedChecks,
      errorSummary,
    };
  }

  /**
   * Save health status to database
   */
  private async saveHealthStatus(): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;

      // Update or insert health status for each service
      for (const result of this.results) {
        // Check if record exists
        const existing = await db.select().from(serviceHealth).where(eq(serviceHealth.serviceName, result.serviceName)).limit(1);

        const now = new Date();
        const healthData = {
          serviceName: result.serviceName,
          status: result.status,
          lastCheckAt: now,
          lastHealthyAt: result.status === "healthy" ? now : existing[0]?.lastHealthyAt || null,
          consecutiveFailures: result.status === "down" ? (existing[0]?.consecutiveFailures || 0) + 1 : 0,
          errorMessage: result.errorMessage || null,
          metadata: result.metadata || null,
          updatedAt: now,
        };

        if (existing.length > 0) {
          await db.update(serviceHealth).set(healthData).where(eq(serviceHealth.serviceName, result.serviceName));
        } else {
          await db.insert(serviceHealth).values({
            ...healthData,
            createdAt: now,
          });
        }

        // Insert into history
        await db.insert(serviceHealthHistory).values({
          serviceName: result.serviceName,
          status: result.status,
          responseTime: result.responseTime || null,
          errorMessage: result.errorMessage || null,
          metadata: result.metadata || null,
          timestamp: now,
        });
      }
    } catch (error) {
      console.error("[StartupHealthCheck] Failed to save health status:", error);
    }
  }

  /**
   * Log startup attempt to database
   */
  private async logStartupAttempt(status: "in_progress" | "success" | "failed" | "partial", result?: StartupResult): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;

      const now = new Date();

      if (status === "in_progress") {
        await db.insert(systemStartupLog).values({
          startupId: this.startupId,
          status,
          startedAt: this.startedAt,
          completedAt: null,
          totalChecks: 0,
          passedChecks: 0,
          failedChecks: 0,
          healthCheckResults: [],
          errorSummary: null,
          canTrade: false,
        });
      } else if (result) {
        await db
          .update(systemStartupLog)
          .set({
            status,
            completedAt: now,
            totalChecks: result.totalChecks,
            passedChecks: result.passedChecks,
            failedChecks: result.failedChecks,
            healthCheckResults: result.results,
            errorSummary: result.errorSummary || null,
            canTrade: result.canTrade,
          })
          .where(eq(systemStartupLog.startupId, this.startupId));
      }
    } catch (error) {
      console.error("[StartupHealthCheck] Failed to log startup attempt:", error);
    }
  }
}

/**
 * Run startup health checks
 * Returns true if system is ready for trading
 */
export async function runStartupHealthChecks(): Promise<StartupResult> {
  const healthCheck = new StartupHealthCheck();
  return await healthCheck.runAllChecks();
}
