CREATE TABLE `agentAccuracy` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`agentName` varchar(50) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`accuracy` varchar(50) NOT NULL,
	`totalTrades` int NOT NULL DEFAULT 0,
	`correctTrades` int NOT NULL DEFAULT 0,
	`lastUpdated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentAccuracy_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agentActivities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`userId` int NOT NULL,
	`activityType` enum('analysis','signal','alert','trade_executed','whale_detected','risk_warning','insight','error') NOT NULL,
	`title` varchar(200) NOT NULL,
	`summary` text,
	`details` json,
	`importance` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`isRead` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentActivities_id` PRIMARY KEY(`id`)
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
	`accuracy` varchar(50),
	`avgConfidence` varchar(50),
	`sharpeRatio` varchar(50),
	`profitFactor` varchar(50),
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
	`confidence` varchar(50),
	`executionScore` int,
	`marketConditions` json,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentSignals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agentWatchedWallets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`userId` int NOT NULL,
	`address` varchar(100) NOT NULL,
	`chain` enum('ethereum','bitcoin','solana','polygon','arbitrum','optimism','base','avalanche') NOT NULL,
	`label` varchar(100),
	`minTransactionValue` decimal(20,2) DEFAULT '100000',
	`trackIncoming` boolean NOT NULL DEFAULT true,
	`trackOutgoing` boolean NOT NULL DEFAULT true,
	`totalTransactions` int NOT NULL DEFAULT 0,
	`lastTransactionAt` timestamp,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agentWatchedWallets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agentWeights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`technicalWeight` varchar(50) NOT NULL DEFAULT '40.00',
	`patternWeight` varchar(50) NOT NULL DEFAULT '35.00',
	`orderFlowWeight` varchar(50) NOT NULL DEFAULT '25.00',
	`sentimentWeight` varchar(50) NOT NULL DEFAULT '33.33',
	`newsWeight` varchar(50) NOT NULL DEFAULT '33.33',
	`macroWeight` varchar(50) NOT NULL DEFAULT '33.34',
	`onChainWeight` varchar(50) NOT NULL DEFAULT '0.00',
	`whaleTrackerWeight` varchar(50) NOT NULL DEFAULT '15.00',
	`fundingRateWeight` varchar(50) NOT NULL DEFAULT '15.00',
	`liquidationWeight` varchar(50) NOT NULL DEFAULT '15.00',
	`onChainFlowWeight` varchar(50) NOT NULL DEFAULT '15.00',
	`volumeProfileWeight` varchar(50) NOT NULL DEFAULT '20.00',
	`fastAgentMultiplier` varchar(50) NOT NULL DEFAULT '1.00',
	`slowAgentMultiplier` varchar(50) NOT NULL DEFAULT '0.20',
	`phase2AgentMultiplier` varchar(50) NOT NULL DEFAULT '0.50',
	`timeframeBonus` varchar(50) NOT NULL DEFAULT '10.00',
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
CREATE TABLE `archived_ticks` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`price` varchar(50) NOT NULL,
	`volume` varchar(50),
	`bid` varchar(50),
	`ask` varchar(50),
	`timestampMs` bigint NOT NULL,
	`source` enum('coinapi','coinbase','binance') NOT NULL DEFAULT 'coinapi',
	`sequenceNumber` bigint,
	`archivedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `archived_ticks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `automatedTradeLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`signalId` varchar(100),
	`signalType` varchar(50) NOT NULL,
	`signalConfidence` varchar(50) NOT NULL,
	`signalData` json NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`side` enum('long','short') NOT NULL,
	`requestedQuantity` varchar(50),
	`requestedValue` varchar(50),
	`status` enum('pending','executed','rejected','failed','cancelled') NOT NULL,
	`positionId` int,
	`executedPrice` varchar(50),
	`executedQuantity` varchar(50),
	`executionLatencyMs` int,
	`rejectionReason` varchar(200),
	`rejectionDetails` json,
	`preTradeBalance` varchar(50),
	`preTradeEquity` varchar(50),
	`preTradeOpenPositions` int,
	`dailyTradeCount` int,
	`dailyPnL` varchar(50),
	`settingsSnapshot` json,
	`signalReceivedAt` timestamp NOT NULL,
	`evaluatedAt` timestamp NOT NULL,
	`executedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `automatedTradeLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `automatedTradingMetrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`periodStart` timestamp NOT NULL,
	`periodEnd` timestamp NOT NULL,
	`periodType` enum('hourly','daily','weekly','monthly') NOT NULL,
	`totalSignalsReceived` int NOT NULL DEFAULT 0,
	`totalTradesExecuted` int NOT NULL DEFAULT 0,
	`totalTradesRejected` int NOT NULL DEFAULT 0,
	`executionRate` varchar(50),
	`totalPnL` varchar(50) DEFAULT '0.00',
	`winningTrades` int NOT NULL DEFAULT 0,
	`losingTrades` int NOT NULL DEFAULT 0,
	`winRate` varchar(50),
	`avgWin` varchar(50),
	`avgLoss` varchar(50),
	`profitFactor` varchar(50),
	`avgSignalToExecutionMs` int,
	`p95SignalToExecutionMs` int,
	`maxDrawdown` varchar(50),
	`sharpeRatio` varchar(50),
	`rejectionReasons` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `automatedTradingMetrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `automatedTradingSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`minSignalConfidence` int NOT NULL DEFAULT 70,
	`maxPositionSizePercent` int NOT NULL DEFAULT 10,
	`useKellyCriterion` boolean NOT NULL DEFAULT false,
	`kellyFraction` varchar(50) DEFAULT '0.25',
	`maxTradesPerDay` int NOT NULL DEFAULT 10,
	`maxOpenPositions` int NOT NULL DEFAULT 5,
	`cooldownMinutes` int NOT NULL DEFAULT 15,
	`maxDailyLossUSD` varchar(50) NOT NULL DEFAULT '500.00',
	`stopOnConsecutiveLosses` int NOT NULL DEFAULT 3,
	`requireBothAgentTypes` boolean NOT NULL DEFAULT true,
	`tradingHours` json,
	`allowedSymbols` json,
	`blockedSymbols` json,
	`enableTechnicalSignals` boolean NOT NULL DEFAULT true,
	`enableSentimentSignals` boolean NOT NULL DEFAULT true,
	`enableOnChainSignals` boolean NOT NULL DEFAULT false,
	`useMarketOrders` boolean NOT NULL DEFAULT true,
	`limitOrderOffsetPercent` varchar(50) DEFAULT '0.10',
	`notifyOnExecution` boolean NOT NULL DEFAULT true,
	`notifyOnRejection` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `automatedTradingSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `automatedTradingSettings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `balanceVerificationLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`exchangeId` int NOT NULL,
	`verificationType` enum('pre_live_switch','pre_trade','periodic_check','manual_check') NOT NULL,
	`availableBalance` decimal(20,8) NOT NULL,
	`totalBalance` decimal(20,8) NOT NULL,
	`marginUsed` decimal(20,8),
	`currency` varchar(10) NOT NULL,
	`minimumRequired` decimal(20,8) NOT NULL,
	`isVerified` boolean NOT NULL,
	`verificationMessage` text,
	`actionAllowed` boolean NOT NULL,
	`actionBlocked` boolean NOT NULL,
	`blockReason` text,
	`exchangeResponse` json,
	`latencyMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `balanceVerificationLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `candleData` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`timestamp` timestamp NOT NULL,
	`open` varchar(50) NOT NULL,
	`high` varchar(50) NOT NULL,
	`low` varchar(50) NOT NULL,
	`close` varchar(50) NOT NULL,
	`volume` varchar(50) NOT NULL,
	`interval` varchar(10) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `candleData_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `capitalAllocations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`totalCapital` varchar(50) NOT NULL,
	`activeTradingCapital` varchar(50) NOT NULL,
	`maintenanceMarginBuffer` varchar(50) NOT NULL,
	`drawdownProtectionReserve` varchar(50) NOT NULL,
	`opportunityCapital` varchar(50) NOT NULL,
	`activeTradingPercent` varchar(50) NOT NULL,
	`marginBufferPercent` varchar(50) NOT NULL,
	`drawdownReservePercent` varchar(50) NOT NULL,
	`opportunityPercent` varchar(50) NOT NULL,
	`strategyAllocations` json,
	`trigger` enum('scheduled','performance','drawdown','volatility','manual') NOT NULL,
	`reason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `capitalAllocations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `correlationBacktestResults` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`backtestName` varchar(100) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`startDate` timestamp NOT NULL,
	`endDate` timestamp NOT NULL,
	`whaleWindowHours` int NOT NULL DEFAULT 24,
	`minWhaleImpactScore` int NOT NULL DEFAULT 20,
	`totalSignals` int NOT NULL DEFAULT 0,
	`alignedSignals` int NOT NULL DEFAULT 0,
	`conflictingSignals` int NOT NULL DEFAULT 0,
	`neutralSignals` int NOT NULL DEFAULT 0,
	`alignedWinRate` decimal(6,4),
	`alignedAvgReturn` decimal(10,4),
	`alignedProfitFactor` decimal(8,4),
	`alignedSharpeRatio` decimal(8,4),
	`alignedMaxDrawdown` decimal(8,4),
	`conflictingWinRate` decimal(6,4),
	`conflictingAvgReturn` decimal(10,4),
	`conflictingProfitFactor` decimal(8,4),
	`baselineWinRate` decimal(6,4),
	`baselineAvgReturn` decimal(10,4),
	`baselineProfitFactor` decimal(8,4),
	`baselineSharpeRatio` decimal(8,4),
	`correlationCoefficient` decimal(6,4),
	`correlationPValue` decimal(10,8),
	`optimalLagHours` int,
	`winRateImprovement` decimal(8,4),
	`returnImprovement` decimal(8,4),
	`status` enum('running','completed','failed') NOT NULL DEFAULT 'running',
	`errorMessage` text,
	`executionTimeMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `correlationBacktestResults_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `correlationBacktestTrades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`backtestId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`signalType` enum('BUY','SELL') NOT NULL,
	`signalTimestamp` timestamp NOT NULL,
	`signalConfidence` decimal(5,4) NOT NULL,
	`signalStrength` decimal(5,4) NOT NULL,
	`whaleImpactScore` decimal(6,2) NOT NULL,
	`whaleFlowSentiment` enum('bullish','bearish','neutral') NOT NULL,
	`correlationAlignment` enum('aligned','conflicting','neutral') NOT NULL,
	`whaleTransactionCount` int NOT NULL DEFAULT 0,
	`entryPrice` decimal(20,8) NOT NULL,
	`exitPrice` decimal(20,8) NOT NULL,
	`holdingPeriodHours` decimal(10,2) NOT NULL,
	`pnlPercent` decimal(10,4) NOT NULL,
	`outcome` enum('win','loss','breakeven') NOT NULL,
	`boostedPnlPercent` decimal(10,4),
	`boostMultiplierUsed` decimal(4,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `correlationBacktestTrades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dailyBoostingMetrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`date` timestamp NOT NULL,
	`totalBoostedTrades` int NOT NULL DEFAULT 0,
	`strongConfirmationTrades` int NOT NULL DEFAULT 0,
	`moderateConfirmationTrades` int NOT NULL DEFAULT 0,
	`conflictingTrades` int NOT NULL DEFAULT 0,
	`boostedTradesWinRate` decimal(6,4),
	`boostedTradesPnl` decimal(20,8),
	`nonBoostedTradesWinRate` decimal(6,4),
	`nonBoostedTradesPnl` decimal(20,8),
	`avgBoostMultiplier` decimal(4,2),
	`pnlAttributedToBoost` decimal(20,8),
	`maxBoostedPositionSize` decimal(20,8),
	`boostedPositionExposure` decimal(8,4),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dailyBoostingMetrics_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_daily_boost_user_date` UNIQUE(`userId`,`date`)
);
--> statement-breakpoint
CREATE TABLE `dataGapLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`gapStartMs` bigint NOT NULL,
	`gapEndMs` bigint NOT NULL,
	`expectedSequence` bigint,
	`actualSequence` bigint,
	`missedTicksEstimate` int NOT NULL DEFAULT 0,
	`recoveryStatus` enum('pending','recovering','recovered','failed') NOT NULL DEFAULT 'pending',
	`recoveryAttempts` int NOT NULL DEFAULT 0,
	`recoveredAt` timestamp,
	`detectedBy` varchar(50) NOT NULL DEFAULT 'coinapi_websocket',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dataGapLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dataQualityMetrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`interval` varchar(10) NOT NULL,
	`dataStartTime` timestamp NOT NULL,
	`dataEndTime` timestamp NOT NULL,
	`totalCandles` int NOT NULL DEFAULT 0,
	`missingCandles` int NOT NULL DEFAULT 0,
	`duplicateCandles` int NOT NULL DEFAULT 0,
	`outlierCandles` int NOT NULL DEFAULT 0,
	`qualityScore` int NOT NULL DEFAULT 100,
	`validationDetails` text,
	`isValid` boolean NOT NULL DEFAULT true,
	`validatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dataQualityMetrics_id` PRIMARY KEY(`id`)
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
	`maxPositionSize` varchar(50) NOT NULL DEFAULT '20.00',
	`maxTotalExposure` varchar(50) NOT NULL DEFAULT '50.00',
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
	`open` varchar(50) NOT NULL,
	`high` varchar(50) NOT NULL,
	`low` varchar(50) NOT NULL,
	`close` varchar(50) NOT NULL,
	`volume` varchar(50) NOT NULL,
	`source` varchar(50) NOT NULL DEFAULT 'binance',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `historicalCandles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `learnedParameters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parameterName` varchar(100) NOT NULL,
	`parameterType` enum('consensus_threshold','agent_confidence','alpha_criteria','regime_multiplier','other') NOT NULL,
	`symbol` varchar(20),
	`regime` varchar(50),
	`agentName` varchar(50),
	`value` text NOT NULL,
	`confidence` decimal(5,4) NOT NULL DEFAULT '0.5000',
	`sampleSize` int NOT NULL DEFAULT 0,
	`winRate` decimal(5,4),
	`sharpeRatio` decimal(6,3),
	`lastUpdated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `learnedParameters_id` PRIMARY KEY(`id`),
	CONSTRAINT `unique_parameter` UNIQUE(`parameterName`,`symbol`,`regime`,`agentName`)
);
--> statement-breakpoint
CREATE TABLE `mlTrainingData` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tradeId` int NOT NULL,
	`features` json NOT NULL,
	`label` varchar(50) NOT NULL,
	`tradeQualityScore` varchar(2) NOT NULL,
	`qualityWeight` varchar(50) NOT NULL,
	`marketRegime` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mlTrainingData_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `nnPredictions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`modelType` enum('lstm','transformer','ensemble') NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`timeframe` varchar(10) NOT NULL,
	`predictionTimestamp` timestamp NOT NULL,
	`targetTimestamp` timestamp NOT NULL,
	`predictedPrice` decimal(20,8) NOT NULL,
	`predictedDirection` enum('up','down','neutral') NOT NULL,
	`confidence` decimal(6,4) NOT NULL,
	`actualPrice` decimal(20,8),
	`actualDirection` enum('up','down','neutral'),
	`predictionError` decimal(10,6),
	`wasCorrect` boolean,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `nnPredictions_id` PRIMARY KEY(`id`)
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
CREATE TABLE `onchainAgentSignals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`signal` enum('strong_buy','buy','hold','sell','strong_sell') NOT NULL,
	`confidence` decimal(5,2) NOT NULL,
	`currentPrice` decimal(20,8) NOT NULL,
	`entryPrice` decimal(20,8),
	`targetPrice` decimal(20,8),
	`stopLoss` decimal(20,8),
	`reasoning` text,
	`indicators` json,
	`timeframe` varchar(10) NOT NULL,
	`validUntil` timestamp NOT NULL,
	`status` enum('pending','executed','expired','cancelled') NOT NULL DEFAULT 'pending',
	`outcome` enum('win','loss','breakeven','pending') NOT NULL DEFAULT 'pending',
	`actualExitPrice` decimal(20,8),
	`pnlPercent` decimal(10,4),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `onchainAgentSignals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `onchainAgents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`avatar` varchar(255),
	`agentType` enum('whale_tracker','market_analyzer','trading_strategist','risk_manager','sentiment_analyst','arbitrage_hunter','custom') NOT NULL,
	`config` json,
	`status` enum('active','paused','stopped','error') NOT NULL DEFAULT 'stopped',
	`lastRunAt` timestamp,
	`nextRunAt` timestamp,
	`errorMessage` text,
	`totalRuns` int NOT NULL DEFAULT 0,
	`successfulRuns` int NOT NULL DEFAULT 0,
	`totalSignals` int NOT NULL DEFAULT 0,
	`accurateSignals` int NOT NULL DEFAULT 0,
	`canExecuteTrades` boolean NOT NULL DEFAULT false,
	`canSendAlerts` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `onchainAgents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `otpVerifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`otp` varchar(6) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`verified` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `otpVerifications_id` PRIMARY KEY(`id`)
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
	`quantity` varchar(50) NOT NULL,
	`price` varchar(50),
	`stopPrice` varchar(50),
	`status` enum('pending','filled','cancelled','rejected') NOT NULL,
	`filledPrice` varchar(50),
	`filledQuantity` varchar(50),
	`commission` varchar(50),
	`slippage` varchar(50),
	`latency` int,
	`strategy` varchar(50) NOT NULL,
	`strategyId` int,
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
	`entryPrice` varchar(50) NOT NULL,
	`currentPrice` varchar(50) NOT NULL,
	`quantity` varchar(50) NOT NULL,
	`stopLoss` varchar(50),
	`takeProfit` varchar(50),
	`partialExits` json,
	`entryTime` timestamp NOT NULL,
	`unrealizedPnL` varchar(50) NOT NULL DEFAULT '0.00',
	`unrealizedPnLPercent` varchar(50) NOT NULL DEFAULT '0.00',
	`commission` varchar(50) NOT NULL DEFAULT '0.00',
	`strategy` varchar(50) NOT NULL,
	`strategyId` int,
	`status` enum('open','closed') NOT NULL DEFAULT 'open',
	`exitReason` enum('manual','stop_loss','take_profit','liquidation','system'),
	`exitTime` timestamp,
	`realizedPnl` varchar(50),
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
	`price` varchar(50) NOT NULL,
	`quantity` varchar(50) NOT NULL,
	`pnl` varchar(50) NOT NULL,
	`commission` varchar(50) NOT NULL,
	`strategy` varchar(50) NOT NULL,
	`strategyId` int,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `paperTrades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `paperTransactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('DEPOSIT','WITHDRAWAL','TRADE_PROFIT','TRADE_LOSS','COMMISSION','WALLET_RESET','ADJUSTMENT','POSITION_OPEN','POSITION_CLOSE') NOT NULL,
	`amount` varchar(50) NOT NULL,
	`balanceBefore` varchar(50) NOT NULL,
	`balanceAfter` varchar(50) NOT NULL,
	`relatedOrderId` varchar(100),
	`relatedPositionId` int,
	`description` text,
	`metadata` json,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `paperTransactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `paperWallets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`balance` varchar(50) NOT NULL DEFAULT '10000.00',
	`equity` varchar(50) NOT NULL DEFAULT '10000.00',
	`margin` varchar(50) NOT NULL DEFAULT '0.00',
	`marginLevel` varchar(50) NOT NULL DEFAULT '0.00',
	`totalPnL` varchar(50) NOT NULL DEFAULT '0.00',
	`realizedPnL` varchar(50) NOT NULL DEFAULT '0.00',
	`unrealizedPnL` varchar(50) NOT NULL DEFAULT '0.00',
	`totalCommission` varchar(50) NOT NULL DEFAULT '0.00',
	`totalTrades` int NOT NULL DEFAULT 0,
	`winningTrades` int NOT NULL DEFAULT 0,
	`losingTrades` int NOT NULL DEFAULT 0,
	`winRate` varchar(50) NOT NULL DEFAULT '0.00',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `paperWallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `paperWallets_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `parameterOptimizationHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`optimizationType` enum('strategy_params','agent_weights','risk_params','ml_hyperparams') NOT NULL,
	`targetMetric` varchar(50) NOT NULL,
	`symbol` varchar(20),
	`parameterSpace` text,
	`bestParameters` text,
	`bestScore` decimal(15,6),
	`iterationsCompleted` int NOT NULL DEFAULT 0,
	`totalIterations` int NOT NULL,
	`status` enum('running','completed','failed') NOT NULL DEFAULT 'running',
	`error` text,
	`startTime` timestamp NOT NULL,
	`endTime` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `parameterOptimizationHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pipelineStatus` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pipelineType` enum('data_ingestion','model_training','model_validation','model_deployment') NOT NULL,
	`symbol` varchar(20),
	`status` enum('idle','running','completed','failed','paused') NOT NULL DEFAULT 'idle',
	`currentStep` varchar(100),
	`progress` int NOT NULL DEFAULT 0,
	`lastRunStart` timestamp,
	`lastRunEnd` timestamp,
	`nextScheduledRun` timestamp,
	`totalRuns` int NOT NULL DEFAULT 0,
	`successfulRuns` int NOT NULL DEFAULT 0,
	`failedRuns` int NOT NULL DEFAULT 0,
	`lastError` text,
	`consecutiveFailures` int NOT NULL DEFAULT 0,
	`config` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pipelineStatus_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `portfolioRiskMetrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL DEFAULT 1,
	`timestamp` timestamp NOT NULL,
	`totalValue` varchar(50) NOT NULL,
	`dailyReturn` varchar(50),
	`cumulativeReturn` varchar(50),
	`sharpeRatio` varchar(50),
	`sortinoRatio` varchar(50),
	`maxDrawdown` varchar(50),
	`volatility` varchar(50),
	`numberOfPositions` int NOT NULL,
	`allocatedCapital` varchar(50) NOT NULL,
	`availableCash` varchar(50) NOT NULL,
	`correlationMatrix` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `portfolioRiskMetrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `portfolioSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`snapshotDate` timestamp NOT NULL,
	`totalEquity` varchar(50) NOT NULL,
	`cash` varchar(50) NOT NULL,
	`positionsValue` varchar(50) NOT NULL,
	`unrealizedPnL` varchar(50) NOT NULL,
	`realizedPnL` varchar(50) NOT NULL,
	`dailyReturn` varchar(50),
	`dailyPnL` varchar(50),
	`numberOfPositions` int NOT NULL,
	`positionDetails` json,
	`portfolioVaR95` varchar(50),
	`currentDrawdown` varchar(50),
	`sharpeRatio` varchar(50),
	`activeTradingCapital` varchar(50),
	`reserveCapital` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `portfolioSnapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `positionDiscrepancies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`reconciliationLogId` int NOT NULL,
	`positionId` int,
	`metaapiPositionId` varchar(100),
	`symbol` varchar(20) NOT NULL,
	`discrepancyType` enum('quantity_mismatch','price_mismatch','status_mismatch','missing_local','missing_metaapi','pnl_mismatch','timestamp_drift') NOT NULL,
	`severity` enum('critical','warning','info') NOT NULL,
	`field` varchar(50) NOT NULL,
	`localValue` text,
	`metaapiValue` text,
	`difference` text,
	`resolved` boolean NOT NULL DEFAULT false,
	`resolutionMethod` enum('auto_sync_local','auto_sync_metaapi','manual_override','ignored'),
	`resolutionNotes` text,
	`resolvedBy` int,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `positionDiscrepancies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `positionRiskMetrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`positionId` int NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`positionVaR95` varchar(50),
	`varContribution` varchar(50),
	`correlationWithPortfolio` varchar(50),
	`correlationWithOthers` json,
	`kellyOptimalSize` varchar(50),
	`currentSize` varchar(50),
	`sizeDeviation` varchar(50),
	`stopLossDistance` varchar(50),
	`takeProfitDistance` varchar(50),
	`riskRewardRatio` varchar(50),
	`holdingPeriod` int,
	`expectedHoldingPeriod` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `positionRiskMetrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tradeId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`side` enum('long','short') NOT NULL,
	`entryPrice` varchar(50) NOT NULL,
	`currentPrice` varchar(50),
	`quantity` varchar(50) NOT NULL,
	`stopLoss` varchar(50) NOT NULL,
	`takeProfit` varchar(50) NOT NULL,
	`expectedPath` json NOT NULL,
	`currentDeviation` varchar(50),
	`lastRevalidation` timestamp,
	`thesisValid` boolean NOT NULL DEFAULT true,
	`unrealizedPnl` varchar(50),
	`status` enum('open','closed') NOT NULL DEFAULT 'open',
	`exitReason` enum('manual','stop_loss','take_profit','liquidation','system'),
	`exitTime` timestamp,
	`realizedPnl` varchar(50),
	`orderId` varchar(100),
	`clientOrderId` varchar(100),
	`orderStatus` enum('PENDING','OPEN','FILLED','CANCELLED','EXPIRED','FAILED') DEFAULT 'PENDING',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `preTradeValidations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`strategyId` int,
	`symbol` varchar(20) NOT NULL,
	`side` enum('long','short') NOT NULL,
	`requestedQuantity` varchar(50) NOT NULL,
	`requestedValue` varchar(50) NOT NULL,
	`currentPrice` varchar(50) NOT NULL,
	`passed` boolean NOT NULL,
	`overallRiskScore` varchar(50),
	`kellyOptimalSize` varchar(50),
	`kellyDeviation` varchar(50),
	`kellyPassed` boolean,
	`portfolioVaR` varchar(50),
	`positionVaR` varchar(50),
	`varLimit` varchar(50),
	`varUtilization` varchar(50),
	`varPassed` boolean,
	`circuitBreakerActive` boolean,
	`circuitBreakerReason` varchar(100),
	`circuitBreakerPassed` boolean,
	`availableBalance` varchar(50),
	`requiredMargin` varchar(50),
	`marginUtilization` varchar(50),
	`balancePassed` boolean,
	`currentPositions` int,
	`maxPositions` int,
	`positionLimitPassed` boolean,
	`rejectionReasons` json,
	`recommendedAction` text,
	`requiresApproval` boolean NOT NULL DEFAULT false,
	`approvedBy` int,
	`approvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `preTradeValidations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rebalancingHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL DEFAULT 1,
	`timestamp` timestamp NOT NULL,
	`trigger` enum('time','confidence','deviation','manual') NOT NULL,
	`symbolsRebalanced` int NOT NULL,
	`totalCapitalAllocated` varchar(50) NOT NULL,
	`changes` json NOT NULL,
	`portfolioMetrics` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rebalancingHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reconciliationHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`discrepancyId` int NOT NULL,
	`action` enum('detected','auto_resolved','manual_resolved','ignored','escalated') NOT NULL,
	`beforeState` json NOT NULL,
	`afterState` json,
	`performedBy` enum('system','user') NOT NULL,
	`userId_performer` int,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reconciliationHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reconciliationLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` enum('running','completed','failed') NOT NULL,
	`triggerType` enum('scheduled','manual','on_demand') NOT NULL,
	`totalPositionsChecked` int NOT NULL DEFAULT 0,
	`discrepanciesFound` int NOT NULL DEFAULT 0,
	`autoResolved` int NOT NULL DEFAULT 0,
	`manualReviewRequired` int NOT NULL DEFAULT 0,
	`executionTimeMs` int,
	`errorMessage` text,
	`startedAt` timestamp NOT NULL,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reconciliationLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `riskEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`eventType` enum('drawdown_alert','var_breach','margin_warning','circuit_breaker_yellow','circuit_breaker_orange','circuit_breaker_red','circuit_breaker_emergency','position_size_violation','correlation_spike','volatility_spike','reserve_deployment','forced_liquidation') NOT NULL,
	`severity` enum('info','warning','critical','emergency') NOT NULL,
	`title` varchar(200) NOT NULL,
	`description` text,
	`portfolioValue` varchar(50),
	`drawdownPercent` varchar(50),
	`varBreach` varchar(50),
	`marginUtilization` varchar(50),
	`actionTaken` text,
	`positionsAffected` json,
	`capitalAdjustment` varchar(50),
	`resolved` boolean NOT NULL DEFAULT false,
	`resolvedAt` timestamp,
	`resolutionNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `riskEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `riskLimitBreaches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`limitType` enum('position_size','daily_loss','max_drawdown','symbol_exposure','portfolio_exposure','risk_per_trade') NOT NULL,
	`limitValue` varchar(50) NOT NULL,
	`actualValue` varchar(50) NOT NULL,
	`symbol` varchar(20),
	`action` enum('blocked','warning','shutdown') NOT NULL,
	`resolved` boolean NOT NULL DEFAULT false,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `riskLimitBreaches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `riskMetrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`portfolioValue` varchar(50) NOT NULL,
	`portfolioVaR95` varchar(50),
	`portfolioVaR99` varchar(50),
	`historicalVaR` varchar(50),
	`parametricVaR` varchar(50),
	`monteCarloVaR` varchar(50),
	`currentDrawdown` varchar(50),
	`maxDrawdown` varchar(50),
	`peakEquity` varchar(50),
	`drawdownDuration` int,
	`sharpeRatio30d` varchar(50),
	`sharpeRatio60d` varchar(50),
	`sharpeRatio90d` varchar(50),
	`sortinoRatio` varchar(50),
	`calmarRatio` varchar(50),
	`realizedVolatility` varchar(50),
	`impliedVolatility` varchar(50),
	`volatilityPercentile` int,
	`currentLeverage` varchar(50),
	`marginUtilization` varchar(50),
	`avgPositionCorrelation` varchar(50),
	`portfolioDiversification` varchar(50),
	`circuitBreakerLevel` enum('green','yellow','orange','red','emergency') NOT NULL DEFAULT 'green',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `riskMetrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rlModelVersions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`modelId` int NOT NULL,
	`version` int NOT NULL,
	`versionTag` varchar(50),
	`modelData` mediumtext,
	`config` text,
	`sharpeRatio` decimal(10,6),
	`maxDrawdown` decimal(10,6),
	`winRate` decimal(10,6),
	`totalPnL` decimal(20,8),
	`trainingDataStart` timestamp,
	`trainingDataEnd` timestamp,
	`candleCount` int DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT false,
	`isStable` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`notes` text,
	CONSTRAINT `rlModelVersions_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_model_version` UNIQUE(`modelId`,`version`)
);
--> statement-breakpoint
CREATE TABLE `rlModels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`agentType` enum('dqn','ppo') NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`timeframe` varchar(10) NOT NULL,
	`config` text,
	`modelData` mediumtext,
	`status` enum('training','ready','paper_trading','live','disabled') NOT NULL DEFAULT 'training',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `rlModels_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rlTrainingHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`modelId` int NOT NULL,
	`startTime` timestamp NOT NULL,
	`endTime` timestamp,
	`episodes` int NOT NULL DEFAULT 0,
	`totalTimesteps` int NOT NULL DEFAULT 0,
	`finalPnl` decimal(20,8),
	`finalSharpe` decimal(10,4),
	`finalMaxDrawdown` decimal(10,4),
	`finalWinRate` decimal(6,4),
	`tradeCount` int DEFAULT 0,
	`status` enum('running','completed','failed') NOT NULL DEFAULT 'running',
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rlTrainingHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `serviceHealth` (
	`id` int AUTO_INCREMENT NOT NULL,
	`serviceName` varchar(100) NOT NULL,
	`status` enum('healthy','degraded','down','unknown') NOT NULL DEFAULT 'unknown',
	`lastCheckAt` timestamp NOT NULL,
	`lastHealthyAt` timestamp,
	`consecutiveFailures` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `serviceHealth_id` PRIMARY KEY(`id`),
	CONSTRAINT `serviceHealth_serviceName_unique` UNIQUE(`serviceName`)
);
--> statement-breakpoint
CREATE TABLE `serviceHealthHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`serviceName` varchar(100) NOT NULL,
	`status` enum('healthy','degraded','down','unknown') NOT NULL,
	`responseTime` int,
	`errorMessage` text,
	`metadata` json,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `serviceHealthHistory_id` PRIMARY KEY(`id`)
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
CREATE TABLE `signalBoostingHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`originalSignalId` int,
	`symbol` varchar(20) NOT NULL,
	`signalType` enum('BUY','SELL') NOT NULL,
	`signalSource` varchar(50) NOT NULL,
	`originalConfidence` decimal(5,4) NOT NULL,
	`originalPositionSize` decimal(20,8) NOT NULL,
	`whaleImpactScore` decimal(6,2) NOT NULL,
	`whaleFlowSentiment` enum('bullish','bearish','neutral') NOT NULL,
	`whaleTransactionCount` int NOT NULL DEFAULT 0,
	`netExchangeFlow` decimal(20,2),
	`confirmationLevel` enum('strong','moderate','weak','conflicting','none') NOT NULL,
	`boostMultiplier` decimal(4,2) NOT NULL,
	`boostedPositionSize` decimal(20,8) NOT NULL,
	`boostApplied` boolean NOT NULL DEFAULT false,
	`rejectionReason` varchar(200),
	`tradeId` int,
	`entryPrice` decimal(20,8),
	`exitPrice` decimal(20,8),
	`pnl` decimal(20,8),
	`pnlPercent` decimal(8,4),
	`tradeOutcome` enum('win','loss','breakeven','pending') NOT NULL DEFAULT 'pending',
	`signalTimestamp` timestamp NOT NULL,
	`boostDecisionTimestamp` timestamp NOT NULL,
	`tradeClosedTimestamp` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `signalBoostingHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `signalBoostingSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`strongConfirmationMultiplier` decimal(4,2) NOT NULL DEFAULT '1.50',
	`moderateConfirmationMultiplier` decimal(4,2) NOT NULL DEFAULT '1.25',
	`weakConfirmationMultiplier` decimal(4,2) NOT NULL DEFAULT '1.00',
	`conflictingMultiplier` decimal(4,2) NOT NULL DEFAULT '0.75',
	`strongConfirmationThreshold` int NOT NULL DEFAULT 70,
	`moderateConfirmationThreshold` int NOT NULL DEFAULT 40,
	`minWhaleTransactions` int NOT NULL DEFAULT 3,
	`maxBoostMultiplier` decimal(4,2) NOT NULL DEFAULT '2.00',
	`maxDailyBoostedTrades` int NOT NULL DEFAULT 10,
	`maxBoostedPositionPercent` int NOT NULL DEFAULT 30,
	`requireMinConfidence` int NOT NULL DEFAULT 65,
	`whaleAnalysisWindowHours` int NOT NULL DEFAULT 24,
	`cooldownMinutes` int NOT NULL DEFAULT 30,
	`notifyOnBoost` boolean NOT NULL DEFAULT true,
	`notifyOnConflict` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `signalBoostingSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `signalBoostingSettings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `strategies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`type` enum('momentum','mean_reversion','breakout','scalping','swing','arbitrage') NOT NULL,
	`status` enum('active','suspended','archived') NOT NULL DEFAULT 'active',
	`meanExcessReturn` varchar(50),
	`stdDeviation` varchar(50),
	`kellyFraction` varchar(50),
	`kellyMultiplier` varchar(50) NOT NULL DEFAULT '0.5000',
	`sharpeRatio` varchar(50),
	`sortinoRatio` varchar(50),
	`calmarRatio` varchar(50),
	`winRate` varchar(50),
	`profitFactor` varchar(50),
	`avgWin` varchar(50),
	`avgLoss` varchar(50),
	`maxDrawdown` varchar(50),
	`allocatedCapital` varchar(50) NOT NULL DEFAULT '0.00',
	`targetAllocation` varchar(50),
	`minAllocation` varchar(50),
	`maxAllocation` varchar(50),
	`maxPositionSize` varchar(50) NOT NULL DEFAULT '20.00',
	`maxCorrelation` varchar(50) NOT NULL DEFAULT '0.6000',
	`stopLossPercent` varchar(50) NOT NULL DEFAULT '5.00',
	`takeProfitPercent` varchar(50) NOT NULL DEFAULT '10.00',
	`lastRebalance` timestamp,
	`rebalanceFrequency` enum('daily','weekly','monthly') NOT NULL DEFAULT 'daily',
	`description` text,
	`config` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `strategies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `strategyInstances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`strategyType` varchar(50) NOT NULL,
	`config` json NOT NULL,
	`allocatedBalance` varchar(50) NOT NULL,
	`currentBalance` varchar(50) NOT NULL,
	`status` enum('active','paused','stopped') NOT NULL DEFAULT 'paused',
	`startedAt` timestamp,
	`stoppedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `strategyInstances_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `strategyPerformance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategyId` int NOT NULL,
	`userId` int NOT NULL,
	`totalTrades` int NOT NULL DEFAULT 0,
	`winningTrades` int NOT NULL DEFAULT 0,
	`losingTrades` int NOT NULL DEFAULT 0,
	`winRate` varchar(50) NOT NULL DEFAULT '0.00',
	`totalPnL` varchar(50) NOT NULL DEFAULT '0.00',
	`realizedPnL` varchar(50) NOT NULL DEFAULT '0.00',
	`unrealizedPnL` varchar(50) NOT NULL DEFAULT '0.00',
	`avgWin` varchar(50) NOT NULL DEFAULT '0.00',
	`avgLoss` varchar(50) NOT NULL DEFAULT '0.00',
	`maxDrawdown` varchar(50) DEFAULT '0.00',
	`sharpeRatio` varchar(50),
	`profitFactor` varchar(50),
	`openPositions` int NOT NULL DEFAULT 0,
	`maxOpenPositions` int NOT NULL DEFAULT 0,
	`totalCommission` varchar(50) DEFAULT '0.00',
	`lastUpdated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `strategyPerformance_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `strategyPositions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategyId` int NOT NULL,
	`positionId` int NOT NULL,
	`isPaperTrading` boolean NOT NULL,
	`entryValue` varchar(50) NOT NULL,
	`currentValue` varchar(50),
	`pnl` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `strategyPositions_id` PRIMARY KEY(`id`)
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
CREATE TABLE `systemStartupLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`startupId` varchar(64) NOT NULL,
	`status` enum('in_progress','success','failed','partial') NOT NULL,
	`startedAt` timestamp NOT NULL,
	`completedAt` timestamp,
	`totalChecks` int NOT NULL,
	`passedChecks` int NOT NULL,
	`failedChecks` int NOT NULL,
	`healthCheckResults` json NOT NULL,
	`errorSummary` text,
	`canTrade` boolean NOT NULL DEFAULT false,
	CONSTRAINT `systemStartupLog_id` PRIMARY KEY(`id`),
	CONSTRAINT `systemStartupLog_startupId_unique` UNIQUE(`startupId`)
);
--> statement-breakpoint
CREATE TABLE `thresholdConfig` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`highVolatilityAtrMin` varchar(50) NOT NULL DEFAULT '5.00',
	`mediumVolatilityAtrMin` varchar(50) NOT NULL DEFAULT '2.00',
	`lowVolatilityAtrMax` varchar(50) NOT NULL DEFAULT '2.00',
	`highVolatilityThreshold` varchar(50) NOT NULL DEFAULT '50.00',
	`mediumVolatilityThreshold` varchar(50) NOT NULL DEFAULT '60.00',
	`lowVolatilityThreshold` varchar(50) NOT NULL DEFAULT '70.00',
	`scoutTier` varchar(50) NOT NULL DEFAULT '3.00',
	`standardTier` varchar(50) NOT NULL DEFAULT '5.00',
	`highTier` varchar(50) NOT NULL DEFAULT '7.00',
	`veryHighTier` varchar(50) NOT NULL DEFAULT '10.00',
	`extremeTier` varchar(50) NOT NULL DEFAULT '15.00',
	`maxTier` varchar(50) NOT NULL DEFAULT '20.00',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `thresholdConfig_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tick_cleanup_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`startedAt` timestamp NOT NULL,
	`completedAt` timestamp,
	`status` enum('running','completed','failed') NOT NULL DEFAULT 'running',
	`ticksArchived` int NOT NULL DEFAULT 0,
	`ticksDeleted` int NOT NULL DEFAULT 0,
	`oldestTickArchived` bigint,
	`newestTickArchived` bigint,
	`executionTimeMs` int,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tick_cleanup_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ticks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`price` varchar(50) NOT NULL,
	`volume` varchar(50),
	`bid` varchar(50),
	`ask` varchar(50),
	`timestampMs` bigint NOT NULL,
	`source` enum('coinapi','coinbase','binance') NOT NULL DEFAULT 'coinapi',
	`sequenceNumber` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ticks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tradeDecisionLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`signalId` varchar(64) NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`symbol` varchar(20) NOT NULL,
	`exchange` varchar(50) NOT NULL,
	`price` varchar(50) NOT NULL,
	`signalType` enum('BUY','SELL','HOLD') NOT NULL,
	`signalStrength` varchar(50),
	`fastScore` varchar(50),
	`slowBonus` varchar(50),
	`totalConfidence` varchar(50) NOT NULL,
	`threshold` varchar(50) NOT NULL,
	`agentScores` json NOT NULL,
	`decision` enum('EXECUTED','SKIPPED','VETOED','PENDING','FAILED','PARTIAL') NOT NULL,
	`decisionReason` text,
	`positionId` int,
	`orderId` varchar(100),
	`entryPrice` varchar(50),
	`quantity` varchar(50),
	`positionSizePercent` varchar(50),
	`exitPrice` varchar(50),
	`exitTime` timestamp,
	`exitReason` enum('take_profit','stop_loss','trailing_stop','signal_reversal','manual','timeout','risk_limit'),
	`pnl` varchar(50),
	`pnlPercent` varchar(50),
	`status` enum('SIGNAL_GENERATED','DECISION_MADE','POSITION_OPENED','POSITION_CLOSED','OPPORTUNITY_MISSED') NOT NULL,
	`marketConditions` json,
	`holdDuration` int,
	`maxDrawdown` varchar(50),
	`maxProfit` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tradeDecisionLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tradeExecutionLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tradeId` int,
	`symbol` varchar(20) NOT NULL,
	`side` enum('long','short') NOT NULL,
	`orderType` enum('market','limit','stop','twap','vwap','iceberg') NOT NULL,
	`quantity` varchar(50) NOT NULL,
	`price` varchar(50),
	`status` enum('pending','submitted','filled','partial','rejected','cancelled') NOT NULL,
	`exchange` varchar(50) NOT NULL,
	`orderId` varchar(100),
	`fillPrice` varchar(50),
	`fillQuantity` varchar(50),
	`rejectionReason` text,
	`executionTimeMs` int,
	`slippage` varchar(50),
	`fees` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tradeExecutionLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tradeJournalEntries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tradeId` int,
	`title` varchar(200),
	`setup` text,
	`strategy` varchar(100),
	`timeframe` varchar(20),
	`marketCondition` enum('trending','ranging','volatile','calm'),
	`entryReason` text,
	`confluenceFactors` json,
	`exitReason` text,
	`lessonsLearned` text,
	`mistakes` text,
	`improvements` text,
	`emotionBefore` enum('confident','neutral','anxious','fearful','greedy','frustrated'),
	`emotionDuring` enum('confident','neutral','anxious','fearful','greedy','frustrated'),
	`emotionAfter` enum('satisfied','neutral','disappointed','frustrated','relieved'),
	`executionRating` int,
	`followedPlan` boolean,
	`screenshots` json,
	`tags` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tradeJournalEntries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`exchangeId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`side` enum('long','short') NOT NULL,
	`entryPrice` varchar(50) NOT NULL,
	`exitPrice` varchar(50),
	`quantity` varchar(50) NOT NULL,
	`entryTime` timestamp NOT NULL,
	`exitTime` timestamp,
	`status` enum('open','closed','cancelled') NOT NULL,
	`pnl` varchar(50),
	`pnlAfterCosts` varchar(50),
	`totalCosts` varchar(50),
	`costBreakdown` json,
	`tradeQualityScore` varchar(2),
	`confidence` varchar(50),
	`patternUsed` varchar(100),
	`exitReason` varchar(50),
	`agentSignals` json,
	`expectedPath` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `trades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tradingActivityLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`activityType` enum('order_placed','order_filled','order_partially_filled','order_rejected','order_cancelled','order_modified','position_opened','position_closed','stop_loss_triggered','take_profit_triggered','margin_call','balance_check','mode_switch') NOT NULL,
	`tradingMode` enum('paper','live') NOT NULL,
	`orderId` varchar(64),
	`tradeId` int,
	`positionId` int,
	`exchangeId` int,
	`symbol` varchar(20),
	`side` enum('buy','sell','long','short'),
	`orderType` enum('market','limit','stop','stop_limit'),
	`quantity` decimal(20,8),
	`price` decimal(20,8),
	`filledQuantity` decimal(20,8),
	`filledPrice` decimal(20,8),
	`status` enum('success','failed','pending','partial') NOT NULL,
	`errorCode` varchar(50),
	`errorMessage` text,
	`fees` decimal(20,8),
	`pnl` decimal(20,8),
	`balanceBefore` decimal(20,8),
	`balanceAfter` decimal(20,8),
	`triggeredBy` enum('user','system','ai_agent','stop_loss','take_profit','margin_call'),
	`agentId` varchar(64),
	`signalId` int,
	`metadata` json,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`executedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tradingActivityLog_id` PRIMARY KEY(`id`)
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
	`autoTradeEnabled` boolean NOT NULL DEFAULT false,
	`portfolioFunds` decimal(18,2) NOT NULL DEFAULT '10000.00',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tradingModeConfig_id` PRIMARY KEY(`id`),
	CONSTRAINT `tradingModeConfig_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `tradingSignals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`signalType` enum('BUY','SELL','NEUTRAL') NOT NULL,
	`source` enum('RSI','MACD','STOCHASTIC','COMBINED') NOT NULL,
	`strength` int NOT NULL,
	`confidence` int NOT NULL,
	`price` varchar(50) NOT NULL,
	`indicators` json NOT NULL,
	`reasoning` text NOT NULL,
	`executed` boolean NOT NULL DEFAULT false,
	`executedAt` timestamp,
	`tradeId` int,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tradingSignals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tradingStrategies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`strategyName` varchar(100) NOT NULL,
	`strategyType` enum('scalping','day_trading','swing_trading','momentum','mean_reversion','breakout','trend_following','custom') NOT NULL,
	`description` text,
	`allocatedCapital` varchar(50) NOT NULL,
	`availableCapital` varchar(50) NOT NULL,
	`maxCapital` varchar(50) NOT NULL,
	`maxPositions` int NOT NULL DEFAULT 5,
	`maxDrawdown` varchar(50) NOT NULL DEFAULT '15.00',
	`maxDailyLoss` varchar(50) NOT NULL,
	`maxPositionSize` varchar(50) NOT NULL DEFAULT '20.00',
	`totalPnL` varchar(50) NOT NULL DEFAULT '0.00',
	`realizedPnL` varchar(50) NOT NULL DEFAULT '0.00',
	`unrealizedPnL` varchar(50) NOT NULL DEFAULT '0.00',
	`currentDrawdown` varchar(50) NOT NULL DEFAULT '0.00',
	`maxDrawdownReached` varchar(50) NOT NULL DEFAULT '0.00',
	`sharpeRatio` varchar(50),
	`sortinoRatio` varchar(50),
	`totalTrades` int NOT NULL DEFAULT 0,
	`winningTrades` int NOT NULL DEFAULT 0,
	`losingTrades` int NOT NULL DEFAULT 0,
	`winRate` varchar(50) NOT NULL DEFAULT '0.00',
	`avgWin` varchar(50),
	`avgLoss` varchar(50),
	`profitFactor` varchar(50),
	`performanceScore` varchar(50) NOT NULL DEFAULT '50.00',
	`isActive` boolean NOT NULL DEFAULT true,
	`isPaused` boolean NOT NULL DEFAULT false,
	`pauseReason` text,
	`lastTradeAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tradingStrategies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tradingSymbols` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`exchangeName` enum('binance','coinbase') NOT NULL DEFAULT 'coinbase',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tradingSymbols_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trainingJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` varchar(50) NOT NULL,
	`modelId` int,
	`jobType` enum('incremental_training','full_retraining','validation','hyperparameter_tuning') NOT NULL,
	`config` text,
	`dataStartTime` timestamp,
	`dataEndTime` timestamp,
	`candleCount` int DEFAULT 0,
	`status` enum('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
	`currentEpoch` int DEFAULT 0,
	`totalEpochs` int,
	`progress` int NOT NULL DEFAULT 0,
	`finalMetrics` text,
	`modelVersionCreated` int,
	`queuedAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp,
	`completedAt` timestamp,
	`error` text,
	`priority` int NOT NULL DEFAULT 5,
	`scheduledFor` timestamp,
	CONSTRAINT `trainingJobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `trainingJobs_jobId_unique` UNIQUE(`jobId`),
	CONSTRAINT `idx_job_id` UNIQUE(`jobId`)
);
--> statement-breakpoint
CREATE TABLE `userBias` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`bias` enum('bearish','neutral','bullish') NOT NULL DEFAULT 'neutral',
	`biasValue` varchar(50) NOT NULL,
	`vetoNextTrade` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userBias_id` PRIMARY KEY(`id`),
	CONSTRAINT `userBias_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64),
	`name` text,
	`email` varchar(320) NOT NULL,
	`passwordHash` varchar(255),
	`emailVerified` boolean NOT NULL DEFAULT false,
	`loginMethod` varchar(64) NOT NULL DEFAULT 'email',
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `whaleAlerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`transactionHash` varchar(128) NOT NULL,
	`blockchain` varchar(50) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`transactionType` enum('transfer','mint','burn','lock','unlock') NOT NULL,
	`amount` decimal(30,8) NOT NULL,
	`amountUsd` decimal(20,2) NOT NULL,
	`fromAddress` varchar(256),
	`toAddress` varchar(256),
	`fromOwner` varchar(100),
	`toOwner` varchar(100),
	`fromOwnerType` varchar(50),
	`toOwnerType` varchar(50),
	`transactionTimestamp` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whaleAlerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `whaleAlerts_transactionHash_unique` UNIQUE(`transactionHash`)
);
--> statement-breakpoint
CREATE TABLE `whaleCorrelatedSignals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`originalSignalId` int,
	`symbol` varchar(20) NOT NULL,
	`signalType` enum('BUY','SELL','NEUTRAL') NOT NULL,
	`signalSource` varchar(50) NOT NULL,
	`originalConfidence` decimal(5,4) NOT NULL,
	`originalStrength` decimal(5,4) NOT NULL,
	`whaleImpactScore` decimal(6,2) NOT NULL,
	`whaleFlowSentiment` enum('bullish','bearish','neutral') NOT NULL,
	`correlationAlignment` enum('aligned','conflicting','neutral') NOT NULL,
	`adjustedConfidence` decimal(5,4) NOT NULL,
	`adjustedStrength` decimal(5,4) NOT NULL,
	`netExchangeFlow` decimal(20,2),
	`totalInflow` decimal(20,2),
	`totalOutflow` decimal(20,2),
	`whaleTransactionCount` int NOT NULL DEFAULT 0,
	`enhancedReasoning` text,
	`signalTimestamp` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whaleCorrelatedSignals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `whaleImpactSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`impactScore` decimal(6,2) NOT NULL,
	`confidence` decimal(5,4) NOT NULL,
	`flowImpact` decimal(6,2) NOT NULL,
	`volumeImpact` decimal(6,2) NOT NULL,
	`burnMintImpact` decimal(6,2) NOT NULL,
	`netFlow` decimal(20,2) NOT NULL,
	`flowSentiment` enum('bullish','bearish','neutral') NOT NULL,
	`transactionCount` int NOT NULL DEFAULT 0,
	`reasoning` text,
	`timeWindowHours` int NOT NULL DEFAULT 24,
	`snapshotTimestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whaleImpactSnapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `whaleWatchlist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`watchType` enum('wallet','token','threshold','exchange') NOT NULL,
	`walletAddress` varchar(256),
	`tokenSymbol` varchar(20),
	`blockchain` varchar(50),
	`minAmountUsd` decimal(20,2),
	`exchangeName` varchar(100),
	`notifyOnMatch` boolean NOT NULL DEFAULT true,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `whaleWatchlist_id` PRIMARY KEY(`id`)
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
	`winRate` varchar(50),
	`avgPnl` varchar(50),
	`profitFactor` varchar(50),
	`confidenceScore` int NOT NULL DEFAULT 0,
	`stopLoss` varchar(50),
	`takeProfit` varchar(50),
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
CREATE INDEX `idx_activity_agentId` ON `agentActivities` (`agentId`);--> statement-breakpoint
CREATE INDEX `idx_activity_userId` ON `agentActivities` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_activity_type` ON `agentActivities` (`activityType`);--> statement-breakpoint
CREATE INDEX `idx_activity_createdAt` ON `agentActivities` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_activity_importance` ON `agentActivities` (`importance`);--> statement-breakpoint
CREATE INDEX `idx_wallet_agentId` ON `agentWatchedWallets` (`agentId`);--> statement-breakpoint
CREATE INDEX `idx_wallet_address` ON `agentWatchedWallets` (`address`);--> statement-breakpoint
CREATE INDEX `idx_wallet_chain` ON `agentWatchedWallets` (`chain`);--> statement-breakpoint
CREATE INDEX `idx_archived_ticks_symbol_time` ON `archived_ticks` (`symbol`,`timestampMs`);--> statement-breakpoint
CREATE INDEX `idx_archived_ticks_archived_at` ON `archived_ticks` (`archivedAt`);--> statement-breakpoint
CREATE INDEX `idx_balance_ver_userId` ON `balanceVerificationLog` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_balance_ver_exchangeId` ON `balanceVerificationLog` (`exchangeId`);--> statement-breakpoint
CREATE INDEX `idx_balance_ver_type` ON `balanceVerificationLog` (`verificationType`);--> statement-breakpoint
CREATE INDEX `idx_balance_ver_createdAt` ON `balanceVerificationLog` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_backtest_user` ON `correlationBacktestResults` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_backtest_symbol` ON `correlationBacktestResults` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_backtest_status` ON `correlationBacktestResults` (`status`);--> statement-breakpoint
CREATE INDEX `idx_backtest_created` ON `correlationBacktestResults` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_backtest_trades_backtest` ON `correlationBacktestTrades` (`backtestId`);--> statement-breakpoint
CREATE INDEX `idx_backtest_trades_alignment` ON `correlationBacktestTrades` (`correlationAlignment`);--> statement-breakpoint
CREATE INDEX `idx_backtest_trades_outcome` ON `correlationBacktestTrades` (`outcome`);--> statement-breakpoint
CREATE INDEX `idx_backtest_trades_timestamp` ON `correlationBacktestTrades` (`signalTimestamp`);--> statement-breakpoint
CREATE INDEX `idx_daily_boost_date` ON `dailyBoostingMetrics` (`date`);--> statement-breakpoint
CREATE INDEX `idx_gap_symbol_status` ON `dataGapLogs` (`symbol`,`recoveryStatus`);--> statement-breakpoint
CREATE INDEX `idx_gap_time` ON `dataGapLogs` (`gapStartMs`);--> statement-breakpoint
CREATE INDEX `idx_dq_symbol_interval` ON `dataQualityMetrics` (`symbol`,`interval`);--> statement-breakpoint
CREATE INDEX `idx_dq_valid` ON `dataQualityMetrics` (`isValid`);--> statement-breakpoint
CREATE INDEX `idx_dq_score` ON `dataQualityMetrics` (`qualityScore`);--> statement-breakpoint
CREATE INDEX `idx_parameter_lookup` ON `learnedParameters` (`parameterName`,`symbol`,`regime`);--> statement-breakpoint
CREATE INDEX `idx_agent_lookup` ON `learnedParameters` (`agentName`,`parameterName`);--> statement-breakpoint
CREATE INDEX `idx_last_updated` ON `learnedParameters` (`lastUpdated`);--> statement-breakpoint
CREATE INDEX `idx_nn_pred_symbol` ON `nnPredictions` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_nn_pred_model` ON `nnPredictions` (`modelType`);--> statement-breakpoint
CREATE INDEX `idx_nn_pred_target` ON `nnPredictions` (`targetTimestamp`);--> statement-breakpoint
CREATE INDEX `idx_nn_pred_timestamp` ON `nnPredictions` (`predictionTimestamp`);--> statement-breakpoint
CREATE INDEX `idx_oc_signal_agentId` ON `onchainAgentSignals` (`agentId`);--> statement-breakpoint
CREATE INDEX `idx_oc_signal_userId` ON `onchainAgentSignals` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_oc_signal_symbol` ON `onchainAgentSignals` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_oc_signal_status` ON `onchainAgentSignals` (`status`);--> statement-breakpoint
CREATE INDEX `idx_oc_signal_createdAt` ON `onchainAgentSignals` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_agent_userId` ON `onchainAgents` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_agent_status` ON `onchainAgents` (`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_type` ON `onchainAgents` (`agentType`);--> statement-breakpoint
CREATE INDEX `idx_param_opt_type` ON `parameterOptimizationHistory` (`optimizationType`);--> statement-breakpoint
CREATE INDEX `idx_param_opt_status` ON `parameterOptimizationHistory` (`status`);--> statement-breakpoint
CREATE INDEX `idx_param_opt_time` ON `parameterOptimizationHistory` (`startTime`);--> statement-breakpoint
CREATE INDEX `idx_pipeline_type` ON `pipelineStatus` (`pipelineType`);--> statement-breakpoint
CREATE INDEX `idx_pipeline_status` ON `pipelineStatus` (`status`);--> statement-breakpoint
CREATE INDEX `idx_pipeline_symbol` ON `pipelineStatus` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_model_active` ON `rlModelVersions` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_model_stable` ON `rlModelVersions` (`isStable`);--> statement-breakpoint
CREATE INDEX `idx_rl_models_symbol` ON `rlModels` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_rl_models_status` ON `rlModels` (`status`);--> statement-breakpoint
CREATE INDEX `idx_rl_models_type` ON `rlModels` (`agentType`);--> statement-breakpoint
CREATE INDEX `idx_rl_training_model` ON `rlTrainingHistory` (`modelId`);--> statement-breakpoint
CREATE INDEX `idx_rl_training_status` ON `rlTrainingHistory` (`status`);--> statement-breakpoint
CREATE INDEX `idx_rl_training_time` ON `rlTrainingHistory` (`startTime`);--> statement-breakpoint
CREATE INDEX `idx_boost_history_user` ON `signalBoostingHistory` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_boost_history_symbol` ON `signalBoostingHistory` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_boost_history_confirmation` ON `signalBoostingHistory` (`confirmationLevel`);--> statement-breakpoint
CREATE INDEX `idx_boost_history_outcome` ON `signalBoostingHistory` (`tradeOutcome`);--> statement-breakpoint
CREATE INDEX `idx_boost_history_timestamp` ON `signalBoostingHistory` (`signalTimestamp`);--> statement-breakpoint
CREATE INDEX `idx_ticks_symbol_time` ON `ticks` (`symbol`,`timestampMs`);--> statement-breakpoint
CREATE INDEX `idx_ticks_symbol_seq` ON `ticks` (`symbol`,`sequenceNumber`);--> statement-breakpoint
CREATE INDEX `idx_ticks_time` ON `ticks` (`timestampMs`);--> statement-breakpoint
CREATE INDEX `idx_tdl_userId` ON `tradeDecisionLogs` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_tdl_symbol` ON `tradeDecisionLogs` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_tdl_timestamp` ON `tradeDecisionLogs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_tdl_decision` ON `tradeDecisionLogs` (`decision`);--> statement-breakpoint
CREATE INDEX `idx_tdl_status` ON `tradeDecisionLogs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tdl_signalType` ON `tradeDecisionLogs` (`signalType`);--> statement-breakpoint
CREATE INDEX `idx_journal_userId` ON `tradeJournalEntries` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_journal_tradeId` ON `tradeJournalEntries` (`tradeId`);--> statement-breakpoint
CREATE INDEX `idx_journal_strategy` ON `tradeJournalEntries` (`strategy`);--> statement-breakpoint
CREATE INDEX `idx_journal_createdAt` ON `tradeJournalEntries` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_activity_userId` ON `tradingActivityLog` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_activity_type` ON `tradingActivityLog` (`activityType`);--> statement-breakpoint
CREATE INDEX `idx_activity_tradingMode` ON `tradingActivityLog` (`tradingMode`);--> statement-breakpoint
CREATE INDEX `idx_activity_symbol` ON `tradingActivityLog` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_activity_status` ON `tradingActivityLog` (`status`);--> statement-breakpoint
CREATE INDEX `idx_activity_timestamp` ON `tradingActivityLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_activity_orderId` ON `tradingActivityLog` (`orderId`);--> statement-breakpoint
CREATE INDEX `idx_job_status` ON `trainingJobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_job_model` ON `trainingJobs` (`modelId`);--> statement-breakpoint
CREATE INDEX `idx_job_priority` ON `trainingJobs` (`priority`);--> statement-breakpoint
CREATE INDEX `idx_whale_blockchain` ON `whaleAlerts` (`blockchain`);--> statement-breakpoint
CREATE INDEX `idx_whale_symbol` ON `whaleAlerts` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_whale_timestamp` ON `whaleAlerts` (`transactionTimestamp`);--> statement-breakpoint
CREATE INDEX `idx_whale_amount` ON `whaleAlerts` (`amountUsd`);--> statement-breakpoint
CREATE INDEX `idx_whale_corr_user` ON `whaleCorrelatedSignals` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_whale_corr_symbol` ON `whaleCorrelatedSignals` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_whale_corr_alignment` ON `whaleCorrelatedSignals` (`correlationAlignment`);--> statement-breakpoint
CREATE INDEX `idx_whale_corr_timestamp` ON `whaleCorrelatedSignals` (`signalTimestamp`);--> statement-breakpoint
CREATE INDEX `idx_whale_impact_symbol` ON `whaleImpactSnapshots` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_whale_impact_timestamp` ON `whaleImpactSnapshots` (`snapshotTimestamp`);--> statement-breakpoint
CREATE INDEX `idx_whale_impact_score` ON `whaleImpactSnapshots` (`impactScore`);--> statement-breakpoint
CREATE INDEX `idx_watchlist_user` ON `whaleWatchlist` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_watchlist_active` ON `whaleWatchlist` (`isActive`);