CREATE TABLE `agentSignals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`agentName` varchar(50) NOT NULL,
	`signalType` varchar(50) NOT NULL,
	`signalData` json NOT NULL,
	`confidence` decimal(5,4),
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
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `positions_id` PRIMARY KEY(`id`)
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
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320) NOT NULL DEFAULT '',
	`loginMethod` varchar(64) NOT NULL DEFAULT '',
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE TABLE `winningPatterns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`patternName` varchar(100) NOT NULL,
	`timeframe` enum('5m','4h','1d') NOT NULL,
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
