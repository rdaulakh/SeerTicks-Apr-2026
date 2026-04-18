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
CREATE INDEX `idx_whale_corr_user` ON `whaleCorrelatedSignals` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_whale_corr_symbol` ON `whaleCorrelatedSignals` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_whale_corr_alignment` ON `whaleCorrelatedSignals` (`correlationAlignment`);--> statement-breakpoint
CREATE INDEX `idx_whale_corr_timestamp` ON `whaleCorrelatedSignals` (`signalTimestamp`);--> statement-breakpoint
CREATE INDEX `idx_whale_impact_symbol` ON `whaleImpactSnapshots` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_whale_impact_timestamp` ON `whaleImpactSnapshots` (`snapshotTimestamp`);--> statement-breakpoint
CREATE INDEX `idx_whale_impact_score` ON `whaleImpactSnapshots` (`impactScore`);