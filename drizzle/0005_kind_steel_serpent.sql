CREATE TABLE `alertLog` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`alertType` varchar(100) NOT NULL,
	`severity` varchar(20) NOT NULL,
	`title` varchar(255),
	`message` text,
	`deliveryMethod` varchar(20) NOT NULL,
	`deliveryStatus` varchar(20) NOT NULL,
	`deliveredAt` timestamp,
	`relatedEntityType` varchar(50),
	`relatedEntityId` varchar(100),
	`metadata` json,
	CONSTRAINT `alertLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `apiConnectionLog` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`apiName` varchar(100) NOT NULL,
	`connectionStatus` varchar(20) NOT NULL,
	`connectionAttemptTime` timestamp,
	`connectionEstablishedTime` timestamp,
	`connectionDurationMs` int,
	`responseTimeMs` int,
	`statusCode` int,
	`errorMessage` text,
	`affectedSymbols` varchar(255),
	`affectedOperations` varchar(255),
	CONSTRAINT `apiConnectionLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `capitalUtilization` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`totalCapital` decimal(20,2) NOT NULL,
	`deployedCapital` decimal(20,2) NOT NULL,
	`idleCapital` decimal(20,2) NOT NULL,
	`reservedCapital` decimal(20,2),
	`utilizationPercent` decimal(5,2),
	`openPositionsCount` int,
	`totalPositionValue` decimal(20,2),
	`avgPositionSize` decimal(20,2),
	`largestPositionSize` decimal(20,2),
	`totalRiskExposure` decimal(20,2),
	`riskPercent` decimal(5,2),
	CONSTRAINT `capitalUtilization_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `entryValidationLog` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`symbol` varchar(20),
	`consensusStrength` decimal(5,4),
	`priceConfirmation` int,
	`trendAlignment` int,
	`volumeConfirmation` int,
	`historicalEdge` int,
	`finalDecision` varchar(20),
	`skipReason` text,
	`agentSignals` json,
	`metadata` json,
	CONSTRAINT `entryValidationLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `exitDecisionLog` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`positionId` int NOT NULL,
	`exitChecks` json NOT NULL,
	`triggeredExit` varchar(100),
	`priority` int,
	`currentPrice` decimal(20,8),
	`unrealizedPnl` decimal(20,8),
	`unrealizedPnlPercent` decimal(10,6),
	`holdTimeMinutes` int,
	`currentConsensus` decimal(5,4),
	`entryConsensus` decimal(5,4),
	`metadata` json,
	CONSTRAINT `exitDecisionLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `positionSizingLog` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`positionId` int,
	`symbol` varchar(20),
	`side` varchar(10),
	`intendedRiskAmount` decimal(20,2),
	`intendedRiskPercent` decimal(5,4),
	`stopLossDistance` decimal(20,8),
	`calculatedSize` decimal(20,8),
	`sizeBeforeConstraints` decimal(20,8),
	`sizeAfterConstraints` decimal(20,8),
	`constraintsApplied` json,
	`finalSize` decimal(20,8),
	`finalCapitalUsed` decimal(20,2),
	`finalCapitalPercent` decimal(5,2),
	`accountBalance` decimal(20,2),
	`availableCapital` decimal(20,2),
	`openPositionsCount` int,
	CONSTRAINT `positionSizingLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `serviceEvents` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`serviceName` varchar(100) NOT NULL,
	`eventType` varchar(20) NOT NULL,
	`reason` text,
	`errorMessage` text,
	`stackTrace` mediumtext,
	`version` varchar(50),
	`gitCommit` varchar(40),
	`nodeVersion` varchar(20),
	`environment` varchar(20),
	CONSTRAINT `serviceEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `systemHeartbeat` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`serviceName` varchar(100) NOT NULL,
	`status` varchar(20) NOT NULL,
	`lastTickTime` timestamp,
	`ticksProcessedLastMinute` int DEFAULT 0,
	`positionsCheckedLastMinute` int DEFAULT 0,
	`cpuPercent` decimal(5,2),
	`memoryMb` int,
	`activeThreads` int,
	`uptimeSeconds` bigint,
	`lastRestartTime` timestamp,
	`restartReason` varchar(255),
	`openPositionsCount` int,
	`activeAgentsCount` int,
	CONSTRAINT `systemHeartbeat_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `websocketHealthLog` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`websocketName` varchar(100) NOT NULL,
	`connectionStatus` varchar(20) NOT NULL,
	`lastMessageTime` timestamp,
	`messagesReceivedLastMinute` int,
	`messagesMissed` int,
	`pingMs` int,
	`avgMessageDelayMs` int,
	`reconnectionAttempts` int,
	`lastReconnectTime` timestamp,
	CONSTRAINT `websocketHealthLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_al_timestamp` ON `alertLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_al_alertType` ON `alertLog` (`alertType`);--> statement-breakpoint
CREATE INDEX `idx_al_severity` ON `alertLog` (`severity`);--> statement-breakpoint
CREATE INDEX `idx_acl_timestamp` ON `apiConnectionLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_acl_apiName` ON `apiConnectionLog` (`apiName`);--> statement-breakpoint
CREATE INDEX `idx_acl_status` ON `apiConnectionLog` (`connectionStatus`);--> statement-breakpoint
CREATE INDEX `idx_cu_timestamp` ON `capitalUtilization` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_evl_timestamp` ON `entryValidationLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_evl_symbol` ON `entryValidationLog` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_evl_decision` ON `entryValidationLog` (`finalDecision`);--> statement-breakpoint
CREATE INDEX `idx_edl_timestamp` ON `exitDecisionLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_edl_positionId` ON `exitDecisionLog` (`positionId`);--> statement-breakpoint
CREATE INDEX `idx_edl_triggeredExit` ON `exitDecisionLog` (`triggeredExit`);--> statement-breakpoint
CREATE INDEX `idx_psl_timestamp` ON `positionSizingLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_psl_positionId` ON `positionSizingLog` (`positionId`);--> statement-breakpoint
CREATE INDEX `idx_se_timestamp` ON `serviceEvents` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_se_service` ON `serviceEvents` (`serviceName`);--> statement-breakpoint
CREATE INDEX `idx_se_eventType` ON `serviceEvents` (`eventType`);--> statement-breakpoint
CREATE INDEX `idx_shb_timestamp` ON `systemHeartbeat` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_shb_service` ON `systemHeartbeat` (`serviceName`);--> statement-breakpoint
CREATE INDEX `idx_shb_status` ON `systemHeartbeat` (`status`);--> statement-breakpoint
CREATE INDEX `idx_whl_timestamp` ON `websocketHealthLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_whl_websocket` ON `websocketHealthLog` (`websocketName`);--> statement-breakpoint
CREATE INDEX `idx_whl_status` ON `websocketHealthLog` (`connectionStatus`);