CREATE TABLE `agentCorrelations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentA` varchar(60) NOT NULL,
	`agentB` varchar(60) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`correlation` decimal(6,4) NOT NULL,
	`sampleSize` int NOT NULL,
	`windowDays` int NOT NULL,
	`lastUpdated` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentCorrelations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bayesianConsensusLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`userId` int,
	`signalId` varchar(64),
	`symbol` varchar(20) NOT NULL,
	`naiveMean` decimal(8,6) NOT NULL,
	`posteriorMean` decimal(8,6) NOT NULL,
	`posteriorStd` decimal(8,6) NOT NULL,
	`effectiveN` decimal(8,4) NOT NULL,
	`rawN` int NOT NULL,
	`avgCorrelation` decimal(6,4),
	`gateDecision` varchar(24) NOT NULL,
	CONSTRAINT `bayesianConsensusLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tcaLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`userId` int,
	`traceId` varchar(32),
	`symbol` varchar(20) NOT NULL,
	`side` varchar(4) NOT NULL,
	`quantity` decimal(20,10) NOT NULL,
	`refPrice` decimal(20,8) NOT NULL,
	`executedPrice` decimal(20,8) NOT NULL,
	`executedQty` decimal(20,10) NOT NULL,
	`slippageBps` decimal(10,4) NOT NULL,
	`bookSpreadBps` decimal(10,4),
	`stageReached` int NOT NULL,
	`totalLatencyMs` int NOT NULL,
	`partialFill` tinyint NOT NULL DEFAULT 0,
	`exceededCap` tinyint NOT NULL DEFAULT 0,
	CONSTRAINT `tcaLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_agentcorr_pair_sym` ON `agentCorrelations` (`agentA`,`agentB`,`symbol`);--> statement-breakpoint
CREATE INDEX `idx_agentcorr_symbol` ON `agentCorrelations` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_agentcorr_updated` ON `agentCorrelations` (`lastUpdated`);--> statement-breakpoint
CREATE INDEX `idx_bayes_timestamp` ON `bayesianConsensusLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_bayes_symbol` ON `bayesianConsensusLog` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_bayes_signal` ON `bayesianConsensusLog` (`signalId`);--> statement-breakpoint
CREATE INDEX `idx_tca_timestamp` ON `tcaLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_tca_symbol` ON `tcaLog` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_tca_trace` ON `tcaLog` (`traceId`);--> statement-breakpoint
CREATE INDEX `idx_tca_breach` ON `tcaLog` (`exceededCap`);--> statement-breakpoint
CREATE INDEX `idx_tca_symbol_time` ON `tcaLog` (`symbol`,`timestamp`);