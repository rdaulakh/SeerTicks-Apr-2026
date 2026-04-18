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
CREATE INDEX `idx_backtest_user` ON `correlationBacktestResults` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_backtest_symbol` ON `correlationBacktestResults` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_backtest_status` ON `correlationBacktestResults` (`status`);--> statement-breakpoint
CREATE INDEX `idx_backtest_created` ON `correlationBacktestResults` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_backtest_trades_backtest` ON `correlationBacktestTrades` (`backtestId`);--> statement-breakpoint
CREATE INDEX `idx_backtest_trades_alignment` ON `correlationBacktestTrades` (`correlationAlignment`);--> statement-breakpoint
CREATE INDEX `idx_backtest_trades_outcome` ON `correlationBacktestTrades` (`outcome`);--> statement-breakpoint
CREATE INDEX `idx_backtest_trades_timestamp` ON `correlationBacktestTrades` (`signalTimestamp`);--> statement-breakpoint
CREATE INDEX `idx_daily_boost_date` ON `dailyBoostingMetrics` (`date`);--> statement-breakpoint
CREATE INDEX `idx_boost_history_user` ON `signalBoostingHistory` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_boost_history_symbol` ON `signalBoostingHistory` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_boost_history_confirmation` ON `signalBoostingHistory` (`confirmationLevel`);--> statement-breakpoint
CREATE INDEX `idx_boost_history_outcome` ON `signalBoostingHistory` (`tradeOutcome`);--> statement-breakpoint
CREATE INDEX `idx_boost_history_timestamp` ON `signalBoostingHistory` (`signalTimestamp`);