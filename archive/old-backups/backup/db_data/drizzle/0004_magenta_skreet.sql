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
