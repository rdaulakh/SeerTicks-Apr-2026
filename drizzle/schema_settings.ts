import { boolean, decimal, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
