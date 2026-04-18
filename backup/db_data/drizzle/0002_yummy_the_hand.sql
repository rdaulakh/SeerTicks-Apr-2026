CREATE TABLE `agentAccuracy` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`agentName` varchar(50) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`accuracy` decimal(5,4) NOT NULL,
	`totalTrades` int NOT NULL DEFAULT 0,
	`correctTrades` int NOT NULL DEFAULT 0,
	`lastUpdated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentAccuracy_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agentPerformanceMetrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`agentName` varchar(50) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`timeframe` varchar(10) NOT NULL,
	`totalSignals` int NOT NULL DEFAULT 0,
	`correctSignals` int NOT NULL DEFAULT 0,
	`accuracy` decimal(5,4),
	`avgConfidence` decimal(5,4),
	`sharpeRatio` decimal(10,4),
	`profitFactor` decimal(10,4),
	`isActive` boolean NOT NULL DEFAULT true,
	`deactivatedReason` text,
	`deactivatedAt` timestamp,
	`lastSignalAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agentPerformanceMetrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agentSignals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`agentName` varchar(50) NOT NULL,
	`signalType` varchar(50) NOT NULL,
	`signalData` json NOT NULL,
	`confidence` decimal(5,4),
	`executionScore` int,
	`marketConditions` json,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentSignals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agentWeights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`technicalWeight` decimal(5,2) NOT NULL DEFAULT '40.00',
	`patternWeight` decimal(5,2) NOT NULL DEFAULT '35.00',
	`orderFlowWeight` decimal(5,2) NOT NULL DEFAULT '25.00',
	`sentimentWeight` decimal(5,2) NOT NULL DEFAULT '33.33',
	`newsWeight` decimal(5,2) NOT NULL DEFAULT '33.33',
	`macroWeight` decimal(5,2) NOT NULL DEFAULT '33.34',
	`onChainWeight` decimal(5,2) NOT NULL DEFAULT '0.00',
	`timeframeBonus` decimal(5,2) NOT NULL DEFAULT '10.00',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agentWeights_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `apiKeys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`exchangeId` int NOT NULL,
	`encryptedApiKey` text NOT NULL,
	`encryptedApiSecret` text NOT NULL,
	`apiKeyIv` varchar(32) NOT NULL,
	`apiSecretIv` varchar(32) NOT NULL,
	`isValid` boolean NOT NULL DEFAULT false,
	`lastTested` timestamp,
	`mt5AccountNumber` varchar(64),
	`mt5ServerName` varchar(128),
	`metaapiAccountId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `apiKeys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `engineState` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`isRunning` boolean NOT NULL DEFAULT false,
	`startedAt` timestamp,
	`stoppedAt` timestamp,
	`config` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `engineState_id` PRIMARY KEY(`id`),
	CONSTRAINT `engineState_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `exchangeSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`exchangeId` int NOT NULL,
	`useTestnet` boolean NOT NULL DEFAULT false,
	`maxOrdersPerMinute` int NOT NULL DEFAULT 10,
	`maxPositionSize` decimal(5,2) NOT NULL DEFAULT '20.00',
	`maxTotalExposure` decimal(5,2) NOT NULL DEFAULT '50.00',
	`enableStopLoss` boolean NOT NULL DEFAULT true,
	`enableTakeProfit` boolean NOT NULL DEFAULT true,
	`enablePartialExits` boolean NOT NULL DEFAULT true,
	`defaultLeverage` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `exchangeSettings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `exchanges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`exchangeName` enum('binance','coinbase') NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`connectionStatus` enum('connected','disconnected','error') NOT NULL DEFAULT 'disconnected',
	`lastConnected` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `exchanges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `externalApiKeys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` varchar(50) NOT NULL,
	`encryptedKey` text NOT NULL,
	`encryptionIv` varchar(32) NOT NULL,
	`isValid` boolean NOT NULL DEFAULT false,
	`lastTested` timestamp,
	`rateLimit` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `externalApiKeys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `healthMetrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`p50Latency` int NOT NULL,
	`p95Latency` int NOT NULL,
	`p99Latency` int NOT NULL,
	`avgLatency` int NOT NULL,
	`totalTraces` int NOT NULL,
	`completedTraces` int NOT NULL,
	`failedTraces` int NOT NULL,
	`errorRate` int NOT NULL,
	`agentHealth` json,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `healthMetrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `historicalCandles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`interval` varchar(10) NOT NULL,
	`timestamp` timestamp NOT NULL,
	`open` decimal(20,8) NOT NULL,
	`high` decimal(20,8) NOT NULL,
	`low` decimal(20,8) NOT NULL,
	`close` decimal(20,8) NOT NULL,
	`volume` decimal(20,8) NOT NULL,
	`source` varchar(50) NOT NULL DEFAULT 'binance',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `historicalCandles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mlTrainingData` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tradeId` int NOT NULL,
	`features` json NOT NULL,
	`label` decimal(18,8) NOT NULL,
	`tradeQualityScore` varchar(2) NOT NULL,
	`qualityWeight` decimal(5,4) NOT NULL,
	`marketRegime` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mlTrainingData_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('trade','risk','agent','system','performance') NOT NULL,
	`severity` enum('info','warning','error','critical') NOT NULL,
	`title` varchar(200) NOT NULL,
	`message` text NOT NULL,
	`data` json,
	`isRead` boolean NOT NULL DEFAULT false,
	`isArchived` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `paperOrders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`orderId` varchar(100) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`exchange` enum('binance','coinbase') NOT NULL,
	`type` enum('market','limit','stop_loss','take_profit') NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`quantity` decimal(18,8) NOT NULL,
	`price` decimal(18,8),
	`stopPrice` decimal(18,8),
	`status` enum('pending','filled','cancelled','rejected') NOT NULL,
	`filledPrice` decimal(18,8),
	`filledQuantity` decimal(18,8),
	`commission` decimal(18,2),
	`slippage` decimal(10,6),
	`latency` int,
	`strategy` varchar(50) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`filledAt` timestamp,
	CONSTRAINT `paperOrders_id` PRIMARY KEY(`id`),
	CONSTRAINT `paperOrders_orderId_unique` UNIQUE(`orderId`)
);
--> statement-breakpoint
CREATE TABLE `paperPositions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`exchange` enum('binance','coinbase') NOT NULL,
	`side` enum('long','short') NOT NULL,
	`entryPrice` decimal(18,8) NOT NULL,
	`currentPrice` decimal(18,8) NOT NULL,
	`quantity` decimal(18,8) NOT NULL,
	`stopLoss` decimal(18,8),
	`takeProfit` decimal(18,8),
	`entryTime` timestamp NOT NULL,
	`unrealizedPnL` decimal(18,2) NOT NULL DEFAULT '0.00',
	`unrealizedPnLPercent` decimal(10,2) NOT NULL DEFAULT '0.00',
	`commission` decimal(18,2) NOT NULL DEFAULT '0.00',
	`strategy` varchar(50) NOT NULL,
	`status` enum('open','closed') NOT NULL DEFAULT 'open',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `paperPositions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `paperTrades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`orderId` varchar(100) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`price` decimal(18,8) NOT NULL,
	`quantity` decimal(18,8) NOT NULL,
	`pnl` decimal(18,2) NOT NULL,
	`commission` decimal(18,2) NOT NULL,
	`strategy` varchar(50) NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `paperTrades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `paperWallets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`balance` decimal(18,2) NOT NULL DEFAULT '10000.00',
	`equity` decimal(18,2) NOT NULL DEFAULT '10000.00',
	`margin` decimal(18,2) NOT NULL DEFAULT '0.00',
	`marginLevel` decimal(10,2) NOT NULL DEFAULT '0.00',
	`totalPnL` decimal(18,2) NOT NULL DEFAULT '0.00',
	`realizedPnL` decimal(18,2) NOT NULL DEFAULT '0.00',
	`unrealizedPnL` decimal(18,2) NOT NULL DEFAULT '0.00',
	`totalCommission` decimal(18,2) NOT NULL DEFAULT '0.00',
	`totalTrades` int NOT NULL DEFAULT 0,
	`winningTrades` int NOT NULL DEFAULT 0,
	`losingTrades` int NOT NULL DEFAULT 0,
	`winRate` decimal(5,2) NOT NULL DEFAULT '0.00',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `paperWallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `paperWallets_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `portfolioRiskMetrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL DEFAULT 1,
	`timestamp` timestamp NOT NULL,
	`totalValue` decimal(18,2) NOT NULL,
	`dailyReturn` decimal(10,6),
	`cumulativeReturn` decimal(10,6),
	`sharpeRatio` decimal(10,4),
	`sortinoRatio` decimal(10,4),
	`maxDrawdown` decimal(10,6),
	`volatility` decimal(10,6),
	`numberOfPositions` int NOT NULL,
	`allocatedCapital` decimal(18,2) NOT NULL,
	`availableCash` decimal(18,2) NOT NULL,
	`correlationMatrix` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `portfolioRiskMetrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tradeId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`side` enum('long','short') NOT NULL,
	`entryPrice` decimal(18,8) NOT NULL,
	`currentPrice` decimal(18,8),
	`quantity` decimal(18,8) NOT NULL,
	`stopLoss` decimal(18,8) NOT NULL,
	`takeProfit` decimal(18,8) NOT NULL,
	`expectedPath` json NOT NULL,
	`currentDeviation` decimal(5,4),
	`lastRevalidation` timestamp,
	`thesisValid` boolean NOT NULL DEFAULT true,
	`unrealizedPnl` decimal(18,8),
	`orderId` varchar(100),
	`clientOrderId` varchar(100),
	`orderStatus` enum('PENDING','OPEN','FILLED','CANCELLED','EXPIRED','FAILED') DEFAULT 'PENDING',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rebalancingHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL DEFAULT 1,
	`timestamp` timestamp NOT NULL,
	`trigger` enum('time','confidence','deviation','manual') NOT NULL,
	`symbolsRebalanced` int NOT NULL,
	`totalCapitalAllocated` decimal(18,2) NOT NULL,
	`changes` json NOT NULL,
	`portfolioMetrics` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rebalancingHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `riskLimitBreaches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`limitType` enum('position_size','daily_loss','max_drawdown','symbol_exposure','portfolio_exposure','risk_per_trade') NOT NULL,
	`limitValue` decimal(18,2) NOT NULL,
	`actualValue` decimal(18,2) NOT NULL,
	`symbol` varchar(20),
	`action` enum('blocked','warning','shutdown') NOT NULL,
	`resolved` boolean NOT NULL DEFAULT false,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `riskLimitBreaches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`paperTrading` boolean NOT NULL DEFAULT true,
	`maxPositionSize` int NOT NULL DEFAULT 20,
	`minConfidence` int NOT NULL DEFAULT 60,
	`stopLoss` int NOT NULL DEFAULT 5,
	`takeProfit` int NOT NULL DEFAULT 10,
	`enableFastAgents` boolean NOT NULL DEFAULT true,
	`enableSlowAgents` boolean NOT NULL DEFAULT true,
	`agentUpdateInterval` int NOT NULL DEFAULT 10,
	`emailNotifications` boolean NOT NULL DEFAULT true,
	`pushNotifications` boolean NOT NULL DEFAULT false,
	`tradeAlerts` boolean NOT NULL DEFAULT true,
	`signalAlerts` boolean NOT NULL DEFAULT false,
	`maxDailyLoss` int NOT NULL DEFAULT 1000,
	`maxDrawdown` int NOT NULL DEFAULT 15,
	`riskPerTrade` int NOT NULL DEFAULT 2,
	`latencyAlertsEnabled` boolean NOT NULL DEFAULT true,
	`latencyP50Threshold` int NOT NULL DEFAULT 100,
	`latencyP95Threshold` int NOT NULL DEFAULT 500,
	`latencyP99Threshold` int NOT NULL DEFAULT 1000,
	`latencyEmailAlerts` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `settings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `systemConfig` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`configKey` varchar(100) NOT NULL,
	`configValue` json NOT NULL,
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `systemConfig_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `systemHealth` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentName` varchar(50) NOT NULL,
	`status` enum('healthy','degraded','failed','stopped') NOT NULL,
	`lastHeartbeat` timestamp NOT NULL,
	`errorCount` int NOT NULL DEFAULT 0,
	`lastError` text,
	`uptime` int NOT NULL DEFAULT 0,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `systemHealth_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `thresholdConfig` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`highVolatilityAtrMin` decimal(10,2) NOT NULL DEFAULT '5.00',
	`mediumVolatilityAtrMin` decimal(10,2) NOT NULL DEFAULT '2.00',
	`lowVolatilityAtrMax` decimal(10,2) NOT NULL DEFAULT '2.00',
	`highVolatilityThreshold` decimal(5,2) NOT NULL DEFAULT '50.00',
	`mediumVolatilityThreshold` decimal(5,2) NOT NULL DEFAULT '60.00',
	`lowVolatilityThreshold` decimal(5,2) NOT NULL DEFAULT '70.00',
	`scoutTier` decimal(5,2) NOT NULL DEFAULT '3.00',
	`standardTier` decimal(5,2) NOT NULL DEFAULT '5.00',
	`highTier` decimal(5,2) NOT NULL DEFAULT '7.00',
	`veryHighTier` decimal(5,2) NOT NULL DEFAULT '10.00',
	`extremeTier` decimal(5,2) NOT NULL DEFAULT '15.00',
	`maxTier` decimal(5,2) NOT NULL DEFAULT '20.00',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `thresholdConfig_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tradeExecutionLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tradeId` int,
	`symbol` varchar(20) NOT NULL,
	`side` enum('long','short') NOT NULL,
	`orderType` enum('market','limit','stop','twap','vwap','iceberg') NOT NULL,
	`quantity` decimal(18,8) NOT NULL,
	`price` decimal(18,8),
	`status` enum('pending','submitted','filled','partial','rejected','cancelled') NOT NULL,
	`exchange` varchar(50) NOT NULL,
	`orderId` varchar(100),
	`fillPrice` decimal(18,8),
	`fillQuantity` decimal(18,8),
	`rejectionReason` text,
	`executionTimeMs` int,
	`slippage` decimal(10,6),
	`fees` decimal(18,8),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tradeExecutionLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`exchangeId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`side` enum('long','short') NOT NULL,
	`entryPrice` decimal(18,8) NOT NULL,
	`exitPrice` decimal(18,8),
	`quantity` decimal(18,8) NOT NULL,
	`entryTime` timestamp NOT NULL,
	`exitTime` timestamp,
	`status` enum('open','closed','cancelled') NOT NULL,
	`pnl` decimal(18,8),
	`pnlAfterCosts` decimal(18,8),
	`totalCosts` decimal(18,8),
	`costBreakdown` json,
	`tradeQualityScore` varchar(2),
	`confidence` decimal(5,4),
	`patternUsed` varchar(100),
	`exitReason` varchar(50),
	`agentSignals` json,
	`expectedPath` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `trades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tradingModeConfig` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`mode` enum('paper','real') NOT NULL DEFAULT 'paper',
	`enableSlippage` boolean NOT NULL DEFAULT true,
	`enableCommission` boolean NOT NULL DEFAULT true,
	`enableMarketImpact` boolean NOT NULL DEFAULT true,
	`enableLatency` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tradingModeConfig_id` PRIMARY KEY(`id`),
	CONSTRAINT `tradingModeConfig_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `tradingSymbols` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tradingSymbols_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userBias` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`bias` enum('bearish','neutral','bullish') NOT NULL DEFAULT 'neutral',
	`biasValue` decimal(3,2) NOT NULL,
	`vetoNextTrade` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userBias_id` PRIMARY KEY(`id`),
	CONSTRAINT `userBias_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `winningPatterns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`patternName` varchar(100) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`timeframe` enum('1m','5m','1h','4h','1d') NOT NULL,
	`patternDescription` text,
	`patternVector` json,
	`totalTrades` int NOT NULL DEFAULT 0,
	`winningTrades` int NOT NULL DEFAULT 0,
	`winRate` decimal(5,4),
	`avgPnl` decimal(18,8),
	`profitFactor` decimal(5,2),
	`confidenceScore` int NOT NULL DEFAULT 0,
	`stopLoss` decimal(5,2),
	`takeProfit` decimal(5,2),
	`maxHold` int,
	`performanceHistory` json,
	`isActive` boolean NOT NULL DEFAULT true,
	`alphaDecayFlag` boolean NOT NULL DEFAULT false,
	`lastUsed` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `winningPatterns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `email` varchar(320) NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `loginMethod` varchar(64) NOT NULL DEFAULT '';