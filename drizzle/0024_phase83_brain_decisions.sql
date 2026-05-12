-- Phase 83 — TraderBrain decision trace
-- One row per brain tick per open position. Audit trail for the single-brain
-- exit decision pipeline. Starts in dryRun=true mode for A/B with the live IEM.

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
CREATE INDEX `idx_brain_position` ON `brainDecisions` (`positionId`);--> statement-breakpoint
CREATE INDEX `idx_brain_timestamp` ON `brainDecisions` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_brain_symbol_kind` ON `brainDecisions` (`symbol`,`kind`);
