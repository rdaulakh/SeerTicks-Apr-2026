CREATE TABLE `agentSignalLog` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`symbol` varchar(20) NOT NULL,
	`agentName` varchar(80) NOT NULL,
	`agentCategory` varchar(20) NOT NULL,
	`signal` varchar(10) NOT NULL,
	`confidence` decimal(5,4) NOT NULL,
	`reasoning` text,
	`executionTimeMs` int,
	`dataSource` varchar(50),
	`isSynthetic` boolean DEFAULT false,
	CONSTRAINT `agentSignalLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `apiCallLog` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`apiName` varchar(80) NOT NULL,
	`endpoint` varchar(255),
	`method` varchar(10) DEFAULT 'GET',
	`status` varchar(20) NOT NULL,
	`httpStatusCode` int,
	`responseTimeMs` int,
	`responseSize` int,
	`errorMessage` text,
	`callerAgent` varchar(80),
	`symbol` varchar(20),
	CONSTRAINT `apiCallLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `consensusLog` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`symbol` varchar(20) NOT NULL,
	`bullishCount` int NOT NULL DEFAULT 0,
	`bearishCount` int NOT NULL DEFAULT 0,
	`neutralCount` int NOT NULL DEFAULT 0,
	`bullishStrength` decimal(8,4),
	`bearishStrength` decimal(8,4),
	`netDirection` varchar(10) NOT NULL,
	`consensusConfidence` decimal(5,4),
	`threshold` decimal(5,4),
	`meetsThreshold` boolean DEFAULT false,
	`fastAgentScore` decimal(8,4),
	`slowAgentBonus` decimal(8,4),
	`agentBreakdown` json,
	CONSTRAINT `consensusLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `slowAgentLog` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`symbol` varchar(20) NOT NULL,
	`agentName` varchar(80) NOT NULL,
	`status` varchar(20) NOT NULL,
	`executionTimeMs` int,
	`signal` varchar(10),
	`confidence` decimal(5,4),
	`dataPointsProcessed` int,
	`errorMessage` text,
	`apiCallsMade` int DEFAULT 0,
	`apiCallsFailed` int DEFAULT 0,
	CONSTRAINT `slowAgentLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tickHeartbeat` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`symbol` varchar(20) NOT NULL,
	`tickCount` int NOT NULL DEFAULT 0,
	`lastPrice` decimal(20,8),
	`lastTickTime` timestamp,
	`priceHigh` decimal(20,8),
	`priceLow` decimal(20,8),
	`avgSpreadMs` int,
	`source` varchar(30) DEFAULT 'coinbase',
	CONSTRAINT `tickHeartbeat_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tradeDecisionLog` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`symbol` varchar(20) NOT NULL,
	`decision` varchar(20) NOT NULL,
	`direction` varchar(10),
	`consensusConfidence` decimal(5,4),
	`rejectReason` text,
	`rejectStage` varchar(50),
	`entryPrice` decimal(20,8),
	`positionSize` decimal(20,8),
	`varResult` json,
	`agentSignals` json,
	`pipelineStages` json,
	CONSTRAINT `tradeDecisionLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_asl_timestamp` ON `agentSignalLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_asl_symbol` ON `agentSignalLog` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_asl_agent` ON `agentSignalLog` (`agentName`);--> statement-breakpoint
CREATE INDEX `idx_asl_symbol_ts` ON `agentSignalLog` (`symbol`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_aclog_timestamp` ON `apiCallLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_aclog_apiName` ON `apiCallLog` (`apiName`);--> statement-breakpoint
CREATE INDEX `idx_aclog_status` ON `apiCallLog` (`status`);--> statement-breakpoint
CREATE INDEX `idx_aclog_api_ts` ON `apiCallLog` (`apiName`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_cl_timestamp` ON `consensusLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_cl_symbol` ON `consensusLog` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_cl_direction` ON `consensusLog` (`netDirection`);--> statement-breakpoint
CREATE INDEX `idx_cl_symbol_ts` ON `consensusLog` (`symbol`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_sal_timestamp` ON `slowAgentLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_sal_symbol` ON `slowAgentLog` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_sal_agent` ON `slowAgentLog` (`agentName`);--> statement-breakpoint
CREATE INDEX `idx_sal_status` ON `slowAgentLog` (`status`);--> statement-breakpoint
CREATE INDEX `idx_th_timestamp` ON `tickHeartbeat` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_th_symbol` ON `tickHeartbeat` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_th_symbol_ts` ON `tickHeartbeat` (`symbol`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_atdl_timestamp` ON `tradeDecisionLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_atdl_symbol` ON `tradeDecisionLog` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_atdl_decision` ON `tradeDecisionLog` (`decision`);--> statement-breakpoint
CREATE INDEX `idx_atdl_symbol_ts` ON `tradeDecisionLog` (`symbol`,`timestamp`);