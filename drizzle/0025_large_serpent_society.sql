CREATE TABLE `agentPnlAttribution` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tradeId` int NOT NULL,
	`agentName` varchar(64) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`tradeSide` enum('long','short') NOT NULL,
	`agentDirection` varchar(16) NOT NULL,
	`agentConfidence` decimal(6,4),
	`pnlContribution` decimal(18,6) NOT NULL,
	`tradePnl` decimal(18,6) NOT NULL,
	`wasCorrect` boolean NOT NULL,
	`tradeQualityScore` varchar(2),
	`exitReason` varchar(64),
	`tradingMode` varchar(10),
	`closedAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentPnlAttribution_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `brainDecisions` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`positionId` varchar(64) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`side` varchar(5) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`pipelineStep` varchar(40),
	`reason` text,
	`urgency` varchar(10),
	`sensorium` json,
	`newStopLoss` decimal(20,8),
	`exitQuantityPercent` decimal(6,4),
	`isDryRun` boolean NOT NULL DEFAULT true,
	`liveIEMAction` varchar(32),
	`latencyUs` int,
	CONSTRAINT `brainDecisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `brainEntryContexts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`positionId` varchar(64) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`side` varchar(5) NOT NULL,
	`patternName` varchar(100) NOT NULL,
	`openedAtMs` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `brainEntryContexts_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_brainEntryCtx_position` UNIQUE(`positionId`)
);
--> statement-breakpoint
CREATE INDEX `idx_agent_pnl_user_agent` ON `agentPnlAttribution` (`userId`,`agentName`);--> statement-breakpoint
CREATE INDEX `idx_agent_pnl_trade` ON `agentPnlAttribution` (`tradeId`);--> statement-breakpoint
CREATE INDEX `idx_agent_pnl_closed` ON `agentPnlAttribution` (`closedAt`);--> statement-breakpoint
CREATE INDEX `idx_agent_pnl_agent_symbol` ON `agentPnlAttribution` (`agentName`,`symbol`);--> statement-breakpoint
CREATE INDEX `idx_brain_position` ON `brainDecisions` (`positionId`);--> statement-breakpoint
CREATE INDEX `idx_brain_timestamp` ON `brainDecisions` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_brain_symbol_kind` ON `brainDecisions` (`symbol`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_brainEntryCtx_created` ON `brainEntryContexts` (`createdAt`);