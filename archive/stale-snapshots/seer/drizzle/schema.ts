import { boolean, decimal, int, mysqlEnum, mysqlTable, text, timestamp, varchar, json } from "drizzle-orm/mysql-core";

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
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }).default('').notNull(),
  loginMethod: varchar("loginMethod", { length: 64 }).default('').notNull(),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export type HealthMetric = typeof healthMetrics.$inferSelect;
export type InsertHealthMetric = typeof healthMetrics.$inferInsert;

/**
 * Exchange configuration table
 * Stores user's selected exchange and connection status
 */
export const exchanges = mysqlTable("exchanges", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  exchangeName: mysqlEnum("exchangeName", ["binance", "coinbase"]).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  connectionStatus: mysqlEnum("connectionStatus", ["connected", "disconnected", "error"]).default("disconnected").notNull(),
  lastConnected: timestamp("lastConnected"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  entryPrice: decimal("entryPrice", { precision: 18, scale: 8 }).notNull(),
  exitPrice: decimal("exitPrice", { precision: 18, scale: 8 }),
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  entryTime: timestamp("entryTime").notNull(),
  exitTime: timestamp("exitTime"),
  status: mysqlEnum("status", ["open", "closed", "cancelled"]).notNull(),
  pnl: decimal("pnl", { precision: 18, scale: 8 }),
  pnlAfterCosts: decimal("pnlAfterCosts", { precision: 18, scale: 8 }),
  totalCosts: decimal("totalCosts", { precision: 18, scale: 8 }),
  costBreakdown: json("costBreakdown"), // { fees, spread, slippage }
  tradeQualityScore: varchar("tradeQualityScore", { length: 2 }), // A-F grading
  confidence: decimal("confidence", { precision: 5, scale: 4 }), // 0.0000 to 1.0000
  patternUsed: varchar("patternUsed", { length: 100 }),
  exitReason: varchar("exitReason", { length: 50 }), // "target_reached", "stop_loss", "proactive_exit", etc.
  agentSignals: json("agentSignals"), // Snapshot of all agent signals at entry
  expectedPath: json("expectedPath"), // The defined path at entry
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  entryPrice: decimal("entryPrice", { precision: 18, scale: 8 }).notNull(),
  currentPrice: decimal("currentPrice", { precision: 18, scale: 8 }),
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  stopLoss: decimal("stopLoss", { precision: 18, scale: 8 }).notNull(),
  takeProfit: decimal("takeProfit", { precision: 18, scale: 8 }).notNull(),
  expectedPath: json("expectedPath").notNull(),
  currentDeviation: decimal("currentDeviation", { precision: 5, scale: 4 }),
  lastRevalidation: timestamp("lastRevalidation"),
  thesisValid: boolean("thesisValid").default(true).notNull(),
  unrealizedPnl: decimal("unrealizedPnl", { precision: 18, scale: 8 }),
  // Position status and exit tracking
  status: mysqlEnum("status", ["open", "closed"]).default("open").notNull(),
  exitReason: mysqlEnum("exitReason", ["manual", "stop_loss", "take_profit", "liquidation", "system"]),
  exitTime: timestamp("exitTime"),
  realizedPnl: decimal("realizedPnl", { precision: 18, scale: 8 }),
  // Order tracking fields for real-time WebSocket updates
  orderId: varchar("orderId", { length: 100 }), // Exchange order ID
  clientOrderId: varchar("clientOrderId", { length: 100 }), // Client-side order ID
  orderStatus: mysqlEnum("orderStatus", ["PENDING", "OPEN", "FILLED", "CANCELLED", "EXPIRED", "FAILED"]).default("PENDING"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  executionScore: int("executionScore"), // 0-100 tactical timing quality score
  marketConditions: json("marketConditions"), // Snapshot of market state
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

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
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  indicators: json("indicators").notNull(), // { rsi, macd, stochastic }
  reasoning: text("reasoning").notNull(),
  executed: boolean("executed").default(false).notNull(),
  executedAt: timestamp("executedAt"),
  tradeId: int("tradeId"), // Link to trade if signal was executed
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  label: decimal("label", { precision: 18, scale: 8 }).notNull(), // pnl_after_costs
  tradeQualityScore: varchar("tradeQualityScore", { length: 2 }).notNull(),
  qualityWeight: decimal("qualityWeight", { precision: 5, scale: 4 }).notNull(), // For weighted training
  marketRegime: varchar("marketRegime", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  winRate: decimal("winRate", { precision: 5, scale: 4 }),
  avgPnl: decimal("avgPnl", { precision: 18, scale: 8 }),
  profitFactor: decimal("profitFactor", { precision: 5, scale: 2 }),
  confidenceScore: int("confidenceScore").default(0).notNull(), // 0-100
  stopLoss: decimal("stopLoss", { precision: 5, scale: 2 }), // Percentage
  takeProfit: decimal("takeProfit", { precision: 5, scale: 2 }), // Percentage
  maxHold: int("maxHold"), // Max hold periods (candles or days depending on timeframe)
  performanceHistory: json("performanceHistory"), // Last N trades for alpha decay tracking
  isActive: boolean("isActive").default(true).notNull(),
  alphaDecayFlag: boolean("alphaDecayFlag").default(false).notNull(),
  lastUsed: timestamp("lastUsed"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  biasValue: decimal("biasValue", { precision: 3, scale: 2 }).notNull(), // -0.10 to +0.10
  vetoNextTrade: boolean("vetoNextTrade").default(false).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserBias = typeof userBias.$inferSelect;
export type InsertUserBias = typeof userBias.$inferInsert;

/**
 * Agent weight configuration
 * Allows users to customize the weighted consensus formula
 */
export const agentWeights = mysqlTable("agentWeights", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  // Fast agents (100% base weight)
  technicalWeight: decimal("technicalWeight", { precision: 5, scale: 2 }).default("40.00").notNull(), // Default: 40%
  patternWeight: decimal("patternWeight", { precision: 5, scale: 2 }).default("35.00").notNull(), // Default: 35%
  orderFlowWeight: decimal("orderFlowWeight", { precision: 5, scale: 2 }).default("25.00").notNull(), // Default: 25%
  
  // Slow agents (20% bonus weight)
  sentimentWeight: decimal("sentimentWeight", { precision: 5, scale: 2 }).default("33.33").notNull(), // Default: 33.33%
  newsWeight: decimal("newsWeight", { precision: 5, scale: 2 }).default("33.33").notNull(), // Default: 33.33%
  macroWeight: decimal("macroWeight", { precision: 5, scale: 2 }).default("33.34").notNull(), // Default: 33.34%
  
  // Additional agents
  onChainWeight: decimal("onChainWeight", { precision: 5, scale: 2 }).default("0.00").notNull(), // Optional bonus
  
  // Multi-timeframe bonus
  timeframeBonus: decimal("timeframeBonus", { precision: 5, scale: 2 }).default("10.00").notNull(), // Default: +10%
  
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  highVolatilityAtrMin: decimal("highVolatilityAtrMin", { precision: 10, scale: 2 }).default("5.00").notNull(), // ATR > 5%
  mediumVolatilityAtrMin: decimal("mediumVolatilityAtrMin", { precision: 10, scale: 2 }).default("2.00").notNull(), // 2% < ATR <= 5%
  lowVolatilityAtrMax: decimal("lowVolatilityAtrMax", { precision: 10, scale: 2 }).default("2.00").notNull(), // ATR <= 2%
  
  // Execution thresholds by volatility
  highVolatilityThreshold: decimal("highVolatilityThreshold", { precision: 5, scale: 2 }).default("50.00").notNull(), // 50%
  mediumVolatilityThreshold: decimal("mediumVolatilityThreshold", { precision: 5, scale: 2 }).default("60.00").notNull(), // 60%
  lowVolatilityThreshold: decimal("lowVolatilityThreshold", { precision: 5, scale: 2 }).default("70.00").notNull(), // 70%
  
  // Position sizing tiers (confidence → position size %)
  scoutTier: decimal("scoutTier", { precision: 5, scale: 2 }).default("3.00").notNull(), // 3% (50-60% confidence)
  standardTier: decimal("standardTier", { precision: 5, scale: 2 }).default("5.00").notNull(), // 5% (60-70%)
  highTier: decimal("highTier", { precision: 5, scale: 2 }).default("7.00").notNull(), // 7% (70-80%)
  veryHighTier: decimal("veryHighTier", { precision: 5, scale: 2 }).default("10.00").notNull(), // 10% (80-90%)
  extremeTier: decimal("extremeTier", { precision: 5, scale: 2 }).default("15.00").notNull(), // 15% (90-100%)
  maxTier: decimal("maxTier", { precision: 5, scale: 2 }).default("20.00").notNull(), // 20% (100%+)
  
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  maxPositionSize: decimal("maxPositionSize", { precision: 5, scale: 2 }).default("20.00").notNull(), // % of capital
  maxTotalExposure: decimal("maxTotalExposure", { precision: 5, scale: 2 }).default("50.00").notNull(), // % of capital
  
  enableStopLoss: boolean("enableStopLoss").default(true).notNull(),
  enableTakeProfit: boolean("enableTakeProfit").default(true).notNull(),
  enablePartialExits: boolean("enablePartialExits").default(true).notNull(),
  
  defaultLeverage: int("defaultLeverage").default(1).notNull(), // 1x = no leverage
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  open: decimal("open", { precision: 20, scale: 8 }).notNull(),
  high: decimal("high", { precision: 20, scale: 8 }).notNull(),
  low: decimal("low", { precision: 20, scale: 8 }).notNull(),
  close: decimal("close", { precision: 20, scale: 8 }).notNull(),
  volume: decimal("volume", { precision: 20, scale: 8 }).notNull(),
  
  // Metadata
  source: varchar("source", { length: 50 }).default("binance").notNull(), // Data source
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type HistoricalCandle = typeof historicalCandles.$inferSelect;
export type InsertHistoricalCandle = typeof historicalCandles.$inferInsert;

/**
 * Paper Trading Wallets
 * Tracks virtual USD balance and performance metrics for paper trading
 */
export const paperWallets = mysqlTable("paperWallets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(), // One paper wallet per user
  balance: decimal("balance", { precision: 18, scale: 2 }).default("10000.00").notNull(), // Available virtual USD
  equity: decimal("equity", { precision: 18, scale: 2 }).default("10000.00").notNull(), // Balance + unrealized P&L
  margin: decimal("margin", { precision: 18, scale: 2 }).default("0.00").notNull(), // Used margin
  marginLevel: decimal("marginLevel", { precision: 10, scale: 2 }).default("0.00").notNull(), // Equity / Margin %
  totalPnL: decimal("totalPnL", { precision: 18, scale: 2 }).default("0.00").notNull(), // Realized + unrealized
  realizedPnL: decimal("realizedPnL", { precision: 18, scale: 2 }).default("0.00").notNull(),
  unrealizedPnL: decimal("unrealizedPnL", { precision: 18, scale: 2 }).default("0.00").notNull(),
  totalCommission: decimal("totalCommission", { precision: 18, scale: 2 }).default("0.00").notNull(),
  totalTrades: int("totalTrades").default(0).notNull(),
  winningTrades: int("winningTrades").default(0).notNull(),
  losingTrades: int("losingTrades").default(0).notNull(),
  winRate: decimal("winRate", { precision: 5, scale: 2 }).default("0.00").notNull(), // 0-100%
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PaperWallet = typeof paperWallets.$inferSelect;
export type InsertPaperWallet = typeof paperWallets.$inferInsert;

/**
 * Paper Trading Positions
 * Tracks open positions in paper trading mode
 */
export const paperPositions = mysqlTable("paperPositions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  exchange: mysqlEnum("exchange", ["binance", "coinbase"]).notNull(),
  side: mysqlEnum("side", ["long", "short"]).notNull(),
  entryPrice: decimal("entryPrice", { precision: 18, scale: 8 }).notNull(),
  currentPrice: decimal("currentPrice", { precision: 18, scale: 8 }).notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  stopLoss: decimal("stopLoss", { precision: 18, scale: 8 }),
  takeProfit: decimal("takeProfit", { precision: 18, scale: 8 }),
  partialExits: json("partialExits"), // Track 25%, 50%, 75% exits with prices and timestamps
  entryTime: timestamp("entryTime").notNull(),
  unrealizedPnL: decimal("unrealizedPnL", { precision: 18, scale: 2 }).default("0.00").notNull(),
  unrealizedPnLPercent: decimal("unrealizedPnLPercent", { precision: 10, scale: 2 }).default("0.00").notNull(),
  commission: decimal("commission", { precision: 18, scale: 2 }).default("0.00").notNull(),
  strategy: varchar("strategy", { length: 50 }).notNull(), // e.g., "scalping", "swing_trading"
  status: mysqlEnum("status", ["open", "closed"]).default("open").notNull(),
  exitReason: mysqlEnum("exitReason", ["manual", "stop_loss", "take_profit", "liquidation", "system"]),
  exitTime: timestamp("exitTime"),
  realizedPnl: decimal("realizedPnl", { precision: 18, scale: 8 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PaperPosition = typeof paperPositions.$inferSelect;
export type InsertPaperPosition = typeof paperPositions.$inferInsert;

/**
 * Paper Trading Orders
 * Complete history of all paper trading orders
 */
export const paperOrders = mysqlTable("paperOrders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  orderId: varchar("orderId", { length: 100 }).notNull().unique(), // paper_timestamp_random
  symbol: varchar("symbol", { length: 20 }).notNull(),
  exchange: mysqlEnum("exchange", ["binance", "coinbase"]).notNull(),
  type: mysqlEnum("type", ["market", "limit", "stop_loss", "take_profit"]).notNull(),
  side: mysqlEnum("side", ["buy", "sell"]).notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  price: decimal("price", { precision: 18, scale: 8 }), // For limit orders
  stopPrice: decimal("stopPrice", { precision: 18, scale: 8 }), // For stop orders
  status: mysqlEnum("status", ["pending", "filled", "cancelled", "rejected"]).notNull(),
  filledPrice: decimal("filledPrice", { precision: 18, scale: 8 }),
  filledQuantity: decimal("filledQuantity", { precision: 18, scale: 8 }),
  commission: decimal("commission", { precision: 18, scale: 2 }),
  slippage: decimal("slippage", { precision: 10, scale: 6 }), // Percentage
  latency: int("latency"), // Milliseconds
  strategy: varchar("strategy", { length: 50 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  filledAt: timestamp("filledAt"),
});

export type PaperOrder = typeof paperOrders.$inferSelect;
export type InsertPaperOrder = typeof paperOrders.$inferInsert;

/**
 * Paper Trading Trades
 * Completed trades with P&L for paper trading
 */
export const paperTrades = mysqlTable("paperTrades", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  orderId: varchar("orderId", { length: 100 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: mysqlEnum("side", ["buy", "sell"]).notNull(),
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  pnl: decimal("pnl", { precision: 18, scale: 2 }).notNull(),
  commission: decimal("commission", { precision: 18, scale: 2 }).notNull(),
  strategy: varchar("strategy", { length: 50 }).notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

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
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
  balanceBefore: decimal("balanceBefore", { precision: 18, scale: 2 }).notNull(),
  balanceAfter: decimal("balanceAfter", { precision: 18, scale: 2 }).notNull(),
  relatedOrderId: varchar("relatedOrderId", { length: 100 }),
  relatedPositionId: int("relatedPositionId"),
  description: text("description"),
  metadata: json("metadata"), // Additional context (symbol, quantity, price, etc.)
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  accuracy: decimal("accuracy", { precision: 5, scale: 4 }).notNull(), // 0.0000 to 1.0000
  totalTrades: int("totalTrades").default(0).notNull(),
  correctTrades: int("correctTrades").default(0).notNull(),
  lastUpdated: timestamp("lastUpdated").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  totalCapitalAllocated: decimal("totalCapitalAllocated", { precision: 18, scale: 2 }).notNull(),
  changes: json("changes").notNull(), // Array of { symbol, action, oldSizeUSD, newSizeUSD, reason }
  portfolioMetrics: json("portfolioMetrics").notNull(), // { totalValue, allocatedCapital, availableCash, numberOfPositions }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  totalValue: decimal("totalValue", { precision: 18, scale: 2 }).notNull(),
  dailyReturn: decimal("dailyReturn", { precision: 10, scale: 6 }), // Percentage as decimal
  cumulativeReturn: decimal("cumulativeReturn", { precision: 10, scale: 6 }),
  
  // Risk metrics
  sharpeRatio: decimal("sharpeRatio", { precision: 10, scale: 4 }),
  sortinoRatio: decimal("sortinoRatio", { precision: 10, scale: 4 }),
  maxDrawdown: decimal("maxDrawdown", { precision: 10, scale: 6 }),
  volatility: decimal("volatility", { precision: 10, scale: 6 }),
  
  // Position metrics
  numberOfPositions: int("numberOfPositions").notNull(),
  allocatedCapital: decimal("allocatedCapital", { precision: 18, scale: 2 }).notNull(),
  availableCash: decimal("availableCash", { precision: 18, scale: 2 }).notNull(),
  
  // Correlation metrics (JSON object with symbol pairs)
  correlationMatrix: json("correlationMatrix"), // { "BTC-ETH": 0.85, "BTC-SPX": 0.42, ... }
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  limitValue: decimal("limitValue", { precision: 18, scale: 2 }).notNull(),
  actualValue: decimal("actualValue", { precision: 18, scale: 2 }).notNull(),
  symbol: varchar("symbol", { length: 20 }),
  action: mysqlEnum("action", ["blocked", "warning", "shutdown"]).notNull(),
  resolved: boolean("resolved").default(false).notNull(),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  price: decimal("price", { precision: 18, scale: 8 }),
  status: mysqlEnum("status", ["pending", "submitted", "filled", "partial", "rejected", "cancelled"]).notNull(),
  exchange: varchar("exchange", { length: 50 }).notNull(),
  orderId: varchar("orderId", { length: 100 }), // Exchange order ID
  fillPrice: decimal("fillPrice", { precision: 18, scale: 8 }),
  fillQuantity: decimal("fillQuantity", { precision: 18, scale: 8 }),
  rejectionReason: text("rejectionReason"),
  executionTimeMs: int("executionTimeMs"), // Time from submission to fill
  slippage: decimal("slippage", { precision: 10, scale: 6 }), // Percentage
  fees: decimal("fees", { precision: 18, scale: 8 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  accuracy: decimal("accuracy", { precision: 5, scale: 4 }), // 0.0000 to 1.0000
  
  // Performance metrics
  avgConfidence: decimal("avgConfidence", { precision: 5, scale: 4 }),
  sharpeRatio: decimal("sharpeRatio", { precision: 10, scale: 4 }),
  profitFactor: decimal("profitFactor", { precision: 10, scale: 4 }),
  
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  deactivatedReason: text("deactivatedReason"),
  deactivatedAt: timestamp("deactivatedAt"),
  
  // Timestamps
  lastSignalAt: timestamp("lastSignalAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

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
  meanExcessReturn: decimal("meanExcessReturn", { precision: 10, scale: 6 }), // μ (mean return - risk-free rate)
  stdDeviation: decimal("stdDeviation", { precision: 10, scale: 6 }), // σ (standard deviation of returns)
  kellyFraction: decimal("kellyFraction", { precision: 10, scale: 6 }), // f = μ / σ²
  kellyMultiplier: decimal("kellyMultiplier", { precision: 5, scale: 4 }).default("0.5000").notNull(), // Conservative multiplier (0.5 = Half-Kelly)
  
  // Performance Metrics
  sharpeRatio: decimal("sharpeRatio", { precision: 10, scale: 4 }), // Rolling 90-day Sharpe
  sortinoRatio: decimal("sortinoRatio", { precision: 10, scale: 4 }), // Downside deviation focus
  calmarRatio: decimal("calmarRatio", { precision: 10, scale: 4 }), // Return / max drawdown
  winRate: decimal("winRate", { precision: 5, scale: 2 }), // 0-100%
  profitFactor: decimal("profitFactor", { precision: 10, scale: 4 }), // Gross profit / gross loss
  avgWin: decimal("avgWin", { precision: 18, scale: 2 }),
  avgLoss: decimal("avgLoss", { precision: 18, scale: 2 }),
  maxDrawdown: decimal("maxDrawdown", { precision: 10, scale: 2 }), // Percentage
  
  // Capital Allocation
  allocatedCapital: decimal("allocatedCapital", { precision: 18, scale: 2 }).default("0.00").notNull(),
  targetAllocation: decimal("targetAllocation", { precision: 10, scale: 2 }), // Percentage of total capital
  minAllocation: decimal("minAllocation", { precision: 18, scale: 2 }), // Minimum capital required
  maxAllocation: decimal("maxAllocation", { precision: 18, scale: 2 }), // Maximum capital allowed
  
  // Risk Parameters
  maxPositionSize: decimal("maxPositionSize", { precision: 10, scale: 2 }).default("20.00").notNull(), // % of allocated capital
  maxCorrelation: decimal("maxCorrelation", { precision: 5, scale: 4 }).default("0.6000").notNull(), // Max correlation with portfolio
  stopLossPercent: decimal("stopLossPercent", { precision: 5, scale: 2 }).default("5.00").notNull(),
  takeProfitPercent: decimal("takeProfitPercent", { precision: 5, scale: 2 }).default("10.00").notNull(),
  
  // Rebalancing
  lastRebalance: timestamp("lastRebalance"),
  rebalanceFrequency: mysqlEnum("rebalanceFrequency", ["daily", "weekly", "monthly"]).default("daily").notNull(),
  
  // Metadata
  description: text("description"),
  config: json("config"), // Strategy-specific configuration
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  portfolioValue: decimal("portfolioValue", { precision: 18, scale: 2 }).notNull(),
  portfolioVaR95: decimal("portfolioVaR95", { precision: 18, scale: 2 }), // 95% confidence VaR
  portfolioVaR99: decimal("portfolioVaR99", { precision: 18, scale: 2 }), // 99% confidence VaR
  historicalVaR: decimal("historicalVaR", { precision: 18, scale: 2 }), // Historical simulation VaR
  parametricVaR: decimal("parametricVaR", { precision: 18, scale: 2 }), // Parametric (normal distribution) VaR
  monteCarloVaR: decimal("monteCarloVaR", { precision: 18, scale: 2 }), // Monte Carlo simulation VaR
  
  // Drawdown Metrics
  currentDrawdown: decimal("currentDrawdown", { precision: 10, scale: 2 }), // Current % from peak
  maxDrawdown: decimal("maxDrawdown", { precision: 10, scale: 2 }), // Maximum % drawdown in period
  peakEquity: decimal("peakEquity", { precision: 18, scale: 2 }), // Peak equity value
  drawdownDuration: int("drawdownDuration"), // Days in current drawdown
  
  // Risk-Adjusted Performance
  sharpeRatio30d: decimal("sharpeRatio30d", { precision: 10, scale: 4 }),
  sharpeRatio60d: decimal("sharpeRatio60d", { precision: 10, scale: 4 }),
  sharpeRatio90d: decimal("sharpeRatio90d", { precision: 10, scale: 4 }),
  sortinoRatio: decimal("sortinoRatio", { precision: 10, scale: 4 }),
  calmarRatio: decimal("calmarRatio", { precision: 10, scale: 4 }),
  
  // Volatility Metrics
  realizedVolatility: decimal("realizedVolatility", { precision: 10, scale: 6 }), // Actual portfolio volatility
  impliedVolatility: decimal("impliedVolatility", { precision: 10, scale: 6 }), // Market-implied volatility
  volatilityPercentile: int("volatilityPercentile"), // 0-100 percentile vs historical
  
  // Leverage and Margin
  currentLeverage: decimal("currentLeverage", { precision: 10, scale: 4 }), // Portfolio size / equity
  marginUtilization: decimal("marginUtilization", { precision: 5, scale: 2 }), // % of available margin used
  
  // Correlation
  avgPositionCorrelation: decimal("avgPositionCorrelation", { precision: 5, scale: 4 }), // Average pairwise correlation
  portfolioDiversification: decimal("portfolioDiversification", { precision: 5, scale: 4 }), // 1 - avg correlation
  
  // Circuit Breaker Status
  circuitBreakerLevel: mysqlEnum("circuitBreakerLevel", ["green", "yellow", "orange", "red", "emergency"]).default("green").notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  totalCapital: decimal("totalCapital", { precision: 18, scale: 2 }).notNull(),
  
  // Four-Tier Allocation
  activeTradingCapital: decimal("activeTradingCapital", { precision: 18, scale: 2 }).notNull(), // 60-70%
  maintenanceMarginBuffer: decimal("maintenanceMarginBuffer", { precision: 18, scale: 2 }).notNull(), // 15-20%
  drawdownProtectionReserve: decimal("drawdownProtectionReserve", { precision: 18, scale: 2 }).notNull(), // 10-15%
  opportunityCapital: decimal("opportunityCapital", { precision: 18, scale: 2 }).notNull(), // 5-10%
  
  // Allocation Percentages
  activeTradingPercent: decimal("activeTradingPercent", { precision: 5, scale: 2 }).notNull(),
  marginBufferPercent: decimal("marginBufferPercent", { precision: 5, scale: 2 }).notNull(),
  drawdownReservePercent: decimal("drawdownReservePercent", { precision: 5, scale: 2 }).notNull(),
  opportunityPercent: decimal("opportunityPercent", { precision: 5, scale: 2 }).notNull(),
  
  // Strategy-Level Allocations
  strategyAllocations: json("strategyAllocations"), // { strategyId: amount }
  
  // Reallocation Trigger
  trigger: mysqlEnum("trigger", ["scheduled", "performance", "drawdown", "volatility", "manual"]).notNull(),
  reason: text("reason"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  portfolioValue: decimal("portfolioValue", { precision: 18, scale: 2 }),
  drawdownPercent: decimal("drawdownPercent", { precision: 10, scale: 2 }),
  varBreach: decimal("varBreach", { precision: 18, scale: 2 }), // Amount VaR was exceeded by
  marginUtilization: decimal("marginUtilization", { precision: 5, scale: 2 }),
  
  // Actions Taken
  actionTaken: text("actionTaken"),
  positionsAffected: json("positionsAffected"), // Array of position IDs
  capitalAdjustment: decimal("capitalAdjustment", { precision: 18, scale: 2 }),
  
  // Resolution
  resolved: boolean("resolved").default(false).notNull(),
  resolvedAt: timestamp("resolvedAt"),
  resolutionNotes: text("resolutionNotes"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  totalEquity: decimal("totalEquity", { precision: 18, scale: 2 }).notNull(),
  cash: decimal("cash", { precision: 18, scale: 2 }).notNull(),
  positionsValue: decimal("positionsValue", { precision: 18, scale: 2 }).notNull(),
  unrealizedPnL: decimal("unrealizedPnL", { precision: 18, scale: 2 }).notNull(),
  realizedPnL: decimal("realizedPnL", { precision: 18, scale: 2 }).notNull(),
  
  // Daily Performance
  dailyReturn: decimal("dailyReturn", { precision: 10, scale: 6 }), // Percentage as decimal
  dailyPnL: decimal("dailyPnL", { precision: 18, scale: 2 }),
  
  // Position Composition
  numberOfPositions: int("numberOfPositions").notNull(),
  positionDetails: json("positionDetails"), // Array of { symbol, value, weight, pnl }
  
  // Risk Snapshot
  portfolioVaR95: decimal("portfolioVaR95", { precision: 18, scale: 2 }),
  currentDrawdown: decimal("currentDrawdown", { precision: 10, scale: 2 }),
  sharpeRatio: decimal("sharpeRatio", { precision: 10, scale: 4 }),
  
  // Capital Allocation Snapshot
  activeTradingCapital: decimal("activeTradingCapital", { precision: 18, scale: 2 }),
  reserveCapital: decimal("reserveCapital", { precision: 18, scale: 2 }),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  positionVaR95: decimal("positionVaR95", { precision: 18, scale: 2 }), // Position-specific VaR
  varContribution: decimal("varContribution", { precision: 18, scale: 2 }), // Contribution to portfolio VaR
  
  // Correlation
  correlationWithPortfolio: decimal("correlationWithPortfolio", { precision: 5, scale: 4 }),
  correlationWithOthers: json("correlationWithOthers"), // { positionId: correlation }
  
  // Position Sizing
  kellyOptimalSize: decimal("kellyOptimalSize", { precision: 18, scale: 2 }), // Optimal size per Kelly
  currentSize: decimal("currentSize", { precision: 18, scale: 2 }), // Actual position size
  sizeDeviation: decimal("sizeDeviation", { precision: 10, scale: 2 }), // % deviation from optimal
  
  // Risk Metrics
  stopLossDistance: decimal("stopLossDistance", { precision: 10, scale: 2 }), // % from current price
  takeProfitDistance: decimal("takeProfitDistance", { precision: 10, scale: 2 }), // % from current price
  riskRewardRatio: decimal("riskRewardRatio", { precision: 10, scale: 4 }), // Take profit / stop loss
  
  // Time Metrics
  holdingPeriod: int("holdingPeriod"), // Minutes since entry
  expectedHoldingPeriod: int("expectedHoldingPeriod"), // Expected minutes
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  allocatedCapital: decimal("allocatedCapital", { precision: 18, scale: 2 }).notNull(),
  availableCapital: decimal("availableCapital", { precision: 18, scale: 2 }).notNull(),
  maxCapital: decimal("maxCapital", { precision: 18, scale: 2 }).notNull(), // Maximum allowed allocation
  
  // Risk Limits
  maxPositions: int("maxPositions").default(5).notNull(),
  maxDrawdown: decimal("maxDrawdown", { precision: 10, scale: 2 }).default("15.00").notNull(), // Percentage
  maxDailyLoss: decimal("maxDailyLoss", { precision: 18, scale: 2 }).notNull(),
  maxPositionSize: decimal("maxPositionSize", { precision: 10, scale: 2 }).default("20.00").notNull(), // Percentage
  
  // Performance Metrics
  totalPnL: decimal("totalPnL", { precision: 18, scale: 2 }).default("0.00").notNull(),
  realizedPnL: decimal("realizedPnL", { precision: 18, scale: 2 }).default("0.00").notNull(),
  unrealizedPnL: decimal("unrealizedPnL", { precision: 18, scale: 2 }).default("0.00").notNull(),
  
  // Risk Metrics
  currentDrawdown: decimal("currentDrawdown", { precision: 10, scale: 2 }).default("0.00").notNull(),
  maxDrawdownReached: decimal("maxDrawdownReached", { precision: 10, scale: 2 }).default("0.00").notNull(),
  sharpeRatio: decimal("sharpeRatio", { precision: 10, scale: 4 }),
  sortinoRatio: decimal("sortinoRatio", { precision: 10, scale: 4 }),
  
  // Trade Statistics
  totalTrades: int("totalTrades").default(0).notNull(),
  winningTrades: int("winningTrades").default(0).notNull(),
  losingTrades: int("losingTrades").default(0).notNull(),
  winRate: decimal("winRate", { precision: 5, scale: 2 }).default("0.00").notNull(), // Percentage
  avgWin: decimal("avgWin", { precision: 18, scale: 2 }),
  avgLoss: decimal("avgLoss", { precision: 18, scale: 2 }),
  profitFactor: decimal("profitFactor", { precision: 10, scale: 4 }),
  
  // Performance Score (0-100)
  performanceScore: decimal("performanceScore", { precision: 5, scale: 2 }).default("50.00").notNull(),
  
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  isPaused: boolean("isPaused").default(false).notNull(),
  pauseReason: text("pauseReason"),
  
  // Timestamps
  lastTradeAt: timestamp("lastTradeAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  requestedQuantity: decimal("requestedQuantity", { precision: 18, scale: 8 }).notNull(),
  requestedValue: decimal("requestedValue", { precision: 18, scale: 2 }).notNull(),
  currentPrice: decimal("currentPrice", { precision: 18, scale: 8 }).notNull(),
  
  // Validation Results
  passed: boolean("passed").notNull(),
  overallRiskScore: decimal("overallRiskScore", { precision: 5, scale: 2 }), // 0-100
  
  // Kelly Criterion Check
  kellyOptimalSize: decimal("kellyOptimalSize", { precision: 18, scale: 2 }),
  kellyDeviation: decimal("kellyDeviation", { precision: 10, scale: 2 }), // % deviation from optimal
  kellyPassed: boolean("kellyPassed"),
  
  // VaR Check
  portfolioVaR: decimal("portfolioVaR", { precision: 18, scale: 2 }),
  positionVaR: decimal("positionVaR", { precision: 18, scale: 2 }),
  varLimit: decimal("varLimit", { precision: 18, scale: 2 }),
  varUtilization: decimal("varUtilization", { precision: 5, scale: 2 }), // Percentage
  varPassed: boolean("varPassed"),
  
  // Circuit Breaker Check
  circuitBreakerActive: boolean("circuitBreakerActive"),
  circuitBreakerReason: varchar("circuitBreakerReason", { length: 100 }),
  circuitBreakerPassed: boolean("circuitBreakerPassed"),
  
  // Balance & Margin Check
  availableBalance: decimal("availableBalance", { precision: 18, scale: 2 }),
  requiredMargin: decimal("requiredMargin", { precision: 18, scale: 2 }),
  marginUtilization: decimal("marginUtilization", { precision: 5, scale: 2 }), // Percentage
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
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  entryValue: decimal("entryValue", { precision: 18, scale: 2 }).notNull(),
  currentValue: decimal("currentValue", { precision: 18, scale: 2 }),
  pnl: decimal("pnl", { precision: 18, scale: 2 }),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  kellyFraction: decimal("kellyFraction", { precision: 3, scale: 2 }).default("0.25"), // Fractional Kelly (0.25 = quarter Kelly)
  
  // Trade Limits
  maxTradesPerDay: int("maxTradesPerDay").default(10).notNull(),
  maxOpenPositions: int("maxOpenPositions").default(5).notNull(),
  cooldownMinutes: int("cooldownMinutes").default(15).notNull(), // Minutes between automated trades
  
  // Risk Controls
  maxDailyLossUSD: decimal("maxDailyLossUSD", { precision: 18, scale: 2 }).default("500.00").notNull(),
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
  limitOrderOffsetPercent: decimal("limitOrderOffsetPercent", { precision: 5, scale: 2 }).default("0.10"), // For limit orders
  
  // Notifications
  notifyOnExecution: boolean("notifyOnExecution").default(true).notNull(),
  notifyOnRejection: boolean("notifyOnRejection").default(true).notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  signalConfidence: decimal("signalConfidence", { precision: 5, scale: 2 }).notNull(), // 0-100
  signalData: json("signalData").notNull(), // Complete signal snapshot
  
  // Trade Details
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: mysqlEnum("side", ["long", "short"]).notNull(),
  requestedQuantity: decimal("requestedQuantity", { precision: 18, scale: 8 }),
  requestedValue: decimal("requestedValue", { precision: 18, scale: 2 }),
  
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
  executedPrice: decimal("executedPrice", { precision: 18, scale: 8 }),
  executedQuantity: decimal("executedQuantity", { precision: 18, scale: 8 }),
  executionLatencyMs: int("executionLatencyMs"),
  
  // Rejection Details
  rejectionReason: varchar("rejectionReason", { length: 200 }),
  rejectionDetails: json("rejectionDetails"), // Detailed validation failures
  
  // Risk Assessment Snapshot
  preTradeBalance: decimal("preTradeBalance", { precision: 18, scale: 2 }),
  preTradeEquity: decimal("preTradeEquity", { precision: 18, scale: 2 }),
  preTradeOpenPositions: int("preTradeOpenPositions"),
  dailyTradeCount: int("dailyTradeCount"), // How many automated trades today before this one
  dailyPnL: decimal("dailyPnL", { precision: 18, scale: 2 }), // P&L today before this trade
  
  // Settings Snapshot (what settings were active)
  settingsSnapshot: json("settingsSnapshot"),
  
  // Timestamps
  signalReceivedAt: timestamp("signalReceivedAt").notNull(),
  evaluatedAt: timestamp("evaluatedAt").notNull(),
  executedAt: timestamp("executedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  executionRate: decimal("executionRate", { precision: 5, scale: 2 }), // % of signals that became trades
  
  // Performance Metrics
  totalPnL: decimal("totalPnL", { precision: 18, scale: 2 }).default("0.00"),
  winningTrades: int("winningTrades").default(0).notNull(),
  losingTrades: int("losingTrades").default(0).notNull(),
  winRate: decimal("winRate", { precision: 5, scale: 2 }), // 0-100%
  avgWin: decimal("avgWin", { precision: 18, scale: 2 }),
  avgLoss: decimal("avgLoss", { precision: 18, scale: 2 }),
  profitFactor: decimal("profitFactor", { precision: 10, scale: 2 }), // Gross profit / gross loss
  
  // Latency Metrics
  avgSignalToExecutionMs: int("avgSignalToExecutionMs"),
  p95SignalToExecutionMs: int("p95SignalToExecutionMs"),
  
  // Risk Metrics
  maxDrawdown: decimal("maxDrawdown", { precision: 18, scale: 2 }),
  sharpeRatio: decimal("sharpeRatio", { precision: 10, scale: 4 }),
  
  // Rejection Breakdown (JSON: { insufficient_balance: 5, low_confidence: 12, ... })
  rejectionReasons: json("rejectionReasons"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AutomatedTradingMetric = typeof automatedTradingMetrics.$inferSelect;
export type InsertAutomatedTradingMetric = typeof automatedTradingMetrics.$inferInsert;
