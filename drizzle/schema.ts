import { boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, decimal, uniqueIndex, index, mediumtext, bigint, tinyint } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }).notNull().unique(),
  /** Password hash for email/password authentication (bcrypt) */
  passwordHash: varchar("passwordHash", { length: 255 }),
  /** Email verification status */
  emailVerified: boolean("emailVerified").default(false).notNull(),
  loginMethod: varchar("loginMethod", { length: 64 }).default('email').notNull(),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Password reset tokens — Phase 54.
 * Stores SHA-256 hash of the token (never plaintext) so a DB compromise
 * doesn't expose usable reset links. Tokens are single-use and time-limited.
 */
export const passwordResetTokens = mysqlTable("passwordResetTokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** SHA-256 hex of the random token. The plaintext only exists in the email. */
  tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  /** Timestamp when the token was consumed; null until used. Once set, token can't be reused. */
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  tokenHashIdx: uniqueIndex("idx_passwordResetTokens_tokenHash").on(t.tokenHash),
  userIdIdx: index("idx_passwordResetTokens_userId").on(t.userId),
}));

/**
 * OTP verification table
 * Stores one-time passwords for email verification
 */
export const otpVerifications = mysqlTable("otpVerifications", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  otp: varchar("otp", { length: 6 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  verified: boolean("verified").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OtpVerification = typeof otpVerifications.$inferSelect;
export type InsertOtpVerification = typeof otpVerifications.$inferInsert;

/**
 * User settings table
 * Stores trading, agent, risk, and notification preferences
 */
export const settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(), // One settings record per user
  
  // Trading Settings
  paperTrading: boolean("paperTrading").default(true).notNull(),
  maxPositionSize: int("maxPositionSize").default(20).notNull(), // Percentage (1-100)
  minConfidence: int("minConfidence").default(60).notNull(), // Percentage (50-100)
  stopLoss: int("stopLoss").default(5).notNull(), // Percentage (1-50)
  takeProfit: int("takeProfit").default(10).notNull(), // Percentage (1-100)
  
  // Agent Settings
  enableFastAgents: boolean("enableFastAgents").default(true).notNull(),
  enableSlowAgents: boolean("enableSlowAgents").default(true).notNull(),
  agentUpdateInterval: int("agentUpdateInterval").default(10).notNull(), // Minutes (5-60)
  
  // Notifications
  emailNotifications: boolean("emailNotifications").default(true).notNull(),
  pushNotifications: boolean("pushNotifications").default(false).notNull(),
  tradeAlerts: boolean("tradeAlerts").default(true).notNull(),
  signalAlerts: boolean("signalAlerts").default(false).notNull(),
  
  // Risk Management
  maxDailyLoss: int("maxDailyLoss").default(1000).notNull(), // Dollars
  maxDrawdown: int("maxDrawdown").default(15).notNull(), // Percentage (1-100)
  riskPerTrade: int("riskPerTrade").default(2).notNull(), // Percentage × 10 (stored as 20 for 2.0%)
  
  // Latency Alerts
  latencyAlertsEnabled: boolean("latencyAlertsEnabled").default(true).notNull(),
  latencyP50Threshold: int("latencyP50Threshold").default(100).notNull(), // Milliseconds
  latencyP95Threshold: int("latencyP95Threshold").default(500).notNull(), // Milliseconds
  latencyP99Threshold: int("latencyP99Threshold").default(1000).notNull(), // Milliseconds
  latencyEmailAlerts: boolean("latencyEmailAlerts").default(false).notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type Settings = typeof settings.$inferSelect;
export type InsertSettings = typeof settings.$inferInsert;

/**
 * Health metrics history table
 * Stores historical health and latency metrics for trend analysis
 */
export const healthMetrics = mysqlTable("healthMetrics", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Latency metrics
  p50Latency: int("p50Latency").notNull(), // Milliseconds
  p95Latency: int("p95Latency").notNull(), // Milliseconds
  p99Latency: int("p99Latency").notNull(), // Milliseconds
  avgLatency: int("avgLatency").notNull(), // Milliseconds
  
  // Health metrics
  totalTraces: int("totalTraces").notNull(),
  completedTraces: int("completedTraces").notNull(),
  failedTraces: int("failedTraces").notNull(),
  errorRate: int("errorRate").notNull(), // Percentage × 100 (e.g., 250 = 2.50%)
  
  // Agent health (JSON object with agent statuses)
  agentHealth: json("agentHealth"), // { agentName: { status, uptime, accuracy } }
  
  timestamp: timestamp("timestamp").notNull().defaultNow()});

export type HealthMetric = typeof healthMetrics.$inferSelect;
export type InsertHealthMetric = typeof healthMetrics.$inferInsert;

/**
 * Exchange configuration table
 * Stores user's selected exchange and connection status
 */
export const exchanges = mysqlTable("exchanges", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  // Phase 57 — binance-futures added so users can store USDM Perpetual
  // Futures testnet/live credentials per-account via Settings → Exchanges
  // (replaces the env-var-only path which couldn't scale past one user).
  exchangeName: mysqlEnum("exchangeName", ["binance", "binance-futures", "coinbase"]).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  connectionStatus: mysqlEnum("connectionStatus", ["connected", "disconnected", "error"]).default("disconnected").notNull(),
  lastConnected: timestamp("lastConnected"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type Exchange = typeof exchanges.$inferSelect;
export type InsertExchange = typeof exchanges.$inferInsert;

/**
 * Engine state table
 * Persists engine running state across server restarts and user logouts
 */
export const engineState = mysqlTable("engineState", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(), // One engine per user
  isRunning: boolean("isRunning").default(false).notNull(),
  startedAt: timestamp("startedAt"),
  stoppedAt: timestamp("stoppedAt"),
  config: json("config"), // { totalCapital, tickInterval, enableAutoTrading, etc. }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type EngineState = typeof engineState.$inferSelect;
export type InsertEngineState = typeof engineState.$inferInsert;

/**
 * Encrypted API keys table
 * Stores encrypted exchange API credentials
 */
export const apiKeys = mysqlTable("apiKeys", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  exchangeId: int("exchangeId").notNull(),
  encryptedApiKey: text("encryptedApiKey").notNull(),
  encryptedApiSecret: text("encryptedApiSecret").notNull(),
  apiKeyIv: varchar("apiKeyIv", { length: 32 }).notNull(), // Initialization vector for API key
  apiSecretIv: varchar("apiSecretIv", { length: 32 }).notNull(), // Initialization vector for API secret
  isValid: boolean("isValid").default(false).notNull(),
  lastTested: timestamp("lastTested"),
  mt5AccountNumber: varchar("mt5AccountNumber", { length: 64 }),
  mt5ServerName: varchar("mt5ServerName", { length: 128 }),
  metaapiAccountId: varchar("metaapiAccountId", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

/**
 * Trades table
 * Complete history of all trades with enriched learning data
 */
export const trades = mysqlTable("trades", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  exchangeId: int("exchangeId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(), // e.g., "BTC/USDT"
  side: mysqlEnum("side", ["long", "short"]).notNull(),
  entryPrice: varchar({ length: 50 }).notNull(),
  exitPrice: varchar({ length: 50 }),
  quantity: varchar({ length: 50 }).notNull(),
  entryTime: timestamp("entryTime").notNull(),
  exitTime: timestamp("exitTime"),
  status: mysqlEnum("status", ["open", "closed", "cancelled"]).notNull(),
  pnl: varchar({ length: 50 }),
  pnlAfterCosts: varchar({ length: 50 }),
  totalCosts: varchar({ length: 50 }),
  costBreakdown: json("costBreakdown"), // { fees, spread, slippage }
  tradeQualityScore: varchar("tradeQualityScore", { length: 2 }), // A-F grading
  confidence: varchar({ length: 50 }), // 0.0000 to 1.0000
  patternUsed: varchar("patternUsed", { length: 100 }),
  exitReason: varchar("exitReason", { length: 50 }), // "target_reached", "stop_loss", "proactive_exit", etc.
  agentSignals: json("agentSignals"), // Snapshot of all agent signals at entry
  expectedPath: json("expectedPath"), // The defined path at entry
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()}, (table) => ({
  idx_trades_userId: index("idx_trades_userId").on(table.userId),
  idx_trades_userId_status: index("idx_trades_userId_status").on(table.userId, table.status),
  idx_trades_symbol_status: index("idx_trades_symbol_status").on(table.symbol, table.status),
  idx_trades_createdAt: index("idx_trades_createdAt").on(table.createdAt),
}));

export type Trade = typeof trades.$inferSelect;
export type InsertTrade = typeof trades.$inferInsert;

/**
 * Active positions table
 * Tracks currently open positions with real-time monitoring data
 */
export const positions = mysqlTable("positions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tradeId: int("tradeId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: mysqlEnum("side", ["long", "short"]).notNull(),
  entryPrice: varchar({ length: 50 }).notNull(),
  currentPrice: varchar({ length: 50 }),
  quantity: varchar({ length: 50 }).notNull(),
  stopLoss: varchar({ length: 50 }).notNull(),
  takeProfit: varchar({ length: 50 }).notNull(),
  expectedPath: json("expectedPath").notNull(),
  currentDeviation: varchar({ length: 50 }),
  lastRevalidation: timestamp("lastRevalidation"),
  thesisValid: boolean("thesisValid").default(true).notNull(),
  unrealizedPnl: varchar({ length: 50 }),
  // Position status and exit tracking
  status: mysqlEnum("status", ["open", "closed"]).default("open").notNull(),
  exitPrice: varchar("exitPrice", { length: 50 }),
  exitReason: varchar("exitReason", { length: 100 }),
  exitTime: timestamp("exitTime"),
  realizedPnl: varchar({ length: 50 }),
  // Order tracking fields for real-time WebSocket updates
  orderId: varchar("orderId", { length: 100 }), // Exchange order ID
  clientOrderId: varchar("clientOrderId", { length: 100 }), // Client-side order ID
  orderStatus: mysqlEnum("orderStatus", ["PENDING", "OPEN", "FILLED", "CANCELLED", "EXPIRED", "FAILED"]).default("PENDING"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()}, (table) => ({
  idx_positions_userId_status: index("idx_positions_userId_status").on(table.userId, table.status),
  idx_positions_symbol: index("idx_positions_symbol").on(table.symbol),
}));

export type Position = typeof positions.$inferSelect;
export type InsertPosition = typeof positions.$inferInsert;

/**
 * Agent signals table
 * Historical record of all agent signals for learning and analysis
 */
export const agentSignals = mysqlTable("agentSignals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  agentName: varchar("agentName", { length: 50 }).notNull(),
  signalType: varchar("signalType", { length: 50 }).notNull(),
  signalData: json("signalData").notNull(),
  confidence: varchar({ length: 50 }),
  executionScore: int("executionScore"), // 0-100 tactical timing quality score
  marketConditions: json("marketConditions"), // Snapshot of market state
  timestamp: timestamp("timestamp").defaultNow().notNull()}, (table) => ({
  idx_agentSignals_userId_timestamp: index("idx_agentSignals_userId_timestamp").on(table.userId, table.timestamp),
  idx_agentSignals_agentName: index("idx_agentSignals_agentName").on(table.agentName),
}));

export type AgentSignal = typeof agentSignals.$inferSelect;
export type InsertAgentSignal = typeof agentSignals.$inferInsert;

/**
 * Trading signals table
 * Stores automated trading signals generated from technical indicators
 */
export const tradingSignals = mysqlTable("tradingSignals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  signalType: mysqlEnum("signalType", ["BUY", "SELL", "NEUTRAL"]).notNull(),
  source: mysqlEnum("source", ["RSI", "MACD", "STOCHASTIC", "COMBINED"]).notNull(),
  strength: int("strength").notNull(), // 0-100
  confidence: int("confidence").notNull(), // 0-100
  price: varchar({ length: 50 }).notNull(),
  indicators: json("indicators").notNull(), // { rsi, macd, stochastic }
  reasoning: text("reasoning").notNull(),
  executed: boolean("executed").default(false).notNull(),
  executedAt: timestamp("executedAt"),
  tradeId: int("tradeId"), // Link to trade if signal was executed
  timestamp: timestamp("timestamp").defaultNow().notNull()}, (table) => ({
  idx_tradingSignals_userId_symbol: index("idx_tradingSignals_userId_symbol").on(table.userId, table.symbol),
  idx_tradingSignals_timestamp: index("idx_tradingSignals_timestamp").on(table.timestamp),
}));

export type TradingSignal = typeof tradingSignals.$inferSelect;
export type InsertTradingSignal = typeof tradingSignals.$inferInsert;

/**
 * System health table
 * Tracks health status and uptime of all agents
 */
export const systemHealth = mysqlTable("systemHealth", {
  id: int("id").autoincrement().primaryKey(),
  agentName: varchar("agentName", { length: 50 }).notNull(),
  status: mysqlEnum("status", ["healthy", "degraded", "failed", "stopped"]).notNull(),
  lastHeartbeat: timestamp("lastHeartbeat").notNull(),
  errorCount: int("errorCount").default(0).notNull(),
  lastError: text("lastError"),
  uptime: int("uptime").default(0).notNull(), // seconds
  metadata: json("metadata"), // Additional health metrics
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type SystemHealth = typeof systemHealth.$inferSelect;
export type InsertSystemHealth = typeof systemHealth.$inferInsert;

/**
 * ML training data table
 * Enriched training data for machine learning models
 */
export const mlTrainingData = mysqlTable("mlTrainingData", {
  id: int("id").autoincrement().primaryKey(),
  tradeId: int("tradeId").notNull(),
  features: json("features").notNull(), // All input features for ML
  label: varchar({ length: 50 }).notNull(), // pnl_after_costs
  tradeQualityScore: varchar("tradeQualityScore", { length: 2 }).notNull(),
  qualityWeight: varchar({ length: 50 }).notNull(), // For weighted training
  marketRegime: varchar("marketRegime", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type MlTrainingData = typeof mlTrainingData.$inferSelect;
export type InsertMlTrainingData = typeof mlTrainingData.$inferInsert;

/**
 * Winning patterns table
 * Library of successful patterns with performance tracking for alpha decay monitoring
 */
export const winningPatterns = mysqlTable("winningPatterns", {
  id: int("id").autoincrement().primaryKey(),
  patternName: varchar("patternName", { length: 100 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(), // e.g., "BTCUSDT", "ETHUSDT"
  timeframe: mysqlEnum("timeframe", ["1m", "5m", "1h", "4h", "1d"]).notNull(),
  patternDescription: text("patternDescription"),
  patternVector: json("patternVector"), // For vector similarity search
  totalTrades: int("totalTrades").default(0).notNull(),
  winningTrades: int("winningTrades").default(0).notNull(),
  winRate: varchar({ length: 50 }),
  avgPnl: varchar({ length: 50 }),
  profitFactor: varchar({ length: 50 }),
  confidenceScore: int("confidenceScore").default(0).notNull(), // 0-100
  stopLoss: varchar({ length: 50 }), // Percentage
  takeProfit: varchar({ length: 50 }), // Percentage
  maxHold: int("maxHold"), // Max hold periods (candles or days depending on timeframe)
  performanceHistory: json("performanceHistory"), // Last N trades for alpha decay tracking
  isActive: boolean("isActive").default(true).notNull(),
  alphaDecayFlag: boolean("alphaDecayFlag").default(false).notNull(),
  lastUsed: timestamp("lastUsed"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type WinningPattern = typeof winningPatterns.$inferSelect;
export type InsertWinningPattern = typeof winningPatterns.$inferInsert;

/**
 * System configuration table
 * Stores risk parameters and system settings
 */
export const systemConfig = mysqlTable("systemConfig", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  configKey: varchar("configKey", { length: 100 }).notNull(),
  configValue: json("configValue").notNull(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type SystemConfig = typeof systemConfig.$inferSelect;
export type InsertSystemConfig = typeof systemConfig.$inferInsert;

/**
 * User bias settings table
 * Stores the operator's market bias for human-AI collaboration
 */
export const userBias = mysqlTable("userBias", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  bias: mysqlEnum("bias", ["bearish", "neutral", "bullish"]).default("neutral").notNull(),
  biasValue: varchar({ length: 50 }).notNull(), // -0.10 to +0.10
  vetoNextTrade: boolean("vetoNextTrade").default(false).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type UserBias = typeof userBias.$inferSelect;
export type InsertUserBias = typeof userBias.$inferInsert;

/**
 * Agent weight configuration
 * Allows users to customize the weighted consensus formula
 * 
 * Agent Categories:
 * - Core Fast Agents: TechnicalAnalyst, PatternMatcher, OrderFlowAnalyst (real-time signals)
 * - Core Slow Agents: SentimentAnalyst, NewsSentinel, MacroAnalyst, OnChainAnalyst (delayed signals)
 * - Phase 2 Agents: WhaleTracker, FundingRateAnalyst, LiquidationHeatmap, OnChainFlowAnalyst, VolumeProfileAnalyzer
 */
export const agentWeights = mysqlTable("agentWeights", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Core Fast agents (100% base weight) - Real-time signal generators
  technicalWeight: varchar({ length: 50 }).default("40.00").notNull(), // Default: 40%
  patternWeight: varchar({ length: 50 }).default("35.00").notNull(), // Default: 35%
  orderFlowWeight: varchar({ length: 50 }).default("25.00").notNull(), // Default: 25%
  
  // Core Slow agents (20% bonus weight) - Delayed signal generators
  sentimentWeight: varchar({ length: 50 }).default("33.33").notNull(), // Default: 33.33%
  newsWeight: varchar({ length: 50 }).default("33.33").notNull(), // Default: 33.33%
  macroWeight: varchar({ length: 50 }).default("33.34").notNull(), // Default: 33.34%
  onChainWeight: varchar({ length: 50 }).default("0.00").notNull(), // Optional bonus
  
  // Phase 2 Agents - Specialized signal generators
  whaleTrackerWeight: varchar({ length: 50 }).default("15.00").notNull(), // Whale movement signals
  fundingRateWeight: varchar({ length: 50 }).default("15.00").notNull(), // Perpetual funding rate signals
  liquidationWeight: varchar({ length: 50 }).default("15.00").notNull(), // Liquidation heatmap signals
  onChainFlowWeight: varchar({ length: 50 }).default("15.00").notNull(), // Exchange inflow/outflow signals
  volumeProfileWeight: varchar({ length: 50 }).default("20.00").notNull(), // VWAP/Volume profile signals
  
  // Agent Category Multipliers (applied to category totals)
  fastAgentMultiplier: varchar({ length: 50 }).default("1.00").notNull(), // Fast agent category weight
  slowAgentMultiplier: varchar({ length: 50 }).default("0.20").notNull(), // Slow agent category weight
  phase2AgentMultiplier: varchar({ length: 50 }).default("0.50").notNull(), // Phase 2 agent category weight
  
  // Multi-timeframe bonus
  timeframeBonus: varchar({ length: 50 }).default("10.00").notNull(), // Default: +10%
  
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type AgentWeight = typeof agentWeights.$inferSelect;
export type InsertAgentWeight = typeof agentWeights.$inferInsert;

/**
 * Threshold configuration
 * ATR-based dynamic thresholds for execution decisions
 */
export const thresholdConfig = mysqlTable("thresholdConfig", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // ATR volatility ranges
  highVolatilityAtrMin: varchar({ length: 50 }).default("5.00").notNull(), // ATR > 5%
  mediumVolatilityAtrMin: varchar({ length: 50 }).default("2.00").notNull(), // 2% < ATR <= 5%
  lowVolatilityAtrMax: varchar({ length: 50 }).default("2.00").notNull(), // ATR <= 2%
  
  // Execution thresholds by volatility
  highVolatilityThreshold: varchar({ length: 50 }).default("50.00").notNull(), // 50%
  mediumVolatilityThreshold: varchar({ length: 50 }).default("60.00").notNull(), // 60%
  lowVolatilityThreshold: varchar({ length: 50 }).default("70.00").notNull(), // 70%
  
  // Position sizing tiers (confidence → position size %)
  scoutTier: varchar({ length: 50 }).default("3.00").notNull(), // 3% (50-60% confidence)
  standardTier: varchar({ length: 50 }).default("5.00").notNull(), // 5% (60-70%)
  highTier: varchar({ length: 50 }).default("7.00").notNull(), // 7% (70-80%)
  veryHighTier: varchar({ length: 50 }).default("10.00").notNull(), // 10% (80-90%)
  extremeTier: varchar({ length: 50 }).default("15.00").notNull(), // 15% (90-100%)
  maxTier: varchar({ length: 50 }).default("20.00").notNull(), // 20% (100%+)
  
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type ThresholdConfig = typeof thresholdConfig.$inferSelect;
export type InsertThresholdConfig = typeof thresholdConfig.$inferInsert;

/**
 * External API keys (non-exchange)
 * For news, sentiment, whale tracking, etc.
 */
export const externalApiKeys = mysqlTable("externalApiKeys", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  provider: varchar("provider", { length: 50 }).notNull(), // "whale_alert", "coingecko", "newsapi", etc.
  encryptedKey: text("encryptedKey").notNull(),
  encryptionIv: varchar("encryptionIv", { length: 32 }).notNull(),
  
  isValid: boolean("isValid").default(false).notNull(),
  lastTested: timestamp("lastTested"),
  rateLimit: int("rateLimit"), // Requests per minute
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type ExternalApiKey = typeof externalApiKeys.$inferSelect;
export type InsertExternalApiKey = typeof externalApiKeys.$inferInsert;

/**
 * Exchange connection settings
 * Advanced configuration for exchange adapters
 */
export const exchangeSettings = mysqlTable("exchangeSettings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  exchangeId: int("exchangeId").notNull(),
  
  useTestnet: boolean("useTestnet").default(false).notNull(),
  maxOrdersPerMinute: int("maxOrdersPerMinute").default(10).notNull(),
  maxPositionSize: varchar({ length: 50 }).default("20.00").notNull(), // % of capital
  maxTotalExposure: varchar({ length: 50 }).default("50.00").notNull(), // % of capital
  
  enableStopLoss: boolean("enableStopLoss").default(true).notNull(),
  enableTakeProfit: boolean("enableTakeProfit").default(true).notNull(),
  enablePartialExits: boolean("enablePartialExits").default(true).notNull(),
  
  defaultLeverage: int("defaultLeverage").default(1).notNull(), // 1x = no leverage
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type ExchangeSetting = typeof exchangeSettings.$inferSelect;
export type InsertExchangeSetting = typeof exchangeSettings.$inferInsert;

/**
 * Trading symbols configuration
 * Tracks which symbols are active for trading
 */
export const tradingSymbols = mysqlTable("tradingSymbols", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(), // e.g., "BTCUSDT", "ETHUSDT"
  exchangeName: mysqlEnum("exchangeName", ["binance", "coinbase"]).notNull().default("coinbase"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type TradingSymbol = typeof tradingSymbols.$inferSelect;
export type InsertTradingSymbol = typeof tradingSymbols.$inferInsert;


/**
 * Historical Candles (OHLCV) Table
 * Stores 2+ years of historical price data for fast agent analysis
 * Eliminates API dependency and enables instant backtesting
 */
export const historicalCandles = mysqlTable("historicalCandles", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(), // e.g., "BTCUSDT"
  interval: varchar("interval", { length: 10 }).notNull(), // e.g., "1m", "5m", "1h", "4h", "1d"
  timestamp: timestamp("timestamp").notNull(), // Candle open time
  
  // OHLCV data
  open: varchar({ length: 50 }).notNull(),
  high: varchar({ length: 50 }).notNull(),
  low: varchar({ length: 50 }).notNull(),
  close: varchar({ length: 50 }).notNull(),
  volume: varchar({ length: 50 }).notNull(),
  
  // Metadata
  source: varchar("source", { length: 50 }).default("binance").notNull(), // Data source
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type HistoricalCandle = typeof historicalCandles.$inferSelect;
export type InsertHistoricalCandle = typeof historicalCandles.$inferInsert;

/**
 * Paper Trading Wallets
 * Tracks virtual USD balance and performance metrics for paper trading
 */
export const paperWallets = mysqlTable("paperWallets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tradingMode: mysqlEnum("tradingMode", ["paper", "live"]).default("paper").notNull(),
  balance: varchar({ length: 50 }).default("10000.00").notNull(), // Available virtual USD
  equity: varchar({ length: 50 }).default("10000.00").notNull(), // Balance + unrealized P&L
  margin: varchar({ length: 50 }).default("0.00").notNull(), // Used margin
  marginLevel: varchar({ length: 50 }).default("0.00").notNull(), // Equity / Margin %
  totalPnL: varchar({ length: 50 }).default("0.00").notNull(), // Realized + unrealized
  realizedPnL: varchar({ length: 50 }).default("0.00").notNull(),
  unrealizedPnL: varchar({ length: 50 }).default("0.00").notNull(),
  totalCommission: varchar({ length: 50 }).default("0.00").notNull(),
  totalTrades: int("totalTrades").default(0).notNull(),
  winningTrades: int("winningTrades").default(0).notNull(),
  losingTrades: int("losingTrades").default(0).notNull(),
  winRate: varchar({ length: 50 }).default("0.00").notNull(), // 0-100%
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()}, (table) => ({
  idx_paperWallets_userId_mode: uniqueIndex("idx_paperWallets_userId_mode").on(table.userId, table.tradingMode),
}));

export type PaperWallet = typeof paperWallets.$inferSelect;
export type InsertPaperWallet = typeof paperWallets.$inferInsert;

/**
 * Paper Trading Positions
 * Tracks open positions in paper trading mode
 */
export const paperPositions = mysqlTable("paperPositions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tradingMode: mysqlEnum("tradingMode", ["paper", "live"]).default("paper").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  exchange: mysqlEnum("exchange", ["binance", "coinbase"]).notNull(),
  side: mysqlEnum("side", ["long", "short"]).notNull(),
  entryPrice: varchar({ length: 50 }).notNull(),
  currentPrice: varchar({ length: 50 }).notNull(),
  quantity: varchar({ length: 50 }).notNull(),
  stopLoss: varchar({ length: 50 }),
  takeProfit: varchar({ length: 50 }),
  partialExits: json("partialExits"), // Track 25%, 50%, 75% exits with prices and timestamps
  entryTime: timestamp("entryTime").notNull(),
  unrealizedPnL: varchar({ length: 50 }).default("0.00").notNull(),
  unrealizedPnLPercent: varchar({ length: 50 }).default("0.00").notNull(),
  commission: varchar({ length: 50 }).default("0.00").notNull(),
  strategy: varchar("strategy", { length: 50 }).notNull(), // e.g., "scalping", "swing_trading"
  strategyId: int("strategyId"), // Reference to strategyInstances table (nullable for backward compatibility)
  status: mysqlEnum("status", ["open", "closed"]).default("open").notNull(),
  exitReason: varchar("exitReason", { length: 100 }),
  exitPrice: varchar("exitPrice", { length: 50 }), // Actual price at time of exit
  exitTime: timestamp("exitTime"),
  realizedPnl: varchar({ length: 50 }),
  // Consensus tracking for exit decisions
  originalConsensus: varchar({ length: 50 }), // Consensus at entry (e.g., "0.95")
  currentConfidence: varchar({ length: 50 }), // Current consensus confidence
  peakConfidence: varchar({ length: 50 }), // Highest consensus reached during trade
  peakConfidenceTime: timestamp("peakConfidenceTime"), // When peak was reached
  // Phase 5: Trade quality and cost tracking
  tradeQualityScore: varchar("tradeQualityScore", { length: 2 }), // A-F grade
  pnlAfterCosts: varchar({ length: 50 }),
  totalCosts: varchar({ length: 50 }),
  costBreakdown: json("costBreakdown"), // { commission, slippage }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()}, (table) => ({
  idx_paperPositions_userId_status: index("idx_paperPositions_userId_status").on(table.userId, table.status),
  idx_paperPositions_symbol: index("idx_paperPositions_symbol").on(table.symbol),
}));

export type PaperPosition = typeof paperPositions.$inferSelect;
export type InsertPaperPosition = typeof paperPositions.$inferInsert;

/**
 * Paper Trading Orders
 * Complete history of all paper trading orders
 */
export const paperOrders = mysqlTable("paperOrders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tradingMode: mysqlEnum("tradingMode", ["paper", "live"]).default("paper").notNull(),
  orderId: varchar("orderId", { length: 100 }).notNull().unique(), // paper_timestamp_random
  symbol: varchar("symbol", { length: 20 }).notNull(),
  exchange: mysqlEnum("exchange", ["binance", "coinbase"]).notNull(),
  type: mysqlEnum("type", ["market", "limit", "stop_loss", "take_profit"]).notNull(),
  side: mysqlEnum("side", ["buy", "sell"]).notNull(),
  quantity: varchar({ length: 50 }).notNull(),
  price: varchar({ length: 50 }), // For limit orders
  stopPrice: varchar({ length: 50 }), // For stop orders
  status: mysqlEnum("status", ["pending", "filled", "cancelled", "rejected"]).notNull(),
  filledPrice: varchar({ length: 50 }),
  filledQuantity: varchar({ length: 50 }),
  commission: varchar({ length: 50 }),
  slippage: varchar({ length: 50 }), // Percentage
  latency: int("latency"), // Milliseconds
  strategy: varchar("strategy", { length: 50 }).notNull(),
  strategyId: int("strategyId"), // Reference to strategyInstances table (nullable for backward compatibility)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  filledAt: timestamp("filledAt")}, (table) => ({
  idx_paperOrders_userId_status: index("idx_paperOrders_userId_status").on(table.userId, table.status),
  idx_paperOrders_symbol: index("idx_paperOrders_symbol").on(table.symbol),
}));

export type PaperOrder = typeof paperOrders.$inferSelect;
export type InsertPaperOrder = typeof paperOrders.$inferInsert;

/**
 * Paper Trading Trades
 * Completed trades with P&L for paper trading
 */
export const paperTrades = mysqlTable("paperTrades", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tradingMode: mysqlEnum("tradingMode", ["paper", "live"]).default("paper").notNull(),
  orderId: varchar("orderId", { length: 100 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: mysqlEnum("side", ["buy", "sell"]).notNull(),
  price: varchar({ length: 50 }).notNull(),
  quantity: varchar({ length: 50 }).notNull(),
  pnl: varchar({ length: 50 }).notNull(),
  commission: varchar({ length: 50 }).notNull(),
  strategy: varchar("strategy", { length: 50 }).notNull(),
  strategyId: int("strategyId"), // Reference to strategyInstances table (nullable for backward compatibility)
  timestamp: timestamp("timestamp").defaultNow().notNull()}, (table) => ({
  idx_paperTrades_userId: index("idx_paperTrades_userId").on(table.userId),
  idx_paperTrades_symbol: index("idx_paperTrades_symbol").on(table.symbol),
  idx_paperTrades_timestamp: index("idx_paperTrades_timestamp").on(table.timestamp),
}));

export type PaperTrade = typeof paperTrades.$inferSelect;
export type InsertPaperTrade = typeof paperTrades.$inferInsert;

/**
 * Paper Trading Transactions
 * Complete audit trail of all balance changes for paper trading
 * CRITICAL: Never delete records - required for financial audit compliance
 */
export const paperTransactions = mysqlTable("paperTransactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tradingMode: mysqlEnum("tradingMode", ["paper", "live"]).default("paper").notNull(),
  type: mysqlEnum("type", [
    "DEPOSIT",
    "WITHDRAWAL",
    "TRADE_PROFIT",
    "TRADE_LOSS",
    "COMMISSION",
    "WALLET_RESET",
    "ADJUSTMENT",
    "POSITION_OPEN",
    "POSITION_CLOSE"
  ]).notNull(),
  amount: varchar({ length: 50 }).notNull(),
  balanceBefore: varchar({ length: 50 }).notNull(),
  balanceAfter: varchar({ length: 50 }).notNull(),
  relatedOrderId: varchar("relatedOrderId", { length: 100 }),
  relatedPositionId: int("relatedPositionId"),
  description: text("description"),
  metadata: json("metadata"), // Additional context (symbol, quantity, price, etc.)
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type PaperTransaction = typeof paperTransactions.$inferSelect;
export type InsertPaperTransaction = typeof paperTransactions.$inferInsert;

/**
 * Trading Mode Configuration
 * Tracks whether user is in paper or real trading mode
 */
export const tradingModeConfig = mysqlTable("tradingModeConfig", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  mode: mysqlEnum("mode", ["paper", "real"]).default("paper").notNull(),
  enableSlippage: boolean("enableSlippage").default(true).notNull(),
  enableCommission: boolean("enableCommission").default(true).notNull(),
  enableMarketImpact: boolean("enableMarketImpact").default(true).notNull(),
  enableLatency: boolean("enableLatency").default(true).notNull(),
  autoTradeEnabled: boolean("autoTradeEnabled").default(false).notNull(),
  portfolioFunds: decimal("portfolioFunds", { precision: 18, scale: 2 }).default("10000.00").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type TradingModeConfig = typeof tradingModeConfig.$inferSelect;
export type InsertTradingModeConfig = typeof tradingModeConfig.$inferInsert;

/**
 * Agent Accuracy Tracking
 * Persists historical accuracy for each agent across server restarts
 */
export const agentAccuracy = mysqlTable("agentAccuracy", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  agentName: varchar("agentName", { length: 50 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  accuracy: varchar({ length: 50 }).notNull(), // 0.0000 to 1.0000
  totalTrades: int("totalTrades").default(0).notNull(),
  correctTrades: int("correctTrades").default(0).notNull(),
  lastUpdated: timestamp("lastUpdated").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()}, (table) => ({
  idx_agentAccuracy_userId_agentName: index("idx_agentAccuracy_userId_agentName").on(table.userId, table.agentName),
  idx_agentAccuracy_symbol: index("idx_agentAccuracy_symbol").on(table.symbol),
}));

export type AgentAccuracy = typeof agentAccuracy.$inferSelect;
export type InsertAgentAccuracy = typeof agentAccuracy.$inferInsert;

/**
 * Portfolio Rebalancing History
 * Tracks all portfolio rebalancing events with Kelly Criterion allocation
 */
export const rebalancingHistory = mysqlTable("rebalancingHistory", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().default(1), // Default to owner for now
  timestamp: timestamp("timestamp").notNull(),
  trigger: mysqlEnum("trigger", ["time", "confidence", "deviation", "manual"]).notNull(),
  symbolsRebalanced: int("symbolsRebalanced").notNull(),
  totalCapitalAllocated: varchar({ length: 50 }).notNull(),
  changes: json("changes").notNull(), // Array of { symbol, action, oldSizeUSD, newSizeUSD, reason }
  portfolioMetrics: json("portfolioMetrics").notNull(), // { totalValue, allocatedCapital, availableCash, numberOfPositions }
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type RebalancingHistory = typeof rebalancingHistory.$inferSelect;
export type InsertRebalancingHistory = typeof rebalancingHistory.$inferInsert;

/**
 * Portfolio Risk Metrics
 * Tracks portfolio-level risk metrics over time
 */
export const portfolioRiskMetrics = mysqlTable("portfolioRiskMetrics", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().default(1),
  timestamp: timestamp("timestamp").notNull(),
  
  // Performance metrics
  totalValue: varchar({ length: 50 }).notNull(),
  dailyReturn: varchar({ length: 50 }), // Percentage as decimal
  cumulativeReturn: varchar({ length: 50 }),
  
  // Risk metrics
  sharpeRatio: varchar({ length: 50 }),
  sortinoRatio: varchar({ length: 50 }),
  maxDrawdown: varchar({ length: 50 }),
  volatility: varchar({ length: 50 }),
  
  // Position metrics
  numberOfPositions: int("numberOfPositions").notNull(),
  allocatedCapital: varchar({ length: 50 }).notNull(),
  availableCash: varchar({ length: 50 }).notNull(),
  
  // Correlation metrics (JSON object with symbol pairs)
  correlationMatrix: json("correlationMatrix"), // { "BTC-ETH": 0.85, "BTC-SPX": 0.42, ... }
  
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type PortfolioRiskMetric = typeof portfolioRiskMetrics.$inferSelect;
export type InsertPortfolioRiskMetric = typeof portfolioRiskMetrics.$inferInsert;

/**
 * Notifications table
 * Stores persistent notifications for users
 */
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["trade", "risk", "agent", "system", "performance"]).notNull(),
  severity: mysqlEnum("severity", ["info", "warning", "error", "critical"]).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  message: text("message").notNull(),
  data: json("data"), // Additional context data
  isRead: boolean("isRead").default(false).notNull(),
  isArchived: boolean("isArchived").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()}, (table) => ({
  idx_notifications_userId_isRead: index("idx_notifications_userId_isRead").on(table.userId, table.isRead),
  idx_notifications_createdAt: index("idx_notifications_createdAt").on(table.createdAt),
}));

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/**
 * Risk Limit Breaches table
 * Tracks all risk limit violations for compliance and analysis
 */
export const riskLimitBreaches = mysqlTable("riskLimitBreaches", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  limitType: mysqlEnum("limitType", [
    "position_size",
    "daily_loss",
    "max_drawdown",
    "symbol_exposure",
    "portfolio_exposure",
    "risk_per_trade"
  ]).notNull(),
  limitValue: varchar({ length: 50 }).notNull(),
  actualValue: varchar({ length: 50 }).notNull(),
  symbol: varchar("symbol", { length: 20 }),
  action: mysqlEnum("action", ["blocked", "warning", "shutdown"]).notNull(),
  resolved: boolean("resolved").default(false).notNull(),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type RiskLimitBreach = typeof riskLimitBreaches.$inferSelect;
export type InsertRiskLimitBreach = typeof riskLimitBreaches.$inferInsert;

/**
 * Trade Execution Log table
 * Detailed audit trail for all trade execution attempts
 */
export const tradeExecutionLog = mysqlTable("tradeExecutionLog", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tradeId: int("tradeId"), // Reference to trades table if successful
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: mysqlEnum("side", ["long", "short"]).notNull(),
  orderType: mysqlEnum("orderType", ["market", "limit", "stop", "twap", "vwap", "iceberg"]).notNull(),
  quantity: varchar({ length: 50 }).notNull(),
  price: varchar({ length: 50 }),
  status: mysqlEnum("status", ["pending", "submitted", "filled", "partial", "rejected", "cancelled"]).notNull(),
  exchange: varchar("exchange", { length: 50 }).notNull(),
  orderId: varchar("orderId", { length: 100 }), // Exchange order ID
  fillPrice: varchar({ length: 50 }),
  fillQuantity: varchar({ length: 50 }),
  rejectionReason: text("rejectionReason"),
  executionTimeMs: int("executionTimeMs"), // Time from submission to fill
  slippage: varchar({ length: 50 }), // Percentage
  fees: varchar({ length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type TradeExecutionLog = typeof tradeExecutionLog.$inferSelect;
export type InsertTradeExecutionLog = typeof tradeExecutionLog.$inferInsert;

/**
 * Agent Performance Metrics table
 * Tracks detailed performance metrics for each agent
 */
export const agentPerformanceMetrics = mysqlTable("agentPerformanceMetrics", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  agentName: varchar("agentName", { length: 50 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(), // "1h", "4h", "1d", etc.
  
  // Accuracy metrics
  totalSignals: int("totalSignals").default(0).notNull(),
  correctSignals: int("correctSignals").default(0).notNull(),
  accuracy: varchar({ length: 50 }), // 0.0000 to 1.0000
  
  // Performance metrics
  avgConfidence: varchar({ length: 50 }),
  sharpeRatio: varchar({ length: 50 }),
  profitFactor: varchar({ length: 50 }),
  
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  deactivatedReason: text("deactivatedReason"),
  deactivatedAt: timestamp("deactivatedAt"),
  
  // Timestamps
  lastSignalAt: timestamp("lastSignalAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type AgentPerformanceMetric = typeof agentPerformanceMetrics.$inferSelect;
export type InsertAgentPerformanceMetric = typeof agentPerformanceMetrics.$inferInsert;

/**
 * Reconciliation Logs table
 * Tracks all position reconciliation runs with summary statistics
 */
export const reconciliationLogs = mysqlTable("reconciliationLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  status: mysqlEnum("status", ["running", "completed", "failed"]).notNull(),
  triggerType: mysqlEnum("triggerType", ["scheduled", "manual", "on_demand"]).notNull(),
  
  // Summary statistics
  totalPositionsChecked: int("totalPositionsChecked").default(0).notNull(),
  discrepanciesFound: int("discrepanciesFound").default(0).notNull(),
  autoResolved: int("autoResolved").default(0).notNull(),
  manualReviewRequired: int("manualReviewRequired").default(0).notNull(),
  
  // Execution metrics
  executionTimeMs: int("executionTimeMs"),
  errorMessage: text("errorMessage"),
  
  startedAt: timestamp("startedAt").notNull(),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type ReconciliationLog = typeof reconciliationLogs.$inferSelect;
export type InsertReconciliationLog = typeof reconciliationLogs.$inferInsert;

/**
 * Position Discrepancies table
 * Detailed record of each position discrepancy found during reconciliation
 */
export const positionDiscrepancies = mysqlTable("positionDiscrepancies", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  reconciliationLogId: int("reconciliationLogId").notNull(),
  
  // Position identification
  positionId: int("positionId"), // Local position ID (may be null if position missing locally)
  metaapiPositionId: varchar("metaapiPositionId", { length: 100 }), // MetaAPI position ID
  symbol: varchar("symbol", { length: 20 }).notNull(),
  
  // Discrepancy details
  discrepancyType: mysqlEnum("discrepancyType", [
    "quantity_mismatch",
    "price_mismatch",
    "status_mismatch",
    "missing_local",
    "missing_metaapi",
    "pnl_mismatch",
    "timestamp_drift"
  ]).notNull(),
  severity: mysqlEnum("severity", ["critical", "warning", "info"]).notNull(),
  
  // Field-specific discrepancy data
  field: varchar("field", { length: 50 }).notNull(), // e.g., "quantity", "entryPrice", "status"
  localValue: text("localValue"), // JSON string of local value
  metaapiValue: text("metaapiValue"), // JSON string of MetaAPI value
  difference: text("difference"), // Calculated difference (for numeric fields)
  
  // Resolution tracking
  resolved: boolean("resolved").default(false).notNull(),
  resolutionMethod: mysqlEnum("resolutionMethod", [
    "auto_sync_local",
    "auto_sync_metaapi",
    "manual_override",
    "ignored"
  ]),
  resolutionNotes: text("resolutionNotes"),
  resolvedBy: int("resolvedBy"), // User ID who resolved (for manual resolutions)
  resolvedAt: timestamp("resolvedAt"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type PositionDiscrepancy = typeof positionDiscrepancies.$inferSelect;
export type InsertPositionDiscrepancy = typeof positionDiscrepancies.$inferInsert;

/**
 * Reconciliation History table
 * Audit trail of all reconciliation actions taken
 */
export const reconciliationHistory = mysqlTable("reconciliationHistory", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  discrepancyId: int("discrepancyId").notNull(),
  
  // Action details
  action: mysqlEnum("action", [
    "detected",
    "auto_resolved",
    "manual_resolved",
    "ignored",
    "escalated"
  ]).notNull(),
  
  // Before/after snapshots
  beforeState: json("beforeState").notNull(), // Full position state before action
  afterState: json("afterState"), // Full position state after action (null if just detected)
  
  // Metadata
  performedBy: mysqlEnum("performedBy", ["system", "user"]).notNull(),
  userId_performer: int("userId_performer"), // User ID if performed by user
  notes: text("notes"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type ReconciliationHistory = typeof reconciliationHistory.$inferSelect;
export type InsertReconciliationHistory = typeof reconciliationHistory.$inferInsert;



/**
 * Service health status table
 * Tracks health and availability of all platform services
 */
export const serviceHealth = mysqlTable("serviceHealth", {
  id: int("id").autoincrement().primaryKey(),
  serviceName: varchar("serviceName", { length: 100 }).notNull().unique(),
  status: mysqlEnum("status", ["healthy", "degraded", "down", "unknown"]).default("unknown").notNull(),
  lastCheckAt: timestamp("lastCheckAt").notNull(),
  lastHealthyAt: timestamp("lastHealthyAt"),
  consecutiveFailures: int("consecutiveFailures").default(0).notNull(),
  errorMessage: text("errorMessage"),
  metadata: json("metadata"), // Service-specific health data
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type ServiceHealth = typeof serviceHealth.$inferSelect;
export type InsertServiceHealth = typeof serviceHealth.$inferInsert;

/**
 * Service health history table
 * Historical log of service health checks for trend analysis
 */
export const serviceHealthHistory = mysqlTable("serviceHealthHistory", {
  id: int("id").autoincrement().primaryKey(),
  serviceName: varchar("serviceName", { length: 100 }).notNull(),
  status: mysqlEnum("status", ["healthy", "degraded", "down", "unknown"]).notNull(),
  responseTime: int("responseTime"), // Milliseconds
  errorMessage: text("errorMessage"),
  metadata: json("metadata"),
  timestamp: timestamp("timestamp").notNull().defaultNow()});

export type ServiceHealthHistory = typeof serviceHealthHistory.$inferSelect;
export type InsertServiceHealthHistory = typeof serviceHealthHistory.$inferInsert;

/**
 * System startup log table
 * Records each system startup attempt and health check results
 */
export const systemStartupLog = mysqlTable("systemStartupLog", {
  id: int("id").autoincrement().primaryKey(),
  startupId: varchar("startupId", { length: 64 }).notNull().unique(), // UUID for this startup attempt
  status: mysqlEnum("status", ["in_progress", "success", "failed", "partial"]).notNull(),
  startedAt: timestamp("startedAt").notNull(),
  completedAt: timestamp("completedAt"),
  totalChecks: int("totalChecks").notNull(),
  passedChecks: int("passedChecks").notNull(),
  failedChecks: int("failedChecks").notNull(),
  healthCheckResults: json("healthCheckResults").notNull(), // Detailed results for each service
  errorSummary: text("errorSummary"),
  canTrade: boolean("canTrade").default(false).notNull(), // Whether trading is allowed after this startup
});

export type SystemStartupLog = typeof systemStartupLog.$inferSelect;
export type InsertSystemStartupLog = typeof systemStartupLog.$inferInsert;


/**
 * ============================================================================
 * INSTITUTIONAL-GRADE RISK MANAGEMENT SYSTEM
 * ============================================================================
 * Implements Kelly Criterion, VaR, drawdown monitoring, and capital allocation
 * Based on HFT and hedge fund best practices
 */

/**
 * Trading Strategies Table
 * Defines trading strategies with Kelly Criterion parameters and performance tracking
 */
export const strategies = mysqlTable("strategies", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 100 }).notNull(), // e.g., "BTC Momentum", "ETH Mean Reversion"
  type: mysqlEnum("type", ["momentum", "mean_reversion", "breakout", "scalping", "swing", "arbitrage"]).notNull(),
  status: mysqlEnum("status", ["active", "suspended", "archived"]).default("active").notNull(),
  
  // Kelly Criterion Parameters
  meanExcessReturn: varchar({ length: 50 }), // μ (mean return - risk-free rate)
  stdDeviation: varchar({ length: 50 }), // σ (standard deviation of returns)
  kellyFraction: varchar({ length: 50 }), // f = μ / σ²
  kellyMultiplier: varchar({ length: 50 }).default("0.5000").notNull(), // Conservative multiplier (0.5 = Half-Kelly)
  
  // Performance Metrics
  sharpeRatio: varchar({ length: 50 }), // Rolling 90-day Sharpe
  sortinoRatio: varchar({ length: 50 }), // Downside deviation focus
  calmarRatio: varchar({ length: 50 }), // Return / max drawdown
  winRate: varchar({ length: 50 }), // 0-100%
  profitFactor: varchar({ length: 50 }), // Gross profit / gross loss
  avgWin: varchar({ length: 50 }),
  avgLoss: varchar({ length: 50 }),
  maxDrawdown: varchar({ length: 50 }), // Percentage
  
  // Capital Allocation
  allocatedCapital: varchar({ length: 50 }).default("0.00").notNull(),
  targetAllocation: varchar({ length: 50 }), // Percentage of total capital
  minAllocation: varchar({ length: 50 }), // Minimum capital required
  maxAllocation: varchar({ length: 50 }), // Maximum capital allowed
  
  // Risk Parameters
  maxPositionSize: varchar({ length: 50 }).default("20.00").notNull(), // % of allocated capital
  maxCorrelation: varchar({ length: 50 }).default("0.6000").notNull(), // Max correlation with portfolio
  stopLossPercent: varchar({ length: 50 }).default("5.00").notNull(),
  takeProfitPercent: varchar({ length: 50 }).default("10.00").notNull(),
  
  // Rebalancing
  lastRebalance: timestamp("lastRebalance"),
  rebalanceFrequency: mysqlEnum("rebalanceFrequency", ["daily", "weekly", "monthly"]).default("daily").notNull(),
  
  // Metadata
  description: text("description"),
  config: json("config"), // Strategy-specific configuration
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type Strategy = typeof strategies.$inferSelect;
export type InsertStrategy = typeof strategies.$inferInsert;

/**
 * Risk Metrics Table
 * Time-series of portfolio and position-level risk measurements
 */
export const riskMetrics = mysqlTable("riskMetrics", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  
  // Portfolio-Level Metrics
  portfolioValue: varchar({ length: 50 }).notNull(),
  portfolioVaR95: varchar({ length: 50 }), // 95% confidence VaR
  portfolioVaR99: varchar({ length: 50 }), // 99% confidence VaR
  historicalVaR: varchar({ length: 50 }), // Historical simulation VaR
  parametricVaR: varchar({ length: 50 }), // Parametric (normal distribution) VaR
  monteCarloVaR: varchar({ length: 50 }), // Monte Carlo simulation VaR
  
  // Drawdown Metrics
  currentDrawdown: varchar({ length: 50 }), // Current % from peak
  maxDrawdown: varchar({ length: 50 }), // Maximum % drawdown in period
  peakEquity: varchar({ length: 50 }), // Peak equity value
  drawdownDuration: int("drawdownDuration"), // Days in current drawdown
  
  // Risk-Adjusted Performance
  sharpeRatio30d: varchar({ length: 50 }),
  sharpeRatio60d: varchar({ length: 50 }),
  sharpeRatio90d: varchar({ length: 50 }),
  sortinoRatio: varchar({ length: 50 }),
  calmarRatio: varchar({ length: 50 }),
  
  // Volatility Metrics
  realizedVolatility: varchar({ length: 50 }), // Actual portfolio volatility
  impliedVolatility: varchar({ length: 50 }), // Market-implied volatility
  volatilityPercentile: int("volatilityPercentile"), // 0-100 percentile vs historical
  
  // Leverage and Margin
  currentLeverage: varchar({ length: 50 }), // Portfolio size / equity
  marginUtilization: varchar({ length: 50 }), // % of available margin used
  
  // Correlation
  avgPositionCorrelation: varchar({ length: 50 }), // Average pairwise correlation
  portfolioDiversification: varchar({ length: 50 }), // 1 - avg correlation
  
  // Circuit Breaker Status
  circuitBreakerLevel: mysqlEnum("circuitBreakerLevel", ["green", "yellow", "orange", "red", "emergency"]).default("green").notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type RiskMetric = typeof riskMetrics.$inferSelect;
export type InsertRiskMetric = typeof riskMetrics.$inferInsert;

/**
 * Capital Allocations Table
 * Historical record of capital allocation decisions across four tiers
 */
export const capitalAllocations = mysqlTable("capitalAllocations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  
  // Total Capital
  totalCapital: varchar({ length: 50 }).notNull(),
  
  // Four-Tier Allocation
  activeTradingCapital: varchar({ length: 50 }).notNull(), // 60-70%
  maintenanceMarginBuffer: varchar({ length: 50 }).notNull(), // 15-20%
  drawdownProtectionReserve: varchar({ length: 50 }).notNull(), // 10-15%
  opportunityCapital: varchar({ length: 50 }).notNull(), // 5-10%
  
  // Allocation Percentages
  activeTradingPercent: varchar({ length: 50 }).notNull(),
  marginBufferPercent: varchar({ length: 50 }).notNull(),
  drawdownReservePercent: varchar({ length: 50 }).notNull(),
  opportunityPercent: varchar({ length: 50 }).notNull(),
  
  // Strategy-Level Allocations
  strategyAllocations: json("strategyAllocations"), // { strategyId: amount }
  
  // Reallocation Trigger
  trigger: mysqlEnum("trigger", ["scheduled", "performance", "drawdown", "volatility", "manual"]).notNull(),
  reason: text("reason"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type CapitalAllocation = typeof capitalAllocations.$inferSelect;
export type InsertCapitalAllocation = typeof capitalAllocations.$inferInsert;

/**
 * Risk Events Table
 * Log of risk alerts, circuit breaker activations, and emergency actions
 */
export const riskEvents = mysqlTable("riskEvents", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  
  // Event Classification
  eventType: mysqlEnum("eventType", [
    "drawdown_alert",
    "var_breach",
    "margin_warning",
    "circuit_breaker_yellow",
    "circuit_breaker_orange",
    "circuit_breaker_red",
    "circuit_breaker_emergency",
    "position_size_violation",
    "correlation_spike",
    "volatility_spike",
    "reserve_deployment",
    "forced_liquidation"
  ]).notNull(),
  
  severity: mysqlEnum("severity", ["info", "warning", "critical", "emergency"]).notNull(),
  
  // Event Details
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  
  // Metrics at Event Time
  portfolioValue: varchar({ length: 50 }),
  drawdownPercent: varchar({ length: 50 }),
  varBreach: varchar({ length: 50 }), // Amount VaR was exceeded by
  marginUtilization: varchar({ length: 50 }),
  
  // Actions Taken
  actionTaken: text("actionTaken"),
  positionsAffected: json("positionsAffected"), // Array of position IDs
  capitalAdjustment: varchar({ length: 50 }),
  
  // Resolution
  resolved: boolean("resolved").default(false).notNull(),
  resolvedAt: timestamp("resolvedAt"),
  resolutionNotes: text("resolutionNotes"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type RiskEvent = typeof riskEvents.$inferSelect;
export type InsertRiskEvent = typeof riskEvents.$inferInsert;

/**
 * Portfolio Snapshots Table
 * Daily equity curves and portfolio composition for historical analysis
 */
export const portfolioSnapshots = mysqlTable("portfolioSnapshots", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  snapshotDate: timestamp("snapshotDate").notNull(),
  
  // Equity Metrics
  totalEquity: varchar({ length: 50 }).notNull(),
  cash: varchar({ length: 50 }).notNull(),
  positionsValue: varchar({ length: 50 }).notNull(),
  unrealizedPnL: varchar({ length: 50 }).notNull(),
  realizedPnL: varchar({ length: 50 }).notNull(),
  
  // Daily Performance
  dailyReturn: varchar({ length: 50 }), // Percentage as decimal
  dailyPnL: varchar({ length: 50 }),
  
  // Position Composition
  numberOfPositions: int("numberOfPositions").notNull(),
  positionDetails: json("positionDetails"), // Array of { symbol, value, weight, pnl }
  
  // Risk Snapshot
  portfolioVaR95: varchar({ length: 50 }),
  currentDrawdown: varchar({ length: 50 }),
  sharpeRatio: varchar({ length: 50 }),
  
  // Capital Allocation Snapshot
  activeTradingCapital: varchar({ length: 50 }),
  reserveCapital: varchar({ length: 50 }),
  
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type PortfolioSnapshot = typeof portfolioSnapshots.$inferSelect;
export type InsertPortfolioSnapshot = typeof portfolioSnapshots.$inferInsert;

/**
 * Position Risk Metrics Table
 * Risk metrics specific to individual positions
 */
export const positionRiskMetrics = mysqlTable("positionRiskMetrics", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  positionId: int("positionId").notNull(), // References paperPositions.id
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  
  // Position VaR
  positionVaR95: varchar({ length: 50 }), // Position-specific VaR
  varContribution: varchar({ length: 50 }), // Contribution to portfolio VaR
  
  // Correlation
  correlationWithPortfolio: varchar({ length: 50 }),
  correlationWithOthers: json("correlationWithOthers"), // { positionId: correlation }
  
  // Position Sizing
  kellyOptimalSize: varchar({ length: 50 }), // Optimal size per Kelly
  currentSize: varchar({ length: 50 }), // Actual position size
  sizeDeviation: varchar({ length: 50 }), // % deviation from optimal
  
  // Risk Metrics
  stopLossDistance: varchar({ length: 50 }), // % from current price
  takeProfitDistance: varchar({ length: 50 }), // % from current price
  riskRewardRatio: varchar({ length: 50 }), // Take profit / stop loss
  
  // Time Metrics
  holdingPeriod: int("holdingPeriod"), // Minutes since entry
  expectedHoldingPeriod: int("expectedHoldingPeriod"), // Expected minutes
  
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type PositionRiskMetric = typeof positionRiskMetrics.$inferSelect;
export type InsertPositionRiskMetric = typeof positionRiskMetrics.$inferInsert;

/**
 * Trading Strategies Table
 * Tracks different trading strategies with their performance and risk metrics
 */
export const tradingStrategies = mysqlTable("tradingStrategies", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Strategy Identity
  strategyName: varchar("strategyName", { length: 100 }).notNull(),
  strategyType: mysqlEnum("strategyType", [
    "scalping",
    "day_trading", 
    "swing_trading",
    "momentum",
    "mean_reversion",
    "breakout",
    "trend_following",
    "custom"
  ]).notNull(),
  description: text("description"),
  
  // Capital Allocation
  allocatedCapital: varchar({ length: 50 }).notNull(),
  availableCapital: varchar({ length: 50 }).notNull(),
  maxCapital: varchar({ length: 50 }).notNull(), // Maximum allowed allocation
  
  // Risk Limits
  maxPositions: int("maxPositions").default(5).notNull(),
  maxDrawdown: varchar({ length: 50 }).default("15.00").notNull(), // Percentage
  maxDailyLoss: varchar({ length: 50 }).notNull(),
  maxPositionSize: varchar({ length: 50 }).default("20.00").notNull(), // Percentage
  
  // Performance Metrics
  totalPnL: varchar({ length: 50 }).default("0.00").notNull(),
  realizedPnL: varchar({ length: 50 }).default("0.00").notNull(),
  unrealizedPnL: varchar({ length: 50 }).default("0.00").notNull(),
  
  // Risk Metrics
  currentDrawdown: varchar({ length: 50 }).default("0.00").notNull(),
  maxDrawdownReached: varchar({ length: 50 }).default("0.00").notNull(),
  sharpeRatio: varchar({ length: 50 }),
  sortinoRatio: varchar({ length: 50 }),
  
  // Trade Statistics
  totalTrades: int("totalTrades").default(0).notNull(),
  winningTrades: int("winningTrades").default(0).notNull(),
  losingTrades: int("losingTrades").default(0).notNull(),
  winRate: varchar({ length: 50 }).default("0.00").notNull(), // Percentage
  avgWin: varchar({ length: 50 }),
  avgLoss: varchar({ length: 50 }),
  profitFactor: varchar({ length: 50 }),
  
  // Performance Score (0-100)
  performanceScore: varchar({ length: 50 }).default("50.00").notNull(),
  
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  isPaused: boolean("isPaused").default(false).notNull(),
  pauseReason: text("pauseReason"),
  
  // Timestamps
  lastTradeAt: timestamp("lastTradeAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type TradingStrategy = typeof tradingStrategies.$inferSelect;
export type InsertTradingStrategy = typeof tradingStrategies.$inferInsert;

/**
 * Pre-Trade Validation Logs Table
 * Records all pre-trade risk checks and rejections
 */
export const preTradeValidations = mysqlTable("preTradeValidations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  strategyId: int("strategyId"), // Optional: links to trading strategy
  
  // Trade Details
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: mysqlEnum("side", ["long", "short"]).notNull(),
  requestedQuantity: varchar({ length: 50 }).notNull(),
  requestedValue: varchar({ length: 50 }).notNull(),
  currentPrice: varchar({ length: 50 }).notNull(),
  
  // Validation Results
  passed: boolean("passed").notNull(),
  overallRiskScore: varchar({ length: 50 }), // 0-100
  
  // Kelly Criterion Check
  kellyOptimalSize: varchar({ length: 50 }),
  kellyDeviation: varchar({ length: 50 }), // % deviation from optimal
  kellyPassed: boolean("kellyPassed"),
  
  // VaR Check
  portfolioVaR: varchar({ length: 50 }),
  positionVaR: varchar({ length: 50 }),
  varLimit: varchar({ length: 50 }),
  varUtilization: varchar({ length: 50 }), // Percentage
  varPassed: boolean("varPassed"),
  
  // Circuit Breaker Check
  circuitBreakerActive: boolean("circuitBreakerActive"),
  circuitBreakerReason: varchar("circuitBreakerReason", { length: 100 }),
  circuitBreakerPassed: boolean("circuitBreakerPassed"),
  
  // Balance & Margin Check
  availableBalance: varchar({ length: 50 }),
  requiredMargin: varchar({ length: 50 }),
  marginUtilization: varchar({ length: 50 }), // Percentage
  balancePassed: boolean("balancePassed"),
  
  // Position Limits Check
  currentPositions: int("currentPositions"),
  maxPositions: int("maxPositions"),
  positionLimitPassed: boolean("positionLimitPassed"),
  
  // Rejection Details
  rejectionReasons: json("rejectionReasons"), // Array of detailed rejection reasons
  recommendedAction: text("recommendedAction"), // What user should do
  
  // Approval Workflow (for high-risk trades)
  requiresApproval: boolean("requiresApproval").default(false).notNull(),
  approvedBy: int("approvedBy"), // User ID who approved
  approvedAt: timestamp("approvedAt"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type PreTradeValidation = typeof preTradeValidations.$inferSelect;
export type InsertPreTradeValidation = typeof preTradeValidations.$inferInsert;

/**
 * Strategy Position Mapping Table
 * Links positions to their trading strategies
 */
export const strategyPositions = mysqlTable("strategyPositions", {
  id: int("id").autoincrement().primaryKey(),
  strategyId: int("strategyId").notNull(),
  positionId: int("positionId").notNull(), // References paperPositions.id or positions.id
  isPaperTrading: boolean("isPaperTrading").notNull(),
  
  // Position contribution to strategy
  entryValue: varchar({ length: 50 }).notNull(),
  currentValue: varchar({ length: 50 }),
  pnl: varchar({ length: 50 }),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type StrategyPosition = typeof strategyPositions.$inferSelect;
export type InsertStrategyPosition = typeof strategyPositions.$inferInsert;

/**
 * Automated Trading Settings Table
 * Per-user configuration for automated trade execution based on signals
 */
export const automatedTradingSettings = mysqlTable("automatedTradingSettings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(), // One config per user
  
  // Core Settings
  enabled: boolean("enabled").default(false).notNull(), // Master switch for automation
  minSignalConfidence: int("minSignalConfidence").default(70).notNull(), // 0-100, minimum confidence to trigger trade
  
  // Position Sizing
  maxPositionSizePercent: int("maxPositionSizePercent").default(10).notNull(), // % of available balance per automated trade
  useKellyCriterion: boolean("useKellyCriterion").default(false).notNull(), // Use Kelly for position sizing
  kellyFraction: varchar({ length: 50 }).default("0.25"), // Fractional Kelly (0.25 = quarter Kelly)
  
  // Trade Limits
  maxTradesPerDay: int("maxTradesPerDay").default(10).notNull(),
  maxOpenPositions: int("maxOpenPositions").default(5).notNull(),
  cooldownMinutes: int("cooldownMinutes").default(15).notNull(), // Minutes between automated trades
  
  // Risk Controls
  maxDailyLossUSD: varchar({ length: 50 }).default("500.00").notNull(),
  stopOnConsecutiveLosses: int("stopOnConsecutiveLosses").default(3).notNull(), // Circuit breaker
  requireBothAgentTypes: boolean("requireBothAgentTypes").default(true).notNull(), // Require both fast & slow agents to agree
  
  // Trading Hours (JSON: { start: "09:30", end: "16:00", timezone: "America/New_York", days: [1,2,3,4,5] })
  tradingHours: json("tradingHours"),
  
  // Symbol Filters
  allowedSymbols: json("allowedSymbols"), // Array of symbols, null = all allowed
  blockedSymbols: json("blockedSymbols"), // Array of symbols to never auto-trade
  
  // Signal Type Filters
  enableTechnicalSignals: boolean("enableTechnicalSignals").default(true).notNull(),
  enableSentimentSignals: boolean("enableSentimentSignals").default(true).notNull(),
  enableOnChainSignals: boolean("enableOnChainSignals").default(false).notNull(),
  
  // Execution Settings
  useMarketOrders: boolean("useMarketOrders").default(true).notNull(), // vs limit orders
  limitOrderOffsetPercent: varchar({ length: 50 }).default("0.10"), // For limit orders
  
  // Notifications
  notifyOnExecution: boolean("notifyOnExecution").default(true).notNull(),
  notifyOnRejection: boolean("notifyOnRejection").default(true).notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()});

export type AutomatedTradingSettings = typeof automatedTradingSettings.$inferSelect;
export type InsertAutomatedTradingSettings = typeof automatedTradingSettings.$inferInsert;

/**
 * Automated Trade Execution Log Table
 * Complete audit trail of all automated trade attempts
 */
export const automatedTradeLog = mysqlTable("automatedTradeLog", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Signal Information
  signalId: varchar("signalId", { length: 100 }), // Reference to the signal that triggered this
  signalType: varchar("signalType", { length: 50 }).notNull(), // "combined", "technical", "sentiment", etc.
  signalConfidence: varchar({ length: 50 }).notNull(), // 0-100
  signalData: json("signalData").notNull(), // Complete signal snapshot
  
  // Trade Details
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: mysqlEnum("side", ["long", "short"]).notNull(),
  requestedQuantity: varchar({ length: 50 }),
  requestedValue: varchar({ length: 50 }),
  
  // Execution Result
  status: mysqlEnum("status", [
    "pending",
    "executed",
    "rejected",
    "failed",
    "cancelled"
  ]).notNull(),
  
  // Success Details
  positionId: int("positionId"), // Reference to paperPositions or positions
  executedPrice: varchar({ length: 50 }),
  executedQuantity: varchar({ length: 50 }),
  executionLatencyMs: int("executionLatencyMs"),
  
  // Rejection Details
  rejectionReason: varchar("rejectionReason", { length: 200 }),
  rejectionDetails: json("rejectionDetails"), // Detailed validation failures
  
  // Risk Assessment Snapshot
  preTradeBalance: varchar({ length: 50 }),
  preTradeEquity: varchar({ length: 50 }),
  preTradeOpenPositions: int("preTradeOpenPositions"),
  dailyTradeCount: int("dailyTradeCount"), // How many automated trades today before this one
  dailyPnL: varchar({ length: 50 }), // P&L today before this trade
  
  // Settings Snapshot (what settings were active)
  settingsSnapshot: json("settingsSnapshot"),
  
  // Timestamps
  signalReceivedAt: timestamp("signalReceivedAt").notNull(),
  evaluatedAt: timestamp("evaluatedAt").notNull(),
  executedAt: timestamp("executedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull()}, (table) => ({
  idx_autoTradeLog_userId_status: index("idx_autoTradeLog_userId_status").on(table.userId, table.status),
  idx_autoTradeLog_symbol: index("idx_autoTradeLog_symbol").on(table.symbol),
  idx_autoTradeLog_createdAt: index("idx_autoTradeLog_createdAt").on(table.createdAt),
}));

export type AutomatedTradeLog = typeof automatedTradeLog.$inferSelect;
export type InsertAutomatedTradeLog = typeof automatedTradeLog.$inferInsert;

/**
 * Automated Trading Performance Metrics Table
 * Aggregated performance statistics for automated trading
 */
export const automatedTradingMetrics = mysqlTable("automatedTradingMetrics", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Time Period
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  periodType: mysqlEnum("periodType", ["hourly", "daily", "weekly", "monthly"]).notNull(),
  
  // Execution Metrics
  totalSignalsReceived: int("totalSignalsReceived").default(0).notNull(),
  totalTradesExecuted: int("totalTradesExecuted").default(0).notNull(),
  totalTradesRejected: int("totalTradesRejected").default(0).notNull(),
  executionRate: varchar({ length: 50 }), // % of signals that became trades
  
  // Performance Metrics
  totalPnL: varchar({ length: 50 }).default("0.00"),
  winningTrades: int("winningTrades").default(0).notNull(),
  losingTrades: int("losingTrades").default(0).notNull(),
  winRate: varchar({ length: 50 }), // 0-100%
  avgWin: varchar({ length: 50 }),
  avgLoss: varchar({ length: 50 }),
  profitFactor: varchar({ length: 50 }), // Gross profit / gross loss
  
  // Latency Metrics
  avgSignalToExecutionMs: int("avgSignalToExecutionMs"),
  p95SignalToExecutionMs: int("p95SignalToExecutionMs"),
  
  // Risk Metrics
  maxDrawdown: varchar({ length: 50 }),
  sharpeRatio: varchar({ length: 50 }),
  
  // Rejection Breakdown (JSON: { insufficient_balance: 5, low_confidence: 12, ... })
  rejectionReasons: json("rejectionReasons"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull()});

export type AutomatedTradingMetric = typeof automatedTradingMetrics.$inferSelect;
export type InsertAutomatedTradingMetric = typeof automatedTradingMetrics.$inferInsert;

/**
 * Candle data table
 * Stores historical OHLCV candle data from Coinbase
 */
export const candleData = mysqlTable("candleData", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(), // e.g., "BTC-USD"
  timestamp: timestamp("timestamp").notNull(), // Candle open time
  open: varchar({ length: 50 }).notNull(),
  high: varchar({ length: 50 }).notNull(),
  low: varchar({ length: 50 }).notNull(),
  close: varchar({ length: 50 }).notNull(),
  volume: varchar({ length: 50 }).notNull(),
  interval: varchar("interval", { length: 10 }).notNull(), // e.g., "1h", "1d"
  createdAt: timestamp("createdAt").defaultNow().notNull()}, (table) => ({
  idx_candleData_symbol_interval_ts: index("idx_candleData_symbol_interval_ts").on(table.symbol, table.interval, table.timestamp),
}));

export type CandleData = typeof candleData.$inferSelect;
export type InsertCandleData = typeof candleData.$inferInsert;

/**
 * Strategy Instances table
 * Tracks individual strategy instances running simultaneously
 */
export const strategyInstances = mysqlTable("strategyInstances", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Strategy identification
  name: varchar("name", { length: 100 }).notNull(), // User-defined name
  strategyType: varchar("strategyType", { length: 50 }).notNull(), // e.g., "scalping", "swing_trading", "momentum"
  
  // Strategy configuration
  config: json("config").notNull(), // Strategy-specific parameters
  
  // Balance allocation
  allocatedBalance: varchar("allocatedBalance", { length: 50 }).notNull(), // Amount allocated to this strategy
  currentBalance: varchar("currentBalance", { length: 50 }).notNull(), // Current balance after trades
  
  // Status
  status: mysqlEnum("status", ["active", "paused", "stopped"]).default("paused").notNull(),
  
  // Timestamps
  startedAt: timestamp("startedAt"),
  stoppedAt: timestamp("stoppedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});

export type StrategyInstance = typeof strategyInstances.$inferSelect;
export type InsertStrategyInstance = typeof strategyInstances.$inferInsert;

/**
 * Strategy Performance table
 * Tracks performance metrics for each strategy instance
 */
export const strategyPerformance = mysqlTable("strategyPerformance", {
  id: int("id").autoincrement().primaryKey(),
  strategyId: int("strategyId").notNull(),
  userId: int("userId").notNull(),
  
  // Performance metrics
  totalTrades: int("totalTrades").default(0).notNull(),
  winningTrades: int("winningTrades").default(0).notNull(),
  losingTrades: int("losingTrades").default(0).notNull(),
  winRate: varchar({ length: 50 }).default("0.00").notNull(), // Percentage
  
  // P&L metrics
  totalPnL: varchar({ length: 50 }).default("0.00").notNull(),
  realizedPnL: varchar({ length: 50 }).default("0.00").notNull(),
  unrealizedPnL: varchar({ length: 50 }).default("0.00").notNull(),
  avgWin: varchar({ length: 50 }).default("0.00").notNull(),
  avgLoss: varchar({ length: 50 }).default("0.00").notNull(),
  
  // Risk metrics
  maxDrawdown: varchar({ length: 50 }).default("0.00"), // Percentage
  sharpeRatio: varchar({ length: 50 }), // Risk-adjusted return (total volatility)
  sortinoRatio: varchar({ length: 50 }), // Risk-adjusted return (downside-only volatility)
  calmarRatio: varchar({ length: 50 }), // Annualized return / max drawdown
  profitFactor: varchar({ length: 50 }), // Gross profit / gross loss
  
  // Position metrics
  openPositions: int("openPositions").default(0).notNull(),
  maxOpenPositions: int("maxOpenPositions").default(0).notNull(),
  
  // Commission tracking
  totalCommission: varchar({ length: 50 }).default("0.00"),
  
  // Last updated timestamp
  lastUpdated: timestamp("lastUpdated").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});

export type StrategyPerformance = typeof strategyPerformance.$inferSelect;
export type InsertStrategyPerformance = typeof strategyPerformance.$inferInsert;

/**
 * Learned Parameters Table
 * Stores dynamically learned thresholds and parameters that adapt over time
 * Used for consensus thresholds, agent confidence levels, alpha criteria, etc.
 */
export const learnedParameters = mysqlTable("learnedParameters", {
  id: int("id").autoincrement().primaryKey(),
  
  // Parameter identification
  parameterName: varchar("parameterName", { length: 100 }).notNull(),
  parameterType: mysqlEnum("parameterType", [
    "consensus_threshold",
    "agent_confidence",
    "alpha_criteria",
    "regime_multiplier",
    "other"
  ]).notNull(),
  
  // Context (nullable for global parameters)
  symbol: varchar("symbol", { length: 20 }), // NULL for global parameters
  regime: varchar("regime", { length: 50 }), // NULL for non-regime-specific
  agentName: varchar("agentName", { length: 50 }), // NULL for non-agent-specific
  
  // Parameter value and metadata
  // Using text to support both numeric values and JSON for complex parameters
  value: text("value").notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 4 }).default("0.5000").notNull(), // 0-1
  sampleSize: int("sampleSize").default(0).notNull(), // Number of trades used to learn
  
  // Performance metrics
  winRate: decimal("winRate", { precision: 5, scale: 4 }), // 0-1
  sharpeRatio: decimal("sharpeRatio", { precision: 6, scale: 3 }), // Can be negative
  
  // Timestamps
  lastUpdated: timestamp("lastUpdated").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  // Unique constraint: one parameter per context
  uniqueParameter: uniqueIndex("unique_parameter").on(
    table.parameterName,
    table.symbol,
    table.regime,
    table.agentName
  ),
  // Index for fast lookups
  parameterLookup: index("idx_parameter_lookup").on(
    table.parameterName,
    table.symbol,
    table.regime
  ),
  agentLookup: index("idx_agent_lookup").on(
    table.agentName,
    table.parameterName
  ),
  lastUpdatedIdx: index("idx_last_updated").on(table.lastUpdated)
}));

export type LearnedParameter = typeof learnedParameters.$inferSelect;
export type InsertLearnedParameter = typeof learnedParameters.$inferInsert;


/**
 * Whale Alerts Table
 * Stores whale transaction alerts from Whale Alert API
 * Used for tracking large crypto movements and market intelligence
 */
export const whaleAlerts = mysqlTable("whaleAlerts", {
  id: int("id").autoincrement().primaryKey(),
  
  // Transaction identification
  transactionHash: varchar("transactionHash", { length: 128 }).notNull().unique(),
  blockchain: varchar("blockchain", { length: 50 }).notNull(), // bitcoin, ethereum, etc.
  symbol: varchar("symbol", { length: 20 }).notNull(), // BTC, ETH, USDT, etc.
  
  // Transaction details
  transactionType: mysqlEnum("transactionType", [
    "transfer",
    "mint",
    "burn",
    "lock",
    "unlock"
  ]).notNull(),
  amount: decimal("amount", { precision: 30, scale: 8 }).notNull(),
  amountUsd: decimal("amountUsd", { precision: 20, scale: 2 }).notNull(),
  
  // Addresses
  fromAddress: varchar("fromAddress", { length: 256 }),
  toAddress: varchar("toAddress", { length: 256 }),
  fromOwner: varchar("fromOwner", { length: 100 }), // Exchange name or "unknown"
  toOwner: varchar("toOwner", { length: 100 }), // Exchange name or "unknown"
  fromOwnerType: varchar("fromOwnerType", { length: 50 }), // exchange, unknown, etc.
  toOwnerType: varchar("toOwnerType", { length: 50 }), // exchange, unknown, etc.
  
  // Timestamps
  transactionTimestamp: timestamp("transactionTimestamp").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  blockchainIdx: index("idx_whale_blockchain").on(table.blockchain),
  symbolIdx: index("idx_whale_symbol").on(table.symbol),
  timestampIdx: index("idx_whale_timestamp").on(table.transactionTimestamp),
  amountIdx: index("idx_whale_amount").on(table.amountUsd)
}));

export type WhaleAlert = typeof whaleAlerts.$inferSelect;
export type InsertWhaleAlert = typeof whaleAlerts.$inferInsert;

/**
 * Whale Alert Watchlist Table
 * Stores user's watchlist for specific wallets, tokens, or thresholds
 */
export const whaleWatchlist = mysqlTable("whaleWatchlist", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Watch criteria (at least one should be set)
  watchType: mysqlEnum("watchType", [
    "wallet",      // Watch specific wallet address
    "token",       // Watch specific token
    "threshold",   // Watch transactions above threshold
    "exchange"     // Watch exchange inflows/outflows
  ]).notNull(),
  
  // Watch parameters
  walletAddress: varchar("walletAddress", { length: 256 }),
  tokenSymbol: varchar("tokenSymbol", { length: 20 }),
  blockchain: varchar("blockchain", { length: 50 }),
  minAmountUsd: decimal("minAmountUsd", { precision: 20, scale: 2 }),
  exchangeName: varchar("exchangeName", { length: 100 }),
  
  // Notification preferences
  notifyOnMatch: boolean("notifyOnMatch").default(true).notNull(),
  
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  userIdx: index("idx_watchlist_user").on(table.userId),
  activeIdx: index("idx_watchlist_active").on(table.isActive)
}));

export type WhaleWatchlist = typeof whaleWatchlist.$inferSelect;
export type InsertWhaleWatchlist = typeof whaleWatchlist.$inferInsert;


/**
 * Whale-Correlated Signals Table
 * Stores trading signals enhanced with whale activity correlation data
 * Used for tracking how whale movements align with or conflict with trading signals
 */
export const whaleCorrelatedSignals = mysqlTable("whaleCorrelatedSignals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Original signal reference
  originalSignalId: int("originalSignalId"),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  signalType: mysqlEnum("signalType", ["BUY", "SELL", "NEUTRAL"]).notNull(),
  signalSource: varchar("signalSource", { length: 50 }).notNull(),
  
  // Original signal metrics
  originalConfidence: decimal("originalConfidence", { precision: 5, scale: 4 }).notNull(),
  originalStrength: decimal("originalStrength", { precision: 5, scale: 4 }).notNull(),
  
  // Whale correlation data
  whaleImpactScore: decimal("whaleImpactScore", { precision: 6, scale: 2 }).notNull(), // -100 to +100
  whaleFlowSentiment: mysqlEnum("whaleFlowSentiment", ["bullish", "bearish", "neutral"]).notNull(),
  correlationAlignment: mysqlEnum("correlationAlignment", ["aligned", "conflicting", "neutral"]).notNull(),
  
  // Adjusted metrics
  adjustedConfidence: decimal("adjustedConfidence", { precision: 5, scale: 4 }).notNull(),
  adjustedStrength: decimal("adjustedStrength", { precision: 5, scale: 4 }).notNull(),
  
  // Whale flow details
  netExchangeFlow: decimal("netExchangeFlow", { precision: 20, scale: 2 }), // USD
  totalInflow: decimal("totalInflow", { precision: 20, scale: 2 }), // USD
  totalOutflow: decimal("totalOutflow", { precision: 20, scale: 2 }), // USD
  whaleTransactionCount: int("whaleTransactionCount").default(0).notNull(),
  
  // Enhanced reasoning
  enhancedReasoning: text("enhancedReasoning"),
  
  // Timestamps
  signalTimestamp: timestamp("signalTimestamp").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  userIdx: index("idx_whale_corr_user").on(table.userId),
  symbolIdx: index("idx_whale_corr_symbol").on(table.symbol),
  alignmentIdx: index("idx_whale_corr_alignment").on(table.correlationAlignment),
  timestampIdx: index("idx_whale_corr_timestamp").on(table.signalTimestamp)
}));

export type WhaleCorrelatedSignal = typeof whaleCorrelatedSignals.$inferSelect;
export type InsertWhaleCorrelatedSignal = typeof whaleCorrelatedSignals.$inferInsert;

/**
 * Whale Impact Snapshots Table
 * Stores periodic snapshots of whale impact scores for historical analysis
 */
export const whaleImpactSnapshots = mysqlTable("whaleImpactSnapshots", {
  id: int("id").autoincrement().primaryKey(),
  
  symbol: varchar("symbol", { length: 20 }).notNull(),
  
  // Impact score data
  impactScore: decimal("impactScore", { precision: 6, scale: 2 }).notNull(), // -100 to +100
  confidence: decimal("confidence", { precision: 5, scale: 4 }).notNull(),
  
  // Factor breakdown
  flowImpact: decimal("flowImpact", { precision: 6, scale: 2 }).notNull(),
  volumeImpact: decimal("volumeImpact", { precision: 6, scale: 2 }).notNull(),
  burnMintImpact: decimal("burnMintImpact", { precision: 6, scale: 2 }).notNull(),
  
  // Flow analysis
  netFlow: decimal("netFlow", { precision: 20, scale: 2 }).notNull(),
  flowSentiment: mysqlEnum("flowSentiment", ["bullish", "bearish", "neutral"]).notNull(),
  transactionCount: int("transactionCount").default(0).notNull(),
  
  // Reasoning
  reasoning: text("reasoning"),
  
  // Time window
  timeWindowHours: int("timeWindowHours").default(24).notNull(),
  
  // Timestamp
  snapshotTimestamp: timestamp("snapshotTimestamp").defaultNow().notNull()
}, (table) => ({
  symbolIdx: index("idx_whale_impact_symbol").on(table.symbol),
  timestampIdx: index("idx_whale_impact_timestamp").on(table.snapshotTimestamp),
  scoreIdx: index("idx_whale_impact_score").on(table.impactScore)
}));

export type WhaleImpactSnapshot = typeof whaleImpactSnapshots.$inferSelect;
export type InsertWhaleImpactSnapshot = typeof whaleImpactSnapshots.$inferInsert;


/**
 * Signal Boosting Settings Table
 * Per-user configuration for automated position size boosting based on whale confirmation
 */
export const signalBoostingSettings = mysqlTable("signalBoostingSettings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(), // One config per user
  
  // Core Settings
  enabled: boolean("enabled").default(false).notNull(), // Master switch for signal boosting
  
  // Boost Multipliers
  strongConfirmationMultiplier: decimal("strongConfirmationMultiplier", { precision: 4, scale: 2 }).default("1.50").notNull(), // 1.5x for strong whale confirmation
  moderateConfirmationMultiplier: decimal("moderateConfirmationMultiplier", { precision: 4, scale: 2 }).default("1.25").notNull(), // 1.25x for moderate confirmation
  weakConfirmationMultiplier: decimal("weakConfirmationMultiplier", { precision: 4, scale: 2 }).default("1.00").notNull(), // 1.0x (no boost) for weak confirmation
  conflictingMultiplier: decimal("conflictingMultiplier", { precision: 4, scale: 2 }).default("0.75").notNull(), // 0.75x reduction when whale conflicts
  
  // Confirmation Thresholds
  strongConfirmationThreshold: int("strongConfirmationThreshold").default(70).notNull(), // Whale impact score >= 70 for strong
  moderateConfirmationThreshold: int("moderateConfirmationThreshold").default(40).notNull(), // Whale impact score >= 40 for moderate
  minWhaleTransactions: int("minWhaleTransactions").default(3).notNull(), // Minimum whale transactions for valid confirmation
  
  // Risk Controls
  maxBoostMultiplier: decimal("maxBoostMultiplier", { precision: 4, scale: 2 }).default("2.00").notNull(), // Maximum allowed boost
  maxDailyBoostedTrades: int("maxDailyBoostedTrades").default(10).notNull(), // Circuit breaker for boosted trades
  maxBoostedPositionPercent: int("maxBoostedPositionPercent").default(30).notNull(), // Max % of portfolio in boosted positions
  requireMinConfidence: int("requireMinConfidence").default(65).notNull(), // Minimum signal confidence to allow boosting
  
  // Time Windows
  whaleAnalysisWindowHours: int("whaleAnalysisWindowHours").default(24).notNull(), // Hours to look back for whale activity
  cooldownMinutes: int("cooldownMinutes").default(30).notNull(), // Cooldown between boosted trades on same symbol
  
  // Notifications
  notifyOnBoost: boolean("notifyOnBoost").default(true).notNull(),
  notifyOnConflict: boolean("notifyOnConflict").default(true).notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});

export type SignalBoostingSettings = typeof signalBoostingSettings.$inferSelect;
export type InsertSignalBoostingSettings = typeof signalBoostingSettings.$inferInsert;

/**
 * Signal Boosting History Table
 * Tracks all boosted trades for performance analysis
 */
export const signalBoostingHistory = mysqlTable("signalBoostingHistory", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Signal Reference
  originalSignalId: int("originalSignalId"),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  signalType: mysqlEnum("signalType", ["BUY", "SELL"]).notNull(),
  signalSource: varchar("signalSource", { length: 50 }).notNull(),
  
  // Original Signal Metrics
  originalConfidence: decimal("originalConfidence", { precision: 5, scale: 4 }).notNull(),
  originalPositionSize: decimal("originalPositionSize", { precision: 20, scale: 8 }).notNull(),
  
  // Whale Confirmation Data
  whaleImpactScore: decimal("whaleImpactScore", { precision: 6, scale: 2 }).notNull(),
  whaleFlowSentiment: mysqlEnum("whaleFlowSentiment", ["bullish", "bearish", "neutral"]).notNull(),
  whaleTransactionCount: int("whaleTransactionCount").default(0).notNull(),
  netExchangeFlow: decimal("netExchangeFlow", { precision: 20, scale: 2 }),
  
  // Boost Decision
  confirmationLevel: mysqlEnum("confirmationLevel", ["strong", "moderate", "weak", "conflicting", "none"]).notNull(),
  boostMultiplier: decimal("boostMultiplier", { precision: 4, scale: 2 }).notNull(),
  boostedPositionSize: decimal("boostedPositionSize", { precision: 20, scale: 8 }).notNull(),
  boostApplied: boolean("boostApplied").default(false).notNull(),
  
  // Rejection Reason (if boost was not applied)
  rejectionReason: varchar("rejectionReason", { length: 200 }),
  
  // Trade Outcome (filled after trade closes)
  tradeId: int("tradeId"),
  entryPrice: decimal("entryPrice", { precision: 20, scale: 8 }),
  exitPrice: decimal("exitPrice", { precision: 20, scale: 8 }),
  pnl: decimal("pnl", { precision: 20, scale: 8 }),
  pnlPercent: decimal("pnlPercent", { precision: 8, scale: 4 }),
  tradeOutcome: mysqlEnum("tradeOutcome", ["win", "loss", "breakeven", "pending"]).default("pending").notNull(),
  
  // Timestamps
  signalTimestamp: timestamp("signalTimestamp").notNull(),
  boostDecisionTimestamp: timestamp("boostDecisionTimestamp").notNull(),
  tradeClosedTimestamp: timestamp("tradeClosedTimestamp"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  userIdx: index("idx_boost_history_user").on(table.userId),
  symbolIdx: index("idx_boost_history_symbol").on(table.symbol),
  confirmationIdx: index("idx_boost_history_confirmation").on(table.confirmationLevel),
  outcomeIdx: index("idx_boost_history_outcome").on(table.tradeOutcome),
  timestampIdx: index("idx_boost_history_timestamp").on(table.signalTimestamp)
}));

export type SignalBoostingHistory = typeof signalBoostingHistory.$inferSelect;
export type InsertSignalBoostingHistory = typeof signalBoostingHistory.$inferInsert;

/**
 * Correlation Backtest Results Table
 * Stores results from historical correlation backtests
 */
export const correlationBacktestResults = mysqlTable("correlationBacktestResults", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Backtest Configuration
  backtestName: varchar("backtestName", { length: 100 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  startDate: timestamp("startDate").notNull(),
  endDate: timestamp("endDate").notNull(),
  whaleWindowHours: int("whaleWindowHours").default(24).notNull(),
  minWhaleImpactScore: int("minWhaleImpactScore").default(20).notNull(),
  
  // Signal Statistics
  totalSignals: int("totalSignals").default(0).notNull(),
  alignedSignals: int("alignedSignals").default(0).notNull(),
  conflictingSignals: int("conflictingSignals").default(0).notNull(),
  neutralSignals: int("neutralSignals").default(0).notNull(),
  
  // Performance Metrics - Aligned Signals
  alignedWinRate: decimal("alignedWinRate", { precision: 6, scale: 4 }), // 0.0000 to 1.0000
  alignedAvgReturn: decimal("alignedAvgReturn", { precision: 10, scale: 4 }), // Average return %
  alignedProfitFactor: decimal("alignedProfitFactor", { precision: 8, scale: 4 }), // Gross profit / gross loss
  alignedSharpeRatio: decimal("alignedSharpeRatio", { precision: 8, scale: 4 }),
  alignedMaxDrawdown: decimal("alignedMaxDrawdown", { precision: 8, scale: 4 }), // Maximum drawdown %
  
  // Performance Metrics - Conflicting Signals
  conflictingWinRate: decimal("conflictingWinRate", { precision: 6, scale: 4 }),
  conflictingAvgReturn: decimal("conflictingAvgReturn", { precision: 10, scale: 4 }),
  conflictingProfitFactor: decimal("conflictingProfitFactor", { precision: 8, scale: 4 }),
  
  // Performance Metrics - All Signals (Baseline)
  baselineWinRate: decimal("baselineWinRate", { precision: 6, scale: 4 }),
  baselineAvgReturn: decimal("baselineAvgReturn", { precision: 10, scale: 4 }),
  baselineProfitFactor: decimal("baselineProfitFactor", { precision: 8, scale: 4 }),
  baselineSharpeRatio: decimal("baselineSharpeRatio", { precision: 8, scale: 4 }),
  
  // Correlation Analysis
  correlationCoefficient: decimal("correlationCoefficient", { precision: 6, scale: 4 }), // -1 to +1
  correlationPValue: decimal("correlationPValue", { precision: 10, scale: 8 }), // Statistical significance
  optimalLagHours: int("optimalLagHours"), // Best lag for whale signals
  
  // Improvement Metrics
  winRateImprovement: decimal("winRateImprovement", { precision: 8, scale: 4 }), // Aligned vs baseline
  returnImprovement: decimal("returnImprovement", { precision: 8, scale: 4 }), // Aligned vs baseline
  
  // Backtest Metadata
  status: mysqlEnum("status", ["running", "completed", "failed"]).default("running").notNull(),
  errorMessage: text("errorMessage"),
  executionTimeMs: int("executionTimeMs"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt")
}, (table) => ({
  userIdx: index("idx_backtest_user").on(table.userId),
  symbolIdx: index("idx_backtest_symbol").on(table.symbol),
  statusIdx: index("idx_backtest_status").on(table.status),
  timestampIdx: index("idx_backtest_created").on(table.createdAt)
}));

export type CorrelationBacktestResult = typeof correlationBacktestResults.$inferSelect;
export type InsertCorrelationBacktestResult = typeof correlationBacktestResults.$inferInsert;

/**
 * Correlation Backtest Trades Table
 * Individual trade records from backtests for detailed analysis
 */
export const correlationBacktestTrades = mysqlTable("correlationBacktestTrades", {
  id: int("id").autoincrement().primaryKey(),
  backtestId: int("backtestId").notNull(),
  
  // Trade Details
  symbol: varchar("symbol", { length: 20 }).notNull(),
  signalType: mysqlEnum("signalType", ["BUY", "SELL"]).notNull(),
  signalTimestamp: timestamp("signalTimestamp").notNull(),
  
  // Signal Metrics
  signalConfidence: decimal("signalConfidence", { precision: 5, scale: 4 }).notNull(),
  signalStrength: decimal("signalStrength", { precision: 5, scale: 4 }).notNull(),
  
  // Whale Data at Signal Time
  whaleImpactScore: decimal("whaleImpactScore", { precision: 6, scale: 2 }).notNull(),
  whaleFlowSentiment: mysqlEnum("whaleFlowSentiment", ["bullish", "bearish", "neutral"]).notNull(),
  correlationAlignment: mysqlEnum("correlationAlignment", ["aligned", "conflicting", "neutral"]).notNull(),
  whaleTransactionCount: int("whaleTransactionCount").default(0).notNull(),
  
  // Trade Execution
  entryPrice: decimal("entryPrice", { precision: 20, scale: 8 }).notNull(),
  exitPrice: decimal("exitPrice", { precision: 20, scale: 8 }).notNull(),
  holdingPeriodHours: decimal("holdingPeriodHours", { precision: 10, scale: 2 }).notNull(),
  
  // Trade Outcome
  pnlPercent: decimal("pnlPercent", { precision: 10, scale: 4 }).notNull(),
  outcome: mysqlEnum("outcome", ["win", "loss", "breakeven"]).notNull(),
  
  // Boosted Simulation
  boostedPnlPercent: decimal("boostedPnlPercent", { precision: 10, scale: 4 }), // What PnL would be with boost
  boostMultiplierUsed: decimal("boostMultiplierUsed", { precision: 4, scale: 2 }),
  
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  backtestIdx: index("idx_backtest_trades_backtest").on(table.backtestId),
  alignmentIdx: index("idx_backtest_trades_alignment").on(table.correlationAlignment),
  outcomeIdx: index("idx_backtest_trades_outcome").on(table.outcome),
  timestampIdx: index("idx_backtest_trades_timestamp").on(table.signalTimestamp)
}));

export type CorrelationBacktestTrade = typeof correlationBacktestTrades.$inferSelect;
export type InsertCorrelationBacktestTrade = typeof correlationBacktestTrades.$inferInsert;

/**
 * Daily Boosting Metrics Table
 * Aggregated daily performance metrics for signal boosting
 */
export const dailyBoostingMetrics = mysqlTable("dailyBoostingMetrics", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  date: timestamp("date").notNull(),
  
  // Trade Counts
  totalBoostedTrades: int("totalBoostedTrades").default(0).notNull(),
  strongConfirmationTrades: int("strongConfirmationTrades").default(0).notNull(),
  moderateConfirmationTrades: int("moderateConfirmationTrades").default(0).notNull(),
  conflictingTrades: int("conflictingTrades").default(0).notNull(),
  
  // Performance
  boostedTradesWinRate: decimal("boostedTradesWinRate", { precision: 6, scale: 4 }),
  boostedTradesPnl: decimal("boostedTradesPnl", { precision: 20, scale: 8 }),
  nonBoostedTradesWinRate: decimal("nonBoostedTradesWinRate", { precision: 6, scale: 4 }),
  nonBoostedTradesPnl: decimal("nonBoostedTradesPnl", { precision: 20, scale: 8 }),
  
  // Boost Impact
  avgBoostMultiplier: decimal("avgBoostMultiplier", { precision: 4, scale: 2 }),
  pnlAttributedToBoost: decimal("pnlAttributedToBoost", { precision: 20, scale: 8 }), // Extra PnL from boosting
  
  // Risk Metrics
  maxBoostedPositionSize: decimal("maxBoostedPositionSize", { precision: 20, scale: 8 }),
  boostedPositionExposure: decimal("boostedPositionExposure", { precision: 8, scale: 4 }), // % of portfolio
  
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  userDateIdx: uniqueIndex("idx_daily_boost_user_date").on(table.userId, table.date),
  dateIdx: index("idx_daily_boost_date").on(table.date)
}));

export type DailyBoostingMetric = typeof dailyBoostingMetrics.$inferSelect;
export type InsertDailyBoostingMetric = typeof dailyBoostingMetrics.$inferInsert;


/**
 * RL Models Table
 * Stores reinforcement learning model configurations and serialized weights
 */
export const rlModels = mysqlTable("rlModels", {
  id: int("id").autoincrement().primaryKey(),
  
  // Model identification
  name: varchar("name", { length: 100 }).notNull(),
  agentType: mysqlEnum("agentType", ["dqn", "ppo"]).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(), // 1m, 5m, 15m, 1h, etc.
  
  // Model configuration (JSON)
  config: text("config"),
  
  // Serialized model weights (JSON)
  modelData: mediumtext("modelData"),
  
  // Model status
  status: mysqlEnum("status", ["training", "ready", "paper_trading", "live", "disabled"]).default("training").notNull(),
  
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  symbolIdx: index("idx_rl_models_symbol").on(table.symbol),
  statusIdx: index("idx_rl_models_status").on(table.status),
  typeIdx: index("idx_rl_models_type").on(table.agentType)
}));

export type RLModel = typeof rlModels.$inferSelect;
export type InsertRLModel = typeof rlModels.$inferInsert;

/**
 * RL Training History Table
 * Stores training session results and metrics
 */
export const rlTrainingHistory = mysqlTable("rlTrainingHistory", {
  id: int("id").autoincrement().primaryKey(),
  modelId: int("modelId").notNull(),
  
  // Training session details
  startTime: timestamp("startTime").notNull(),
  endTime: timestamp("endTime"),
  episodes: int("episodes").default(0).notNull(),
  totalTimesteps: int("totalTimesteps").default(0).notNull(),
  
  // Final performance metrics
  finalPnl: decimal("finalPnl", { precision: 20, scale: 8 }),
  finalSharpe: decimal("finalSharpe", { precision: 10, scale: 4 }),
  finalMaxDrawdown: decimal("finalMaxDrawdown", { precision: 10, scale: 4 }),
  finalWinRate: decimal("finalWinRate", { precision: 6, scale: 4 }),
  tradeCount: int("tradeCount").default(0),
  
  // Training status
  status: mysqlEnum("status", ["running", "completed", "failed"]).default("running").notNull(),
  error: text("error"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  modelIdx: index("idx_rl_training_model").on(table.modelId),
  statusIdx: index("idx_rl_training_status").on(table.status),
  timeIdx: index("idx_rl_training_time").on(table.startTime)
}));

export type RLTrainingHistory = typeof rlTrainingHistory.$inferSelect;
export type InsertRLTrainingHistory = typeof rlTrainingHistory.$inferInsert;

/**
 * Neural Network Predictions Table
 * Stores price predictions from LSTM/Transformer models
 */
export const nnPredictions = mysqlTable("nnPredictions", {
  id: int("id").autoincrement().primaryKey(),
  
  // Prediction identification
  modelType: mysqlEnum("modelType", ["lstm", "transformer", "ensemble"]).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  
  // Prediction details
  predictionTimestamp: timestamp("predictionTimestamp").notNull(),
  targetTimestamp: timestamp("targetTimestamp").notNull(), // When the prediction is for
  
  // Predicted values
  predictedPrice: decimal("predictedPrice", { precision: 20, scale: 8 }).notNull(),
  predictedDirection: mysqlEnum("predictedDirection", ["up", "down", "neutral"]).notNull(),
  confidence: decimal("confidence", { precision: 6, scale: 4 }).notNull(),
  
  // Actual outcome (filled after target time)
  actualPrice: decimal("actualPrice", { precision: 20, scale: 8 }),
  actualDirection: mysqlEnum("actualDirection", ["up", "down", "neutral"]),
  predictionError: decimal("predictionError", { precision: 10, scale: 6 }), // Percentage error
  wasCorrect: boolean("wasCorrect"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  symbolIdx: index("idx_nn_pred_symbol").on(table.symbol),
  modelIdx: index("idx_nn_pred_model").on(table.modelType),
  targetIdx: index("idx_nn_pred_target").on(table.targetTimestamp),
  predIdx: index("idx_nn_pred_timestamp").on(table.predictionTimestamp)
}));

export type NNPrediction = typeof nnPredictions.$inferSelect;
export type InsertNNPrediction = typeof nnPredictions.$inferInsert;

/**
 * Parameter Optimization History Table
 * Stores Bayesian optimization results for hyperparameter tuning
 */
export const parameterOptimizationHistory = mysqlTable("parameterOptimizationHistory", {
  id: int("id").autoincrement().primaryKey(),
  
  // Optimization identification
  optimizationType: mysqlEnum("optimizationType", [
    "strategy_params",
    "agent_weights",
    "risk_params",
    "ml_hyperparams"
  ]).notNull(),
  targetMetric: varchar("targetMetric", { length: 50 }).notNull(), // sharpe, win_rate, pnl, etc.
  symbol: varchar("symbol", { length: 20 }),
  
  // Optimization details
  parameterSpace: text("parameterSpace"), // JSON of parameter ranges
  bestParameters: text("bestParameters"), // JSON of optimal parameters
  bestScore: decimal("bestScore", { precision: 15, scale: 6 }),
  
  // Optimization progress
  iterationsCompleted: int("iterationsCompleted").default(0).notNull(),
  totalIterations: int("totalIterations").notNull(),
  
  // Status
  status: mysqlEnum("status", ["running", "completed", "failed"]).default("running").notNull(),
  error: text("error"),
  
  startTime: timestamp("startTime").notNull(),
  endTime: timestamp("endTime"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  typeIdx: index("idx_param_opt_type").on(table.optimizationType),
  statusIdx: index("idx_param_opt_status").on(table.status),
  timeIdx: index("idx_param_opt_time").on(table.startTime)
}));

export type ParameterOptimizationHistory = typeof parameterOptimizationHistory.$inferSelect;
export type InsertParameterOptimizationHistory = typeof parameterOptimizationHistory.$inferInsert;


/**
 * RL Model Versions Table
 * Stores versioned model checkpoints for rollback capabilities
 */
export const rlModelVersions = mysqlTable("rlModelVersions", {
  id: int("id").autoincrement().primaryKey(),
  modelId: int("modelId").notNull(),
  
  // Version identification
  version: int("version").notNull(),
  versionTag: varchar("versionTag", { length: 50 }), // e.g., "v1.0.0", "stable", "experimental"
  
  // Model data
  modelData: mediumtext("modelData"), // Serialized model weights
  config: text("config"), // JSON configuration at this version
  
  // Performance metrics at this version
  sharpeRatio: decimal("sharpeRatio", { precision: 10, scale: 6 }),
  maxDrawdown: decimal("maxDrawdown", { precision: 10, scale: 6 }),
  winRate: decimal("winRate", { precision: 10, scale: 6 }),
  totalPnL: decimal("totalPnL", { precision: 20, scale: 8 }),
  
  // Metadata
  trainingDataStart: timestamp("trainingDataStart"),
  trainingDataEnd: timestamp("trainingDataEnd"),
  candleCount: int("candleCount").default(0),
  
  // Status
  isActive: boolean("isActive").default(false).notNull(),
  isStable: boolean("isStable").default(false).notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  notes: text("notes")
}, (table) => ({
  modelVersionIdx: uniqueIndex("idx_model_version").on(table.modelId, table.version),
  activeIdx: index("idx_model_active").on(table.isActive),
  stableIdx: index("idx_model_stable").on(table.isStable)
}));

export type RLModelVersion = typeof rlModelVersions.$inferSelect;
export type InsertRLModelVersion = typeof rlModelVersions.$inferInsert;

/**
 * Pipeline Status Table
 * Tracks the status of data ingestion and training pipelines
 */
export const pipelineStatus = mysqlTable("pipelineStatus", {
  id: int("id").autoincrement().primaryKey(),
  
  // Pipeline identification
  pipelineType: mysqlEnum("pipelineType", [
    "data_ingestion",
    "model_training",
    "model_validation",
    "model_deployment"
  ]).notNull(),
  symbol: varchar("symbol", { length: 20 }),
  
  // Status
  status: mysqlEnum("status", [
    "idle",
    "running",
    "completed",
    "failed",
    "paused"
  ]).default("idle").notNull(),
  
  // Progress tracking
  currentStep: varchar("currentStep", { length: 100 }),
  progress: int("progress").default(0).notNull(), // 0-100
  
  // Timing
  lastRunStart: timestamp("lastRunStart"),
  lastRunEnd: timestamp("lastRunEnd"),
  nextScheduledRun: timestamp("nextScheduledRun"),
  
  // Statistics
  totalRuns: int("totalRuns").default(0).notNull(),
  successfulRuns: int("successfulRuns").default(0).notNull(),
  failedRuns: int("failedRuns").default(0).notNull(),
  
  // Error tracking
  lastError: text("lastError"),
  consecutiveFailures: int("consecutiveFailures").default(0).notNull(),
  
  // Configuration
  config: text("config"), // JSON configuration
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  typeIdx: index("idx_pipeline_type").on(table.pipelineType),
  statusIdx: index("idx_pipeline_status").on(table.status),
  symbolIdx: index("idx_pipeline_symbol").on(table.symbol)
}));

export type PipelineStatus = typeof pipelineStatus.$inferSelect;
export type InsertPipelineStatus = typeof pipelineStatus.$inferInsert;

/**
 * Training Jobs Table
 * Stores individual training job records
 */
export const trainingJobs = mysqlTable("trainingJobs", {
  id: int("id").autoincrement().primaryKey(),
  
  // Job identification
  jobId: varchar("jobId", { length: 50 }).notNull().unique(),
  modelId: int("modelId"),
  
  // Job type and configuration
  jobType: mysqlEnum("jobType", [
    "incremental_training",
    "full_retraining",
    "validation",
    "hyperparameter_tuning"
  ]).notNull(),
  config: text("config"), // JSON configuration
  
  // Data range
  dataStartTime: timestamp("dataStartTime"),
  dataEndTime: timestamp("dataEndTime"),
  candleCount: int("candleCount").default(0),
  
  // Status
  status: mysqlEnum("status", [
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled"
  ]).default("queued").notNull(),
  
  // Progress
  currentEpoch: int("currentEpoch").default(0),
  totalEpochs: int("totalEpochs"),
  progress: int("progress").default(0).notNull(), // 0-100
  
  // Results
  finalMetrics: text("finalMetrics"), // JSON metrics
  modelVersionCreated: int("modelVersionCreated"),
  
  // Timing
  queuedAt: timestamp("queuedAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  
  // Error tracking
  error: text("error"),
  
  // Priority and scheduling
  priority: int("priority").default(5).notNull(), // 1-10, higher = more urgent
  scheduledFor: timestamp("scheduledFor")
}, (table) => ({
  jobIdIdx: uniqueIndex("idx_job_id").on(table.jobId),
  statusIdx: index("idx_job_status").on(table.status),
  modelIdx: index("idx_job_model").on(table.modelId),
  priorityIdx: index("idx_job_priority").on(table.priority)
}));

export type TrainingJob = typeof trainingJobs.$inferSelect;
export type InsertTrainingJob = typeof trainingJobs.$inferInsert;

/**
 * Data Quality Metrics Table
 * Tracks data quality for training datasets
 */
export const dataQualityMetrics = mysqlTable("dataQualityMetrics", {
  id: int("id").autoincrement().primaryKey(),
  
  // Data identification
  symbol: varchar("symbol", { length: 20 }).notNull(),
  interval: varchar("interval", { length: 10 }).notNull(),
  
  // Time range
  dataStartTime: timestamp("dataStartTime").notNull(),
  dataEndTime: timestamp("dataEndTime").notNull(),
  
  // Quality metrics
  totalCandles: int("totalCandles").default(0).notNull(),
  missingCandles: int("missingCandles").default(0).notNull(),
  duplicateCandles: int("duplicateCandles").default(0).notNull(),
  outlierCandles: int("outlierCandles").default(0).notNull(),
  
  // Data quality score (0-100)
  qualityScore: int("qualityScore").default(100).notNull(),
  
  // Validation details
  validationDetails: text("validationDetails"), // JSON with detailed issues
  
  // Status
  isValid: boolean("isValid").default(true).notNull(),
  validatedAt: timestamp("validatedAt").defaultNow().notNull()
}, (table) => ({
  symbolIntervalIdx: index("idx_dq_symbol_interval").on(table.symbol, table.interval),
  validIdx: index("idx_dq_valid").on(table.isValid),
  scoreIdx: index("idx_dq_score").on(table.qualityScore)
}));

export type DataQualityMetric = typeof dataQualityMetrics.$inferSelect;
export type InsertDataQualityMetric = typeof dataQualityMetrics.$inferInsert;


/**
 * Trade Journal Entries table
 * Stores user trading journal entries for reflection and improvement
 */
export const tradeJournalEntries = mysqlTable("tradeJournalEntries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tradeId: int("tradeId"), // Optional link to a specific trade
  
  // Entry metadata
  title: varchar("title", { length: 200 }),
  setup: text("setup"), // Trade setup description
  strategy: varchar("strategy", { length: 100 }),
  timeframe: varchar("timeframe", { length: 20 }),
  
  // Market conditions
  marketCondition: mysqlEnum("marketCondition", ["trending", "ranging", "volatile", "calm"]),
  
  // Trade reasoning
  entryReason: text("entryReason"),
  confluenceFactors: json("confluenceFactors").$type<string[]>(),
  exitReason: text("exitReason"),
  
  // Lessons and improvements
  lessonsLearned: text("lessonsLearned"),
  mistakes: text("mistakes"),
  improvements: text("improvements"),
  
  // Emotional tracking
  emotionBefore: mysqlEnum("emotionBefore", ["confident", "neutral", "anxious", "fearful", "greedy", "frustrated"]),
  emotionDuring: mysqlEnum("emotionDuring", ["confident", "neutral", "anxious", "fearful", "greedy", "frustrated"]),
  emotionAfter: mysqlEnum("emotionAfter", ["satisfied", "neutral", "disappointed", "frustrated", "relieved"]),
  
  // Self-assessment
  executionRating: int("executionRating"), // 1-5 rating
  followedPlan: boolean("followedPlan"),
  
  // Media and tags
  screenshots: json("screenshots").$type<string[]>(),
  tags: json("tags").$type<string[]>(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  userIdIdx: index("idx_journal_userId").on(table.userId),
  tradeIdIdx: index("idx_journal_tradeId").on(table.tradeId),
  strategyIdx: index("idx_journal_strategy").on(table.strategy),
  createdAtIdx: index("idx_journal_createdAt").on(table.createdAt)
}));

export type TradeJournalEntry = typeof tradeJournalEntries.$inferSelect;
export type InsertTradeJournalEntry = typeof tradeJournalEntries.$inferInsert;


/**
 * On-Chain AI Agents table
 * Stores AI agent configurations for automated on-chain analysis and trading
 */
export const onchainAgents = mysqlTable("onchainAgents", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Agent identity
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  avatar: varchar("avatar", { length: 255 }), // URL or emoji
  
  // Agent type and capabilities
  agentType: mysqlEnum("agentType", [
    "whale_tracker",      // Monitors large wallet movements
    "market_analyzer",    // Analyzes market conditions and trends
    "trading_strategist", // Generates trading strategies
    "risk_manager",       // Monitors and manages risk
    "sentiment_analyst",  // Analyzes social/news sentiment
    "arbitrage_hunter",   // Finds arbitrage opportunities
    "custom"              // User-defined agent
  ]).notNull(),
  
  // Agent configuration
  config: json("config").$type<{
    // Common settings
    symbols?: string[];           // Tokens/pairs to monitor
    updateInterval?: number;      // Minutes between updates
    confidenceThreshold?: number; // Min confidence to act (0-100)
    
    // Whale tracker specific
    minTransactionValue?: number; // Minimum USD value to track
    watchedWallets?: string[];    // Specific wallets to monitor
    
    // Market analyzer specific
    indicators?: string[];        // Technical indicators to use
    timeframes?: string[];        // Timeframes to analyze
    
    // Trading strategist specific
    strategies?: string[];        // Trading strategies to employ
    maxPositionSize?: number;     // Max position size percentage
    riskRewardRatio?: number;     // Target risk/reward
    
    // Risk manager specific
    maxDrawdown?: number;         // Max drawdown percentage
    dailyLossLimit?: number;      // Daily loss limit USD
    
    // Custom agent
    systemPrompt?: string;        // Custom LLM system prompt
    tools?: string[];             // Available tools for the agent
  }>(),
  
  // Agent state
  status: mysqlEnum("status", ["active", "paused", "stopped", "error"]).default("stopped").notNull(),
  lastRunAt: timestamp("lastRunAt"),
  nextRunAt: timestamp("nextRunAt"),
  errorMessage: text("errorMessage"),
  
  // Performance metrics
  totalRuns: int("totalRuns").default(0).notNull(),
  successfulRuns: int("successfulRuns").default(0).notNull(),
  totalSignals: int("totalSignals").default(0).notNull(),
  accurateSignals: int("accurateSignals").default(0).notNull(),
  
  // Permissions
  canExecuteTrades: boolean("canExecuteTrades").default(false).notNull(),
  canSendAlerts: boolean("canSendAlerts").default(true).notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  userIdIdx: index("idx_agent_userId").on(table.userId),
  statusIdx: index("idx_agent_status").on(table.status),
  typeIdx: index("idx_agent_type").on(table.agentType)
}));

export type OnchainAgent = typeof onchainAgents.$inferSelect;
export type InsertOnchainAgent = typeof onchainAgents.$inferInsert;

/**
 * Agent Activities table
 * Logs all agent actions, analyses, and decisions
 */
export const agentActivities = mysqlTable("agentActivities", {
  id: int("id").autoincrement().primaryKey(),
  agentId: int("agentId").notNull(),
  userId: int("userId").notNull(),
  
  // Activity type
  activityType: mysqlEnum("activityType", [
    "analysis",           // Market/data analysis
    "signal",             // Trading signal generated
    "alert",              // Alert triggered
    "trade_executed",     // Trade was executed
    "whale_detected",     // Large transaction detected
    "risk_warning",       // Risk threshold breached
    "insight",            // Market insight generated
    "error"               // Error occurred
  ]).notNull(),
  
  // Activity details
  title: varchar("title", { length: 200 }).notNull(),
  summary: text("summary"),
  details: json("details").$type<{
    // Analysis results
    analysis?: string;
    confidence?: number;
    reasoning?: string;
    
    // Signal details
    signal?: "buy" | "sell" | "hold";
    symbol?: string;
    entryPrice?: number;
    targetPrice?: number;
    stopLoss?: number;
    
    // Whale tracking
    transactionHash?: string;
    fromAddress?: string;
    toAddress?: string;
    amount?: number;
    tokenSymbol?: string;
    
    // Trade execution
    tradeId?: number;
    executedPrice?: number;
    quantity?: number;
    
    // Risk data
    riskLevel?: "low" | "medium" | "high" | "critical";
    currentDrawdown?: number;
    
    // LLM interaction
    prompt?: string;
    response?: string;
    tokensUsed?: number;
  }>(),
  
  // Importance and status
  importance: mysqlEnum("importance", ["low", "medium", "high", "critical"]).default("medium").notNull(),
  isRead: boolean("isRead").default(false).notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  agentIdIdx: index("idx_activity_agentId").on(table.agentId),
  userIdIdx: index("idx_activity_userId").on(table.userId),
  typeIdx: index("idx_activity_type").on(table.activityType),
  createdAtIdx: index("idx_activity_createdAt").on(table.createdAt),
  importanceIdx: index("idx_activity_importance").on(table.importance)
}));

export type AgentActivity = typeof agentActivities.$inferSelect;
export type InsertAgentActivity = typeof agentActivities.$inferInsert;

/**
 * Agent Watched Wallets table
 * Stores blockchain wallets being monitored by whale tracker agents
 */
export const agentWatchedWallets = mysqlTable("agentWatchedWallets", {
  id: int("id").autoincrement().primaryKey(),
  agentId: int("agentId").notNull(),
  userId: int("userId").notNull(),
  
  // Wallet info
  address: varchar("address", { length: 100 }).notNull(),
  chain: mysqlEnum("chain", ["ethereum", "bitcoin", "solana", "polygon", "arbitrum", "optimism", "base", "avalanche"]).notNull(),
  label: varchar("label", { length: 100 }), // e.g., "Binance Hot Wallet", "Whale #1"
  
  // Tracking settings
  minTransactionValue: decimal("minTransactionValue", { precision: 20, scale: 2 }).default("100000"), // USD
  trackIncoming: boolean("trackIncoming").default(true).notNull(),
  trackOutgoing: boolean("trackOutgoing").default(true).notNull(),
  
  // Stats
  totalTransactions: int("totalTransactions").default(0).notNull(),
  lastTransactionAt: timestamp("lastTransactionAt"),
  
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  agentIdIdx: index("idx_wallet_agentId").on(table.agentId),
  addressIdx: index("idx_wallet_address").on(table.address),
  chainIdx: index("idx_wallet_chain").on(table.chain)
}));

export type AgentWatchedWallet = typeof agentWatchedWallets.$inferSelect;
export type InsertAgentWatchedWallet = typeof agentWatchedWallets.$inferInsert;

/**
 * On-Chain Agent Trading Signals table
 * Stores trading signals generated by on-chain AI agents
 */
export const onchainAgentSignals = mysqlTable("onchainAgentSignals", {
  id: int("id").autoincrement().primaryKey(),
  agentId: int("agentId").notNull(),
  userId: int("userId").notNull(),
  
  // Signal details
  symbol: varchar("symbol", { length: 20 }).notNull(),
  signal: mysqlEnum("signal", ["strong_buy", "buy", "hold", "sell", "strong_sell"]).notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 2 }).notNull(), // 0.00 to 100.00
  
  // Price targets
  currentPrice: decimal("currentPrice", { precision: 20, scale: 8 }).notNull(),
  entryPrice: decimal("entryPrice", { precision: 20, scale: 8 }),
  targetPrice: decimal("targetPrice", { precision: 20, scale: 8 }),
  stopLoss: decimal("stopLoss", { precision: 20, scale: 8 }),
  
  // Analysis
  reasoning: text("reasoning"),
  indicators: json("indicators").$type<{
    rsi?: number;
    macd?: { value: number; signal: number; histogram: number };
    ema?: { short: number; long: number };
    volume?: { current: number; average: number; ratio: number };
    sentiment?: number;
    whaleActivity?: "accumulating" | "distributing" | "neutral";
  }>(),
  
  // Timeframe and validity
  timeframe: varchar("timeframe", { length: 10 }).notNull(), // "1m", "5m", "1h", "4h", "1d"
  validUntil: timestamp("validUntil").notNull(),
  
  // Outcome tracking
  status: mysqlEnum("status", ["pending", "executed", "expired", "cancelled"]).default("pending").notNull(),
  outcome: mysqlEnum("outcome", ["win", "loss", "breakeven", "pending"]).default("pending").notNull(),
  actualExitPrice: decimal("actualExitPrice", { precision: 20, scale: 8 }),
  pnlPercent: decimal("pnlPercent", { precision: 10, scale: 4 }),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  agentIdIdx: index("idx_oc_signal_agentId").on(table.agentId),
  userIdIdx: index("idx_oc_signal_userId").on(table.userId),
  symbolIdx: index("idx_oc_signal_symbol").on(table.symbol),
  statusIdx: index("idx_oc_signal_status").on(table.status),
  createdAtIdx: index("idx_oc_signal_createdAt").on(table.createdAt)
}));

export type OnchainAgentSignal = typeof onchainAgentSignals.$inferSelect;
export type InsertOnchainAgentSignal = typeof onchainAgentSignals.$inferInsert;


/**
 * Trading Activity Log table
 * Comprehensive audit log for all trading activities including orders placed, filled, rejected
 * This provides a complete audit trail for compliance and debugging purposes
 */
export const tradingActivityLog = mysqlTable("tradingActivityLog", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Activity type
  activityType: mysqlEnum("activityType", [
    "order_placed",
    "order_filled", 
    "order_partially_filled",
    "order_rejected",
    "order_cancelled",
    "order_modified",
    "position_opened",
    "position_closed",
    "stop_loss_triggered",
    "take_profit_triggered",
    "margin_call",
    "balance_check",
    "mode_switch"
  ]).notNull(),
  
  // Trading mode context
  tradingMode: mysqlEnum("tradingMode", ["paper", "live"]).notNull(),
  
  // Order/Trade details
  orderId: varchar("orderId", { length: 64 }),
  tradeId: int("tradeId"),
  positionId: int("positionId"),
  exchangeId: int("exchangeId"),
  
  // Symbol and direction
  symbol: varchar("symbol", { length: 20 }),
  side: mysqlEnum("side", ["buy", "sell", "long", "short"]),
  
  // Order details
  orderType: mysqlEnum("orderType", ["market", "limit", "stop", "stop_limit"]),
  quantity: decimal("quantity", { precision: 20, scale: 8 }),
  price: decimal("price", { precision: 20, scale: 8 }),
  filledQuantity: decimal("filledQuantity", { precision: 20, scale: 8 }),
  filledPrice: decimal("filledPrice", { precision: 20, scale: 8 }),
  
  // Status and result
  status: mysqlEnum("status", ["success", "failed", "pending", "partial"]).notNull(),
  errorCode: varchar("errorCode", { length: 50 }),
  errorMessage: text("errorMessage"),
  
  // Financial details
  fees: decimal("fees", { precision: 20, scale: 8 }),
  pnl: decimal("pnl", { precision: 20, scale: 8 }),
  balanceBefore: decimal("balanceBefore", { precision: 20, scale: 8 }),
  balanceAfter: decimal("balanceAfter", { precision: 20, scale: 8 }),
  
  // Context and metadata
  triggeredBy: mysqlEnum("triggeredBy", ["user", "system", "ai_agent", "stop_loss", "take_profit", "margin_call"]),
  agentId: varchar("agentId", { length: 64 }),
  signalId: int("signalId"),
  metadata: json("metadata").$type<{
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
    latencyMs?: number;
    exchangeOrderId?: string;
    exchangeResponse?: unknown;
    balanceCheckResult?: {
      available: number;
      required: number;
      sufficient: boolean;
    };
    modeSwitchDetails?: {
      fromMode: string;
      toMode: string;
      balanceVerified: boolean;
      verificationResult?: unknown;
    };
  }>(),
  
  // Timestamps
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  executedAt: timestamp("executedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  userIdIdx: index("idx_activity_userId").on(table.userId),
  activityTypeIdx: index("idx_activity_type").on(table.activityType),
  tradingModeIdx: index("idx_activity_tradingMode").on(table.tradingMode),
  symbolIdx: index("idx_activity_symbol").on(table.symbol),
  statusIdx: index("idx_activity_status").on(table.status),
  timestampIdx: index("idx_activity_timestamp").on(table.timestamp),
  orderIdIdx: index("idx_activity_orderId").on(table.orderId)
}));

export type TradingActivityLog = typeof tradingActivityLog.$inferSelect;
export type InsertTradingActivityLog = typeof tradingActivityLog.$inferInsert;

/**
 * Balance Verification Log table
 * Records all balance verification attempts before live trading mode switches
 */
export const balanceVerificationLog = mysqlTable("balanceVerificationLog", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  exchangeId: int("exchangeId").notNull(),
  
  // Verification details
  verificationType: mysqlEnum("verificationType", ["pre_live_switch", "pre_trade", "periodic_check", "manual_check"]).notNull(),
  
  // Balance information
  availableBalance: decimal("availableBalance", { precision: 20, scale: 8 }).notNull(),
  totalBalance: decimal("totalBalance", { precision: 20, scale: 8 }).notNull(),
  marginUsed: decimal("marginUsed", { precision: 20, scale: 8 }),
  currency: varchar("currency", { length: 10 }).notNull(),
  
  // Verification result
  minimumRequired: decimal("minimumRequired", { precision: 20, scale: 8 }).notNull(),
  isVerified: boolean("isVerified").notNull(),
  verificationMessage: text("verificationMessage"),
  
  // Action taken
  actionAllowed: boolean("actionAllowed").notNull(),
  actionBlocked: boolean("actionBlocked").notNull(),
  blockReason: text("blockReason"),
  
  // Exchange response
  exchangeResponse: json("exchangeResponse"),
  latencyMs: int("latencyMs"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  userIdIdx: index("idx_balance_ver_userId").on(table.userId),
  exchangeIdIdx: index("idx_balance_ver_exchangeId").on(table.exchangeId),
  verificationTypeIdx: index("idx_balance_ver_type").on(table.verificationType),
  createdAtIdx: index("idx_balance_ver_createdAt").on(table.createdAt)
}));

export type BalanceVerificationLog = typeof balanceVerificationLog.$inferSelect;
export type InsertBalanceVerificationLog = typeof balanceVerificationLog.$inferInsert;


/**
 * Trade Decision Logs table
 * Comprehensive audit trail of all trading decisions with full agent breakdown
 * Captures every signal, execution decision, and trade outcome for analysis
 */
export const tradeDecisionLogs = mysqlTable("tradeDecisionLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().default(1), // Default to system user for automated processes
  
  // Signal Identification
  signalId: varchar("signalId", { length: 64 }).notNull(), // Unique signal identifier
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  
  // Market Context
  symbol: varchar("symbol", { length: 20 }).notNull(), // e.g., "BTC-USD"
  exchange: varchar("exchange", { length: 50 }).notNull(), // e.g., "coinbase"
  price: varchar({ length: 50 }).notNull(), // Price at decision time
  
  // Signal Details
  signalType: mysqlEnum("signalType", ["BUY", "SELL", "HOLD"]).notNull(),
  signalStrength: varchar({ length: 50 }), // Raw signal strength 0-100
  
  // Consensus Metrics
  fastScore: varchar({ length: 50 }), // Fast agents weighted score (0-100)
  slowBonus: varchar({ length: 50 }), // Slow agents bonus (0-20)
  totalConfidence: varchar({ length: 50 }).notNull(), // Final confidence score (0-100)
  threshold: varchar({ length: 50 }).notNull(), // Required threshold to execute
  
  // Agent Breakdown (JSON object with each agent's contribution)
  agentScores: json("agentScores").notNull(), // { agentName: { score, weight, signal, confidence, reasoning } }
  
  // Decision Outcome
  decision: mysqlEnum("decision", [
    "EXECUTED",      // Trade was executed
    "SKIPPED",       // Below threshold, not executed
    "VETOED",        // Vetoed by risk management or user
    "PENDING",       // Awaiting execution
    "FAILED",        // Execution failed
    "PARTIAL"        // Partially executed
  ]).notNull(),
  decisionReason: text("decisionReason"), // Why the decision was made
  
  // Execution Details (populated if executed)
  positionId: int("positionId"), // Reference to position if opened
  orderId: varchar("orderId", { length: 100 }), // Exchange order ID
  entryPrice: varchar({ length: 50 }), // Actual entry price
  quantity: varchar({ length: 50 }), // Position size
  positionSizePercent: varchar({ length: 50 }), // % of portfolio
  
  // Exit Details (populated when position closed)
  exitPrice: varchar({ length: 50 }),
  exitTime: timestamp("exitTime"),
  exitReason: mysqlEnum("exitReason", [
    "take_profit",
    "stop_loss",
    "trailing_stop",
    "signal_reversal",
    "manual",
    "timeout",
    "risk_limit"
  ]),
  
  // P&L (populated when position closed)
  pnl: varchar({ length: 50 }), // Absolute P&L in USD
  pnlPercent: varchar({ length: 50 }), // Percentage P&L
  
  // Trade Status
  status: mysqlEnum("status", [
    "SIGNAL_GENERATED",  // Signal was generated
    "DECISION_MADE",     // Decision to execute/skip was made
    "POSITION_OPENED",   // Position was opened
    "POSITION_CLOSED",   // Position was closed
    "OPPORTUNITY_MISSED" // Good signal but wasn't executed (for analysis)
  ]).notNull(),
  
  // Market Conditions at Decision Time
  marketConditions: json("marketConditions"), // { volatility, trend, volume, regime }
  
  // Performance Tracking
  holdDuration: int("holdDuration"), // Seconds position was held
  maxDrawdown: varchar({ length: 50 }), // Max drawdown during trade
  maxProfit: varchar({ length: 50 }), // Max unrealized profit during trade
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  userIdIdx: index("idx_tdl_userId").on(table.userId),
  symbolIdx: index("idx_tdl_symbol").on(table.symbol),
  timestampIdx: index("idx_tdl_timestamp").on(table.timestamp),
  decisionIdx: index("idx_tdl_decision").on(table.decision),
  statusIdx: index("idx_tdl_status").on(table.status),
  signalTypeIdx: index("idx_tdl_signalType").on(table.signalType)
}));

export type TradeDecisionLog = typeof tradeDecisionLogs.$inferSelect;
export type InsertTradeDecisionLog = typeof tradeDecisionLogs.$inferInsert;


/**
 * Tick-level price data storage
 * Stores EVERY price tick for millisecond-level trading analysis
 * This is the single source of truth for all historical tick data
 */
export const ticks = mysqlTable("ticks", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  price: varchar("price", { length: 50 }).notNull(),
  volume: varchar("volume", { length: 50 }),
  bid: varchar("bid", { length: 50 }),
  ask: varchar("ask", { length: 50 }),
  timestampMs: bigint("timestampMs", { mode: "number" }).notNull(),
  source: mysqlEnum("source", ["coinapi", "coinbase", "binance", "coingecko", "rest_backfill", "rest_fallback"]).default("coinbase").notNull(),
  sequenceNumber: bigint("sequenceNumber", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  symbolTimeIdx: index("idx_ticks_symbol_time").on(table.symbol, table.timestampMs),
  symbolSeqIdx: index("idx_ticks_symbol_seq").on(table.symbol, table.sequenceNumber),
  timeIdx: index("idx_ticks_time").on(table.timestampMs)
}));

export type Tick = typeof ticks.$inferSelect;
export type InsertTick = typeof ticks.$inferInsert;

/**
 * Data gap logging for recovery tracking
 * Tracks sequence gaps in WebSocket data for automatic recovery
 */
export const dataGapLogs = mysqlTable("dataGapLogs", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  gapStartMs: bigint("gapStartMs", { mode: "number" }).notNull(),
  gapEndMs: bigint("gapEndMs", { mode: "number" }).notNull(),
  expectedSequence: bigint("expectedSequence", { mode: "number" }),
  actualSequence: bigint("actualSequence", { mode: "number" }),
  missedTicksEstimate: int("missedTicksEstimate").default(0).notNull(),
  recoveryStatus: mysqlEnum("recoveryStatus", ["pending", "recovering", "recovered", "failed"]).default("pending").notNull(),
  recoveryAttempts: int("recoveryAttempts").default(0).notNull(),
  recoveredAt: timestamp("recoveredAt"),
  detectedBy: varchar("detectedBy", { length: 50 }).default("coinapi_websocket").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  symbolStatusIdx: index("idx_gap_symbol_status").on(table.symbol, table.recoveryStatus),
  timeIdx: index("idx_gap_time").on(table.gapStartMs)
}));

export type DataGapLog = typeof dataGapLogs.$inferSelect;
export type InsertDataGapLog = typeof dataGapLogs.$inferInsert;


/**
 * Archived Ticks table
 * Long-term storage for tick data older than 30 days
 * Preserves historical data while keeping the main ticks table performant
 */
export const archivedTicks = mysqlTable("archived_ticks", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  price: varchar("price", { length: 50 }).notNull(),
  volume: varchar("volume", { length: 50 }),
  bid: varchar("bid", { length: 50 }),
  ask: varchar("ask", { length: 50 }),
  timestampMs: bigint("timestampMs", { mode: "number" }).notNull(),
  source: mysqlEnum("source", ["coinapi", "coinbase", "binance", "coingecko", "rest_backfill", "rest_fallback"]).default("coinbase").notNull(),
  sequenceNumber: bigint("sequenceNumber", { mode: "number" }),
  archivedAt: timestamp("archivedAt").defaultNow().notNull()
}, (table) => ({
  symbolTimeIdx: index("idx_archived_ticks_symbol_time").on(table.symbol, table.timestampMs),
  archivedAtIdx: index("idx_archived_ticks_archived_at").on(table.archivedAt)
}));

export type ArchivedTick = typeof archivedTicks.$inferSelect;
export type InsertArchivedTick = typeof archivedTicks.$inferInsert;

/**
 * Tick Cleanup Logs table
 * Tracks cleanup operations for auditing and monitoring
 */
export const tickCleanupLogs = mysqlTable("tick_cleanup_logs", {
  id: int("id").autoincrement().primaryKey(),
  startedAt: timestamp("startedAt").notNull(),
  completedAt: timestamp("completedAt"),
  status: mysqlEnum("status", ["running", "completed", "failed"]).default("running").notNull(),
  ticksArchived: int("ticksArchived").default(0).notNull(),
  ticksDeleted: int("ticksDeleted").default(0).notNull(),
  oldestTickArchived: bigint("oldestTickArchived", { mode: "number" }),
  newestTickArchived: bigint("newestTickArchived", { mode: "number" }),
  executionTimeMs: int("executionTimeMs"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});

export type TickCleanupLog = typeof tickCleanupLogs.$inferSelect;
export type InsertTickCleanupLog = typeof tickCleanupLogs.$inferInsert;


/**
 * Execution Latency Logs table
 * Tracks end-to-end latency for the entire signal-to-trade pipeline
 * Critical for identifying bottlenecks and optimizing for sub-100ms execution
 */
export const executionLatencyLogs = mysqlTable("executionLatencyLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Signal Identification
  signalId: varchar("signalId", { length: 64 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  
  // Pipeline Stage Timestamps (milliseconds since epoch)
  signalGeneratedAt: bigint("signalGeneratedAt", { mode: "number" }).notNull(),
  consensusCalculatedAt: bigint("consensusCalculatedAt", { mode: "number" }),
  decisionMadeAt: bigint("decisionMadeAt", { mode: "number" }),
  orderPlacedAt: bigint("orderPlacedAt", { mode: "number" }),
  orderFilledAt: bigint("orderFilledAt", { mode: "number" }),
  
  // Latency Breakdown (milliseconds)
  signalToConsensusMs: int("signalToConsensusMs"),
  consensusToDecisionMs: int("consensusToDecisionMs"),
  decisionToOrderMs: int("decisionToOrderMs"),
  orderToFillMs: int("orderToFillMs"),
  totalLatencyMs: int("totalLatencyMs").notNull(),
  
  // Execution Result
  executionResult: mysqlEnum("executionResult", [
    "executed",
    "rejected",
    "skipped",
    "failed",
    "timeout"
  ]).notNull(),
  
  // Additional Context
  agentCount: int("agentCount").notNull(),
  consensusStrength: varchar({ length: 50 }),
  priceAtSignal: varchar({ length: 50 }),
  priceAtExecution: varchar({ length: 50 }),
  slippageMs: int("slippageMs"), // Time-based slippage
  
  // Performance Classification
  latencyGrade: mysqlEnum("latencyGrade", [
    "excellent",  // < 50ms
    "good",       // 50-100ms
    "acceptable", // 100-250ms
    "slow",       // 250-500ms
    "critical"    // > 500ms
  ]).notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  userIdIdx: index("idx_ell_userId").on(table.userId),
  symbolIdx: index("idx_ell_symbol").on(table.symbol),
  latencyGradeIdx: index("idx_ell_latencyGrade").on(table.latencyGrade),
  createdAtIdx: index("idx_ell_createdAt").on(table.createdAt),
  totalLatencyIdx: index("idx_ell_totalLatency").on(table.totalLatencyMs)
}));

export type ExecutionLatencyLog = typeof executionLatencyLogs.$inferSelect;
export type InsertExecutionLatencyLog = typeof executionLatencyLogs.$inferInsert;


/**
 * Waitlist table
 * Stores interested users who want early access to the platform
 */
export const waitlist = mysqlTable("waitlist", {
  id: int("id").autoincrement().primaryKey(),
  
  // Contact Information
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  phone: varchar("phone", { length: 50 }),
  country: varchar("country", { length: 100 }).notNull(),
  
  // User Type
  userType: mysqlEnum("userType", [
    "retail_trader",
    "institutional",
    "fund_manager",
    "other"
  ]).notNull(),
  
  // Selected Plan (if any)
  selectedPlan: mysqlEnum("selectedPlan", [
    "starter",
    "professional",
    "enterprise"
  ]),
  
  // Status
  status: mysqlEnum("status", [
    "pending",      // Just signed up
    "contacted",    // We've reached out
    "invited",      // Sent invite
    "converted"     // Became a user
  ]).default("pending").notNull(),
  
  // Tracking
  source: varchar("source", { length: 100 }), // Where they came from (landing, pricing, etc.)
  notes: text("notes"), // Admin notes
  
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  invitedAt: timestamp("invitedAt"),
  convertedAt: timestamp("convertedAt")
}, (table) => ({
  emailIdx: index("idx_waitlist_email").on(table.email),
  statusIdx: index("idx_waitlist_status").on(table.status),
  userTypeIdx: index("idx_waitlist_userType").on(table.userType),
  createdAtIdx: index("idx_waitlist_createdAt").on(table.createdAt)
}));

export type Waitlist = typeof waitlist.$inferSelect;
export type InsertWaitlist = typeof waitlist.$inferInsert;


// ============================================================================
// COMPREHENSIVE LOGGING FRAMEWORK TABLES
// Purpose: 24/7 operations verification, connection monitoring, trade tracking,
//          capital optimization, and alert management
// Added: February 6, 2026
// ============================================================================

/**
 * System Heartbeat - P0 CRITICAL
 * Proves the system is alive and processing every minute.
 * If no heartbeat for 5 minutes → system is down.
 */
export const systemHeartbeat = mysqlTable("systemHeartbeat", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  serviceName: varchar("serviceName", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(), // 'healthy', 'degraded', 'down'
  lastTickTime: timestamp("lastTickTime"),
  ticksProcessedLastMinute: int("ticksProcessedLastMinute").default(0),
  positionsCheckedLastMinute: int("positionsCheckedLastMinute").default(0),
  cpuPercent: decimal("cpuPercent", { precision: 5, scale: 2 }),
  memoryMb: int("memoryMb"),
  activeThreads: int("activeThreads"),
  uptimeSeconds: bigint("uptimeSeconds", { mode: "number" }),
  lastRestartTime: timestamp("lastRestartTime"),
  restartReason: varchar("restartReason", { length: 255 }),
  openPositionsCount: int("openPositionsCount"),
  activeAgentsCount: int("activeAgentsCount"),
}, (table) => ({
  timestampIdx: index("idx_shb_timestamp").on(table.timestamp),
  serviceIdx: index("idx_shb_service").on(table.serviceName),
  statusIdx: index("idx_shb_status").on(table.status),
}));

export type SystemHeartbeat = typeof systemHeartbeat.$inferSelect;
export type InsertSystemHeartbeat = typeof systemHeartbeat.$inferInsert;

/**
 * Service Events - P0 CRITICAL
 * Tracks when services start, stop, crash, or restart.
 * Multiple starts/restarts per day = PROBLEM.
 */
export const serviceEvents = mysqlTable("serviceEvents", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  serviceName: varchar("serviceName", { length: 100 }).notNull(),
  eventType: varchar("eventType", { length: 20 }).notNull(), // 'start', 'stop', 'crash', 'restart', 'config_reload'
  reason: text("reason"),
  errorMessage: text("errorMessage"),
  stackTrace: mediumtext("stackTrace"),
  version: varchar("version", { length: 50 }),
  gitCommit: varchar("gitCommit", { length: 40 }),
  nodeVersion: varchar("nodeVersion", { length: 20 }),
  environment: varchar("environment", { length: 20 }),
}, (table) => ({
  timestampIdx: index("idx_se_timestamp").on(table.timestamp),
  serviceIdx: index("idx_se_service").on(table.serviceName),
  eventTypeIdx: index("idx_se_eventType").on(table.eventType),
}));

export type ServiceEvent = typeof serviceEvents.$inferSelect;
export type InsertServiceEvent = typeof serviceEvents.$inferInsert;

/**
 * API Connection Log - P0 CRITICAL
 * Tracks all API connections and detects failures.
 * Success rate should be >99%, avg response <1000ms.
 */
export const apiConnectionLog = mysqlTable("apiConnectionLog", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  apiName: varchar("apiName", { length: 100 }).notNull(),
  connectionStatus: varchar("connectionStatus", { length: 20 }).notNull(), // 'connected', 'disconnected', 'timeout', 'rate_limited', 'error'
  connectionAttemptTime: timestamp("connectionAttemptTime"),
  connectionEstablishedTime: timestamp("connectionEstablishedTime"),
  connectionDurationMs: int("connectionDurationMs"),
  responseTimeMs: int("responseTimeMs"),
  statusCode: int("statusCode"),
  errorMessage: text("errorMessage"),
  affectedSymbols: varchar("affectedSymbols", { length: 255 }),
  affectedOperations: varchar("affectedOperations", { length: 255 }),
}, (table) => ({
  timestampIdx: index("idx_acl_timestamp").on(table.timestamp),
  apiNameIdx: index("idx_acl_apiName").on(table.apiName),
  statusIdx: index("idx_acl_status").on(table.connectionStatus),
}));

export type ApiConnectionLog = typeof apiConnectionLog.$inferSelect;
export type InsertApiConnectionLog = typeof apiConnectionLog.$inferInsert;

/**
 * WebSocket Health Log - P0 CRITICAL
 * Monitors WebSocket connections for real-time data.
 * Alert if: minutes_since_last_message > 5, reconnection_attempts > 5
 */
export const websocketHealthLog = mysqlTable("websocketHealthLog", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  websocketName: varchar("websocketName", { length: 100 }).notNull(),
  connectionStatus: varchar("connectionStatus", { length: 20 }).notNull(), // 'connected', 'disconnected', 'reconnecting', 'error'
  lastMessageTime: timestamp("lastMessageTime"),
  messagesReceivedLastMinute: int("messagesReceivedLastMinute"),
  messagesMissed: int("messagesMissed"),
  pingMs: int("pingMs"),
  avgMessageDelayMs: int("avgMessageDelayMs"),
  reconnectionAttempts: int("reconnectionAttempts"),
  lastReconnectTime: timestamp("lastReconnectTime"),
}, (table) => ({
  timestampIdx: index("idx_whl_timestamp").on(table.timestamp),
  websocketIdx: index("idx_whl_websocket").on(table.websocketName),
  statusIdx: index("idx_whl_status").on(table.connectionStatus),
}));

export type WebsocketHealthLog = typeof websocketHealthLog.$inferSelect;
export type InsertWebsocketHealthLog = typeof websocketHealthLog.$inferInsert;

/**
 * Exit Decision Log - P1 HIGH
 * Logs detailed exit decision analysis for each position check.
 * Validates exit system is working correctly.
 */
export const exitDecisionLog = mysqlTable("exitDecisionLog", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  positionId: int("positionId").notNull(),
  exitChecks: json("exitChecks").notNull(), // Array of { checkName, result, details }
  triggeredExit: varchar("triggeredExit", { length: 100 }),
  priority: int("priority"),
  currentPrice: decimal("currentPrice", { precision: 20, scale: 8 }),
  unrealizedPnl: decimal("unrealizedPnl", { precision: 20, scale: 8 }),
  unrealizedPnlPercent: decimal("unrealizedPnlPercent", { precision: 10, scale: 6 }),
  holdTimeMinutes: int("holdTimeMinutes"),
  currentConsensus: decimal("currentConsensus", { precision: 5, scale: 4 }),
  entryConsensus: decimal("entryConsensus", { precision: 5, scale: 4 }),
  metadata: json("metadata"),
}, (table) => ({
  timestampIdx: index("idx_edl_timestamp").on(table.timestamp),
  positionIdx: index("idx_edl_positionId").on(table.positionId),
  triggeredExitIdx: index("idx_edl_triggeredExit").on(table.triggeredExit),
}));

export type ExitDecisionLog = typeof exitDecisionLog.$inferSelect;
export type InsertExitDecisionLog = typeof exitDecisionLog.$inferInsert;

/**
 * Capital Utilization - P1 HIGH
 * Tracks how much of $20,000 capital is deployed vs idle.
 * Optimal range: 60-80% utilization.
 */
export const capitalUtilization = mysqlTable("capitalUtilization", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  totalCapital: decimal("totalCapital", { precision: 20, scale: 2 }).notNull(),
  deployedCapital: decimal("deployedCapital", { precision: 20, scale: 2 }).notNull(),
  idleCapital: decimal("idleCapital", { precision: 20, scale: 2 }).notNull(),
  reservedCapital: decimal("reservedCapital", { precision: 20, scale: 2 }),
  utilizationPercent: decimal("utilizationPercent", { precision: 5, scale: 2 }),
  openPositionsCount: int("openPositionsCount"),
  totalPositionValue: decimal("totalPositionValue", { precision: 20, scale: 2 }),
  avgPositionSize: decimal("avgPositionSize", { precision: 20, scale: 2 }),
  largestPositionSize: decimal("largestPositionSize", { precision: 20, scale: 2 }),
  totalRiskExposure: decimal("totalRiskExposure", { precision: 20, scale: 2 }),
  riskPercent: decimal("riskPercent", { precision: 5, scale: 2 }),
}, (table) => ({
  timestampIdx: index("idx_cu_timestamp").on(table.timestamp),
}));

export type CapitalUtilization = typeof capitalUtilization.$inferSelect;
export type InsertCapitalUtilization = typeof capitalUtilization.$inferInsert;

/**
 * Position Sizing Log - P1 HIGH
 * Records why each position was sized the way it was.
 * Identifies if constraints are limiting profits.
 */
export const positionSizingLog = mysqlTable("positionSizingLog", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  positionId: int("positionId"),
  symbol: varchar("symbol", { length: 20 }),
  side: varchar("side", { length: 10 }),
  intendedRiskAmount: decimal("intendedRiskAmount", { precision: 20, scale: 2 }),
  intendedRiskPercent: decimal("intendedRiskPercent", { precision: 5, scale: 4 }),
  stopLossDistance: decimal("stopLossDistance", { precision: 20, scale: 8 }),
  calculatedSize: decimal("calculatedSize", { precision: 20, scale: 8 }),
  sizeBeforeConstraints: decimal("sizeBeforeConstraints", { precision: 20, scale: 8 }),
  sizeAfterConstraints: decimal("sizeAfterConstraints", { precision: 20, scale: 8 }),
  constraintsApplied: json("constraintsApplied"),
  finalSize: decimal("finalSize", { precision: 20, scale: 8 }),
  finalCapitalUsed: decimal("finalCapitalUsed", { precision: 20, scale: 2 }),
  finalCapitalPercent: decimal("finalCapitalPercent", { precision: 5, scale: 2 }),
  accountBalance: decimal("accountBalance", { precision: 20, scale: 2 }),
  availableCapital: decimal("availableCapital", { precision: 20, scale: 2 }),
  openPositionsCount: int("openPositionsCount"),
}, (table) => ({
  timestampIdx: index("idx_psl_timestamp").on(table.timestamp),
  positionIdx: index("idx_psl_positionId").on(table.positionId),
}));

export type PositionSizingLog = typeof positionSizingLog.$inferSelect;
export type InsertPositionSizingLog = typeof positionSizingLog.$inferInsert;

/**
 * Entry Validation Log - P2 MEDIUM
 * Tracks why entries were taken or skipped.
 * Helps optimize entry criteria.
 */
export const entryValidationLog = mysqlTable("entryValidationLog", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  symbol: varchar("symbol", { length: 20 }),
  consensusStrength: decimal("consensusStrength", { precision: 5, scale: 4 }),
  priceConfirmation: int("priceConfirmation"), // 0 or 1
  trendAlignment: int("trendAlignment"), // 0 or 1
  volumeConfirmation: int("volumeConfirmation"), // 0 or 1
  historicalEdge: int("historicalEdge"), // 0 or 1
  finalDecision: varchar("finalDecision", { length: 20 }),
  skipReason: text("skipReason"),
  agentSignals: json("agentSignals"), // Snapshot of agent signals at entry
  metadata: json("metadata"),
}, (table) => ({
  timestampIdx: index("idx_evl_timestamp").on(table.timestamp),
  symbolIdx: index("idx_evl_symbol").on(table.symbol),
  decisionIdx: index("idx_evl_decision").on(table.finalDecision),
}));

export type EntryValidationLog = typeof entryValidationLog.$inferSelect;
export type InsertEntryValidationLog = typeof entryValidationLog.$inferInsert;

/**
 * Alert Log - P2 MEDIUM
 * Tracks all alerts sent and ensures they're being received.
 * Verifies notification delivery.
 */
export const alertLog = mysqlTable("alertLog", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  alertType: varchar("alertType", { length: 100 }).notNull(),
  severity: varchar("severity", { length: 20 }).notNull(), // 'info', 'warning', 'critical'
  title: varchar("title", { length: 255 }),
  message: text("message"),
  deliveryMethod: varchar("deliveryMethod", { length: 20 }).notNull(), // 'email', 'console', 'notification'
  deliveryStatus: varchar("deliveryStatus", { length: 20 }).notNull(), // 'sent', 'failed', 'pending'
  deliveredAt: timestamp("deliveredAt"),
  relatedEntityType: varchar("relatedEntityType", { length: 50 }),
  relatedEntityId: varchar("relatedEntityId", { length: 100 }),
  metadata: json("metadata"),
}, (table) => ({
  timestampIdx: index("idx_al_timestamp").on(table.timestamp),
  alertTypeIdx: index("idx_al_alertType").on(table.alertType),
  severityIdx: index("idx_al_severity").on(table.severity),
}));

export type AlertLog = typeof alertLog.$inferSelect;
export type InsertAlertLog = typeof alertLog.$inferInsert;

/**
 * Phase 14A: Global Symbols Table
 * Tracks which symbols the platform observes globally via GlobalMarketEngine.
 * Each symbol gets one GlobalSymbolAnalyzer with 29 agents, shared across ALL users.
 */
export const globalSymbols = mysqlTable("globalSymbols", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull().unique(),
  exchange: varchar("exchange", { length: 50 }).notNull().default("coinbase"),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GlobalSymbol = typeof globalSymbols.$inferSelect;
export type InsertGlobalSymbol = typeof globalSymbols.$inferInsert;


// ─── Previously raw-SQL tables — now Drizzle-managed ───────────────────────

/**
 * Consensus history — records every consensus decision from StrategyOrchestrator.
 * Previously accessed via raw SQL in ConsensusRecorder.ts.
 */
export const consensusHistory = mysqlTable("consensusHistory", {
  id: int("id").autoincrement().primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  finalSignal: mysqlEnum("finalSignal", ["BULLISH", "BEARISH", "NEUTRAL"]).notNull(),
  finalConfidence: int("finalConfidence").notNull(),
  consensusPercentage: int("consensusPercentage").notNull(),
  bullishVotes: int("bullishVotes").notNull().default(0),
  bearishVotes: int("bearishVotes").notNull().default(0),
  neutralVotes: int("neutralVotes").notNull().default(0),
  agentVotes: text("agentVotes"),
  tradeId: int("tradeId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ConsensusHistoryRow = typeof consensusHistory.$inferSelect;
export type InsertConsensusHistory = typeof consensusHistory.$inferInsert;

/**
 * Historical OHLCV candle data — used by ComprehensiveBacktestEngine.
 * Previously accessed via raw SQL in backtest engines.
 */
export const historicalOHLCV = mysqlTable("historicalOHLCV", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timeframe: mysqlEnum("timeframe", ["1m", "5m", "15m", "1h", "4h", "1d"]).notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  open: varchar("open", { length: 50 }).notNull(),
  high: varchar("high", { length: 50 }).notNull(),
  low: varchar("low", { length: 50 }).notNull(),
  close: varchar("close", { length: 50 }).notNull(),
  volume: varchar("volume", { length: 50 }).notNull(),
  source: varchar("source", { length: 20 }).notNull().default("coinbase"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type HistoricalOHLCVRow = typeof historicalOHLCV.$inferSelect;
export type InsertHistoricalOHLCV = typeof historicalOHLCV.$inferInsert;

/**
 * System settings — key-value store for runtime configuration.
 * Previously accessed via raw SQL in MLIntegrationService.ts.
 */
export const systemSettings = mysqlTable("systemSettings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 255 }).notNull().unique(),
  value: text("value"),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
});

export type SystemSettingsRow = typeof systemSettings.$inferSelect;
export type InsertSystemSettings = typeof systemSettings.$inferInsert;

/**
 * Price History table — unified OHLCV storage for RL Training Pipeline.
 * 
 * This table is the canonical source for the RLTrainingPipeline to load
 * historical candle data for model training. It stores 1-minute candles
 * aggregated from the live WebSocket feed (Coinbase/Binance).
 * 
 * Design decisions:
 * - Uses bigint timestamp (ms epoch) for fast range queries and RL compatibility
 * - Composite unique index on (symbol, timestamp) prevents duplicate candles
 * - varchar for OHLCV to preserve decimal precision (same pattern as historicalCandles)
 * - source field tracks data provenance (coinbase, binance, backfill)
 */
export const priceHistory = mysqlTable("priceHistory", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  open: varchar("open", { length: 50 }).notNull(),
  high: varchar("high", { length: 50 }).notNull(),
  low: varchar("low", { length: 50 }).notNull(),
  close: varchar("close", { length: 50 }).notNull(),
  volume: varchar("volume", { length: 50 }).notNull(),
  source: varchar("source", { length: 20 }).notNull().default("coinbase"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  idx_priceHistory_symbol_ts: uniqueIndex("idx_priceHistory_symbol_ts").on(table.symbol, table.timestamp),
  idx_priceHistory_symbol: index("idx_priceHistory_symbol").on(table.symbol),
}));

export type PriceHistoryRow = typeof priceHistory.$inferSelect;
export type InsertPriceHistory = typeof priceHistory.$inferInsert;

// ============================================================================
// PHASE 22: COMPREHENSIVE AUDIT LOG TABLES
// Purpose: Prove 24/7/365 system liveness and capture every workflow for audit.
// Without this data in DB, uptime claims are unverifiable ("just fluff").
// Added: February 27, 2026
// ============================================================================

/**
 * Tick Heartbeat Log — Proves WebSocket data is flowing 24/7/365.
 * Every 60 seconds: count ticks received per symbol, record last price.
 * If no row for 2+ minutes → WebSocket is dead.
 */
export const tickHeartbeat = mysqlTable("tickHeartbeat", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  tickCount: int("tickCount").notNull().default(0),
  lastPrice: decimal("lastPrice", { precision: 20, scale: 8 }),
  lastTickTime: timestamp("lastTickTime"),
  priceHigh: decimal("priceHigh", { precision: 20, scale: 8 }),
  priceLow: decimal("priceLow", { precision: 20, scale: 8 }),
  avgSpreadMs: int("avgSpreadMs"),        // avg time between ticks
  source: varchar("source", { length: 30 }).default("coinbase"),
}, (table) => ({
  timestampIdx: index("idx_th_timestamp").on(table.timestamp),
  symbolIdx: index("idx_th_symbol").on(table.symbol),
  symbolTsIdx: index("idx_th_symbol_ts").on(table.symbol, table.timestamp),
}));

export type TickHeartbeat = typeof tickHeartbeat.$inferSelect;
export type InsertTickHeartbeat = typeof tickHeartbeat.$inferInsert;

/**
 * Agent Signal Log — Every signal from every agent stored in DB.
 * Proves agents are generating non-zero signals when ticks flow.
 * Key audit query: "show me all signals for BTC-USD in the last hour"
 */
export const agentSignalLog = mysqlTable("agentSignalLog", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  agentName: varchar("agentName", { length: 80 }).notNull(),
  agentCategory: varchar("agentCategory", { length: 20 }).notNull(), // 'fast', 'slow', 'pattern'
  signal: varchar("signal", { length: 10 }).notNull(),               // 'bullish', 'bearish', 'neutral'
  confidence: decimal("confidence", { precision: 5, scale: 4 }).notNull(),
  reasoning: text("reasoning"),
  executionTimeMs: int("executionTimeMs"),
  dataSource: varchar("dataSource", { length: 50 }),                  // 'live_tick', 'periodic', 'rss', etc.
  isSynthetic: boolean("isSynthetic").default(false),
}, (table) => ({
  timestampIdx: index("idx_asl_timestamp").on(table.timestamp),
  symbolIdx: index("idx_asl_symbol").on(table.symbol),
  agentIdx: index("idx_asl_agent").on(table.agentName),
  symbolTsIdx: index("idx_asl_symbol_ts").on(table.symbol, table.timestamp),
}));

export type AgentSignalLog = typeof agentSignalLog.$inferSelect;
export type InsertAgentSignalLog = typeof agentSignalLog.$inferInsert;

/**
 * Consensus Log — Tracks consensus flow per analysis cycle.
 * Even when consensus doesn't reach trade threshold, we record the movement.
 * Key audit query: "show consensus trend for BTC-USD over last 4 hours"
 */
export const consensusLog = mysqlTable("consensusLog", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  bullishCount: int("bullishCount").notNull().default(0),
  bearishCount: int("bearishCount").notNull().default(0),
  neutralCount: int("neutralCount").notNull().default(0),
  bullishStrength: decimal("bullishStrength", { precision: 8, scale: 4 }),
  bearishStrength: decimal("bearishStrength", { precision: 8, scale: 4 }),
  netDirection: varchar("netDirection", { length: 10 }).notNull(),     // 'bullish', 'bearish', 'neutral'
  consensusConfidence: decimal("consensusConfidence", { precision: 5, scale: 4 }),
  threshold: decimal("threshold", { precision: 5, scale: 4 }),
  meetsThreshold: boolean("meetsThreshold").default(false),
  fastAgentScore: decimal("fastAgentScore", { precision: 8, scale: 4 }),
  slowAgentBonus: decimal("slowAgentBonus", { precision: 8, scale: 4 }),
  agentBreakdown: json("agentBreakdown"),  // { agentName: { signal, confidence, weight } }
}, (table) => ({
  timestampIdx: index("idx_cl_timestamp").on(table.timestamp),
  symbolIdx: index("idx_cl_symbol").on(table.symbol),
  directionIdx: index("idx_cl_direction").on(table.netDirection),
  symbolTsIdx: index("idx_cl_symbol_ts").on(table.symbol, table.timestamp),
}));

export type ConsensusLog = typeof consensusLog.$inferSelect;
export type InsertConsensusLog = typeof consensusLog.$inferInsert;

/**
 * Trade Decision Log — Every trade signal: picked, rejected, or missed, with reasons.
 * Captures the FULL agent signal snapshot at decision time.
 * Key audit query: "why was signal X rejected?" or "how many signals passed VaR gate?"
 */
export const tradeDecisionLog = mysqlTable("tradeDecisionLog", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  decision: varchar("decision", { length: 20 }).notNull(),            // 'executed', 'rejected', 'missed'
  direction: varchar("direction", { length: 10 }),                      // 'long', 'short'
  consensusConfidence: decimal("consensusConfidence", { precision: 5, scale: 4 }),
  rejectReason: text("rejectReason"),                                   // e.g., 'circuit_breaker', 'var_gate', 'entry_validation'
  rejectStage: varchar("rejectStage", { length: 50 }),                 // pipeline stage that rejected
  entryPrice: decimal("entryPrice", { precision: 20, scale: 8 }),
  positionSize: decimal("positionSize", { precision: 20, scale: 8 }),
  varResult: json("varResult"),                                         // VaR gate result snapshot
  agentSignals: json("agentSignals"),                                   // Full agent signal snapshot
  pipelineStages: json("pipelineStages"),                              // { stage: pass/fail, details }
}, (table) => ({
  timestampIdx: index("idx_atdl_timestamp").on(table.timestamp),
  symbolIdx: index("idx_atdl_symbol").on(table.symbol),
  decisionIdx: index("idx_atdl_decision").on(table.decision),
  symbolTsIdx: index("idx_atdl_symbol_ts").on(table.symbol, table.timestamp),
}));

export type AuditTradeDecisionLog = typeof tradeDecisionLog.$inferSelect;
export type InsertAuditTradeDecisionLog = typeof tradeDecisionLog.$inferInsert;

/**
 * Slow Agent Log — Proves periodic agents (slow + pattern) run on schedule.
 * Records every invocation with result, duration, data source status.
 * Key audit query: "did NewsSentinel run in the last 5 minutes? what did it find?"
 */
export const slowAgentLog = mysqlTable("slowAgentLog", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  agentName: varchar("agentName", { length: 80 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),                 // 'success', 'error', 'timeout', 'no_data'
  executionTimeMs: int("executionTimeMs"),
  signal: varchar("signal", { length: 10 }),                            // 'bullish', 'bearish', 'neutral'
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  dataPointsProcessed: int("dataPointsProcessed"),
  errorMessage: text("errorMessage"),
  apiCallsMade: int("apiCallsMade").default(0),
  apiCallsFailed: int("apiCallsFailed").default(0),
}, (table) => ({
  timestampIdx: index("idx_sal_timestamp").on(table.timestamp),
  symbolIdx: index("idx_sal_symbol").on(table.symbol),
  agentIdx: index("idx_sal_agent").on(table.agentName),
  statusIdx: index("idx_sal_status").on(table.status),
}));

export type SlowAgentLog = typeof slowAgentLog.$inferSelect;
export type InsertSlowAgentLog = typeof slowAgentLog.$inferInsert;

/**
 * API Call Log — Every external API call with response time, status, data volume.
 * Proves data feeds are live and identifies degradation patterns.
 * Key audit query: "CoinGecko success rate last 24h" or "which APIs are rate-limited?"
 */
export const apiCallLog = mysqlTable("apiCallLog", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  apiName: varchar("apiName", { length: 80 }).notNull(),               // 'CoinGecko', 'CryptoPanic', 'WhaleAlert', etc.
  endpoint: varchar("endpoint", { length: 255 }),
  method: varchar("method", { length: 10 }).default("GET"),
  status: varchar("status", { length: 20 }).notNull(),                  // 'success', 'error', 'timeout', 'rate_limited'
  httpStatusCode: int("httpStatusCode"),
  responseTimeMs: int("responseTimeMs"),
  responseSize: int("responseSize"),                                     // bytes
  errorMessage: text("errorMessage"),
  callerAgent: varchar("callerAgent", { length: 80 }),                  // which agent/service made the call
  symbol: varchar("symbol", { length: 20 }),
}, (table) => ({
  timestampIdx: index("idx_aclog_timestamp").on(table.timestamp),
  apiNameIdx: index("idx_aclog_apiName").on(table.apiName),
  statusIdx: index("idx_aclog_status").on(table.status),
  apiTsIdx: index("idx_aclog_api_ts").on(table.apiName, table.timestamp),
}));

export type ApiCallLog = typeof apiCallLog.$inferSelect;
export type InsertApiCallLog = typeof apiCallLog.$inferInsert;


// ─── Trading Pipeline Log ─────────────────────────────────────────────
// Permanent audit trail for all trading PIPELINE decisions (separate from order-level tradingActivityLog).
// Captures: consensus, signal approvals/rejections, exit decisions, position flips, risk checks.
export const tradingPipelineLog = mysqlTable("tradingPipelineLog", {
  id: int("id").autoincrement().primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  userId: int("userId"),
  eventType: varchar("eventType", { length: 50 }).notNull(),
  symbol: varchar("symbol", { length: 20 }),
  direction: varchar("direction", { length: 10 }),
  action: varchar("action", { length: 20 }),
  confidence: decimal("confidence", { precision: 8, scale: 4 }),
  price: decimal("price", { precision: 20, scale: 8 }),
  quantity: decimal("quantity", { precision: 20, scale: 10 }),
  pnl: decimal("pnl", { precision: 20, scale: 8 }),
  pnlPercent: decimal("pnlPercent", { precision: 10, scale: 4 }),
  reason: text("reason"),
  metadata: json("metadata"),
}, (table) => ({
  timestampIdx: index("idx_tpl_timestamp").on(table.timestamp),
  eventTypeIdx: index("idx_tpl_eventType").on(table.eventType),
  symbolIdx: index("idx_tpl_symbol").on(table.symbol),
  userEventIdx: index("idx_tpl_user_event").on(table.userId, table.eventType),
  symbolTimeIdx: index("idx_tpl_symbol_time").on(table.symbol, table.timestamp),
}));
export type TradingPipelineLog = typeof tradingPipelineLog.$inferSelect;
export type InsertTradingPipelineLog = typeof tradingPipelineLog.$inferInsert;


// ─── Phase 69 — TCA (Transaction Cost Analysis) Log ──────────────────────
// Persists every SmartExecutor fill report so the post-trade dashboard can
// show slippage trends, breach rate, stage-distribution, latency P50/P95/P99.
// Pre-Phase-69 these were only logged to pm2 — not queryable.
export const tcaLog = mysqlTable("tcaLog", {
  id: int("id").autoincrement().primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  userId: int("userId"),
  traceId: varchar("traceId", { length: 32 }),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: varchar("side", { length: 4 }).notNull(),
  quantity: decimal("quantity", { precision: 20, scale: 10 }).notNull(),
  refPrice: decimal("refPrice", { precision: 20, scale: 8 }).notNull(),
  executedPrice: decimal("executedPrice", { precision: 20, scale: 8 }).notNull(),
  executedQty: decimal("executedQty", { precision: 20, scale: 10 }).notNull(),
  slippageBps: decimal("slippageBps", { precision: 10, scale: 4 }).notNull(),
  bookSpreadBps: decimal("bookSpreadBps", { precision: 10, scale: 4 }),
  stageReached: int("stageReached").notNull(),
  totalLatencyMs: int("totalLatencyMs").notNull(),
  partialFill: tinyint("partialFill").default(0).notNull(),
  exceededCap: tinyint("exceededCap").default(0).notNull(),
}, (table) => ({
  timestampIdx: index("idx_tca_timestamp").on(table.timestamp),
  symbolIdx: index("idx_tca_symbol").on(table.symbol),
  traceIdx: index("idx_tca_trace").on(table.traceId),
  breachIdx: index("idx_tca_breach").on(table.exceededCap),
  symbolTimeIdx: index("idx_tca_symbol_time").on(table.symbol, table.timestamp),
}));
export type TcaLog = typeof tcaLog.$inferSelect;
export type InsertTcaLog = typeof tcaLog.$inferInsert;


// ─── Phase 70 — Agent Correlation Matrix ──────────────────────────────────
// Pairwise direction correlation between agents over historical windows.
// Powers Bayesian aggregation's effective-N: 5 perfectly-correlated agents
// behave as ~1 effective agent. Recomputed periodically (daily) from
// agentSignals timeseries.
export const agentCorrelations = mysqlTable("agentCorrelations", {
  id: int("id").autoincrement().primaryKey(),
  agentA: varchar("agentA", { length: 60 }).notNull(),
  agentB: varchar("agentB", { length: 60 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  correlation: decimal("correlation", { precision: 6, scale: 4 }).notNull(),
  sampleSize: int("sampleSize").notNull(),
  windowDays: int("windowDays").notNull(),
  lastUpdated: timestamp("lastUpdated").defaultNow().notNull(),
}, (table) => ({
  pairSymIdx: index("idx_agentcorr_pair_sym").on(table.agentA, table.agentB, table.symbol),
  symbolIdx: index("idx_agentcorr_symbol").on(table.symbol),
  updatedIdx: index("idx_agentcorr_updated").on(table.lastUpdated),
}));
export type AgentCorrelation = typeof agentCorrelations.$inferSelect;
export type InsertAgentCorrelation = typeof agentCorrelations.$inferInsert;


// ─── Phase 70 — Bayesian Consensus Log ────────────────────────────────────
// Per-signal record of posterior so we A/B against naive weighted average
// and detect calibration drift. Surfaces posteriorStd to the trade gate.
export const bayesianConsensusLog = mysqlTable("bayesianConsensusLog", {
  id: int("id").autoincrement().primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  userId: int("userId"),
  signalId: varchar("signalId", { length: 64 }),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  naiveMean: decimal("naiveMean", { precision: 8, scale: 6 }).notNull(),
  posteriorMean: decimal("posteriorMean", { precision: 8, scale: 6 }).notNull(),
  posteriorStd: decimal("posteriorStd", { precision: 8, scale: 6 }).notNull(),
  effectiveN: decimal("effectiveN", { precision: 8, scale: 4 }).notNull(),
  rawN: int("rawN").notNull(),
  avgCorrelation: decimal("avgCorrelation", { precision: 6, scale: 4 }),
  gateDecision: varchar("gateDecision", { length: 24 }).notNull(),
}, (table) => ({
  timestampIdx: index("idx_bayes_timestamp").on(table.timestamp),
  symbolIdx: index("idx_bayes_symbol").on(table.symbol),
  signalIdx: index("idx_bayes_signal").on(table.signalId),
}));
export type BayesianConsensusLog = typeof bayesianConsensusLog.$inferSelect;
export type InsertBayesianConsensusLog = typeof bayesianConsensusLog.$inferInsert;


// ─── Phase 82 — Per-Agent Signed PnL Attribution ──────────────────────────
// One row per (closed trade, agent) — records the agent's vote at entry +
// the signed dollar contribution to the trade's pnlAfterCosts.
//
// Attribution math: an agent that voted *with* the winning direction gets
// +pnl credit. An agent that voted *against* gets -pnl debit (it was
// "outvoted" by the consensus and would have steered us wrong). Neutral
// agents get 0 — they sat out. This lets the operator see which agents
// actually drove profitable trades vs which are P&L bottlenecks, in
// dollars, not just boolean accuracy.
export const agentPnlAttribution = mysqlTable("agentPnlAttribution", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tradeId: int("tradeId").notNull(),
  agentName: varchar("agentName", { length: 64 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  tradeSide: mysqlEnum("tradeSide", ["long", "short"]).notNull(),
  // Agent's vote at entry: 'bullish' | 'bearish' | 'neutral' | string
  agentDirection: varchar("agentDirection", { length: 16 }).notNull(),
  agentConfidence: decimal("agentConfidence", { precision: 6, scale: 4 }),
  // Signed: +x if aligned with winning direction, -x if opposed, 0 if neutral
  pnlContribution: decimal("pnlContribution", { precision: 18, scale: 6 }).notNull(),
  // Raw trade pnl (denormalized so a query can roll up without joins)
  tradePnl: decimal("tradePnl", { precision: 18, scale: 6 }).notNull(),
  // Was the agent's vote directionally correct? (signal aligned with realized P&L sign)
  wasCorrect: boolean("wasCorrect").notNull(),
  tradeQualityScore: varchar("tradeQualityScore", { length: 2 }), // A-F
  exitReason: varchar("exitReason", { length: 64 }),
  tradingMode: varchar("tradingMode", { length: 10 }), // 'paper' | 'live'
  closedAt: timestamp("closedAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userAgentIdx: index("idx_agent_pnl_user_agent").on(table.userId, table.agentName),
  tradeIdx: index("idx_agent_pnl_trade").on(table.tradeId),
  closedIdx: index("idx_agent_pnl_closed").on(table.closedAt),
  agentSymbolIdx: index("idx_agent_pnl_agent_symbol").on(table.agentName, table.symbol),
}));
export type AgentPnlAttribution = typeof agentPnlAttribution.$inferSelect;
export type InsertAgentPnlAttribution = typeof agentPnlAttribution.$inferInsert;


// ─── Phase 83 — TraderBrain Decision Trace ───────────────────────────────
// One row per brain tick per open position. The brain reads the Sensorium
// (in-memory snapshot of every organ's latest reading) and outputs ONE
// decision: hold | tighten_stop | take_partial | exit_full. This table is
// the canonical audit trail — every decision is inspectable so we can
// replay any closed trade tick-by-tick and see what the brain saw and why
// it chose what it chose. Replaces the empty `exitDecisionLog`.
export const brainDecisions = mysqlTable("brainDecisions", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  positionId: varchar("positionId", { length: 64 }).notNull(),    // in-memory or DB id
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: varchar("side", { length: 5 }).notNull(),                 // 'long' | 'short'
  // Brain's decision kind + reason
  kind: varchar("kind", { length: 32 }).notNull(),                // hold | tighten_stop | take_partial | exit_full
  pipelineStep: varchar("pipelineStep", { length: 40 }),          // which step fired (e.g. 'consensus_flip', 'profit_ratchet', 'hard_stop', 'hold')
  reason: text("reason"),
  urgency: varchar("urgency", { length: 10 }),                    // 'now' | 'soon' | null
  // What the brain saw (snapshot of inputs)
  sensorium: json("sensorium"),                                   // full snapshot — market, technical, flow, position, stance
  // Brain output specifics
  newStopLoss: decimal("newStopLoss", { precision: 20, scale: 8 }),
  exitQuantityPercent: decimal("exitQuantityPercent", { precision: 6, scale: 4 }),
  // Comparison vs the existing IEM
  // Phase 83 starts in dryRun mode: brain doesn't execute, just records.
  // Side-by-side comparison with the live IEM lets us validate before cutover.
  isDryRun: boolean("isDryRun").notNull().default(true),
  liveIEMAction: varchar("liveIEMAction", { length: 32 }),        // what the current IEM decided this tick
  // Performance
  latencyUs: int("latencyUs"),                                    // µs to compute the decision
}, (table) => ({
  positionIdx: index("idx_brain_position").on(table.positionId),
  timestampIdx: index("idx_brain_timestamp").on(table.timestamp),
  symbolKindIdx: index("idx_brain_symbol_kind").on(table.symbol, table.kind),
}));
export type BrainDecision = typeof brainDecisions.$inferSelect;
export type InsertBrainDecision = typeof brainDecisions.$inferInsert;

// Phase 89 — Persisted entry contexts for the alpha-library writer.
//
// Captured at brain_position_opened time, consumed at brain_position_closed
// time. The PatternPopulator service uses these to categorize each closed
// trade into a `winningPatterns` row.
//
// Why this table exists: pre-Phase-89, contexts were Map-only, so any
// server restart between an open and its close DROPPED the context →
// pattern row never written → alpha library missed the learning. With this
// table, contexts survive restarts and the populator rehydrates on boot.
//
// Rows are auto-deleted on successful close (the populator handles cleanup);
// stale rows (>24h) are reaped by a periodic sweep.
export const brainEntryContexts = mysqlTable("brainEntryContexts", {
  id: int("id").autoincrement().primaryKey(),
  // positionId is the brain's view of the trade — usually paperPositions.id
  // (number) for paper, or live positions.id, or a string id for live entries
  // routed via EngineAdapter.
  positionId: varchar("positionId", { length: 64 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: varchar("side", { length: 5 }).notNull(),               // 'long' | 'short'
  patternName: varchar("patternName", { length: 100 }).notNull(),
  openedAtMs: bigint("openedAtMs", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  positionIdx: uniqueIndex("idx_brainEntryCtx_position").on(table.positionId),
  createdIdx: index("idx_brainEntryCtx_created").on(table.createdAt),
}));
export type BrainEntryContext = typeof brainEntryContexts.$inferSelect;
export type InsertBrainEntryContext = typeof brainEntryContexts.$inferInsert;
