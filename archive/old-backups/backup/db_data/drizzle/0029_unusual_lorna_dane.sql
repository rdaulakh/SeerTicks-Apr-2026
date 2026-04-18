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
CREATE INDEX `idx_dq_symbol_interval` ON `dataQualityMetrics` (`symbol`,`interval`);--> statement-breakpoint
CREATE INDEX `idx_dq_valid` ON `dataQualityMetrics` (`isValid`);--> statement-breakpoint
CREATE INDEX `idx_dq_score` ON `dataQualityMetrics` (`qualityScore`);--> statement-breakpoint
CREATE INDEX `idx_pipeline_type` ON `pipelineStatus` (`pipelineType`);--> statement-breakpoint
CREATE INDEX `idx_pipeline_status` ON `pipelineStatus` (`status`);--> statement-breakpoint
CREATE INDEX `idx_pipeline_symbol` ON `pipelineStatus` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_model_active` ON `rlModelVersions` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_model_stable` ON `rlModelVersions` (`isStable`);--> statement-breakpoint
CREATE INDEX `idx_job_status` ON `trainingJobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_job_model` ON `trainingJobs` (`modelId`);--> statement-breakpoint
CREATE INDEX `idx_job_priority` ON `trainingJobs` (`priority`);