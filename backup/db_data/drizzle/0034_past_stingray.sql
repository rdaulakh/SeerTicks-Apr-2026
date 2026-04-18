CREATE TABLE `dataCoverageSummary` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`timeframe` enum('1m','5m','15m','1h','4h','1d') NOT NULL,
	`earliestTimestamp` bigint,
	`latestTimestamp` bigint,
	`totalCandles` int NOT NULL DEFAULT 0,
	`gapCount` int NOT NULL DEFAULT 0,
	`lastUpdated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dataCoverageSummary_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_coverage_unique` UNIQUE(`symbol`,`timeframe`)
);
--> statement-breakpoint
CREATE TABLE `dataIngestionJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` varchar(50) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`timeframe` enum('1m','5m','15m','1h','4h','1d') NOT NULL,
	`startDate` timestamp NOT NULL,
	`endDate` timestamp NOT NULL,
	`status` enum('pending','running','completed','failed','paused') NOT NULL DEFAULT 'pending',
	`progress` int NOT NULL DEFAULT 0,
	`candlesFetched` int NOT NULL DEFAULT 0,
	`totalCandles` int NOT NULL DEFAULT 0,
	`lastFetchedTimestamp` bigint,
	`errorMessage` text,
	`retryCount` int NOT NULL DEFAULT 0,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dataIngestionJobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `dataIngestionJobs_jobId_unique` UNIQUE(`jobId`)
);
--> statement-breakpoint
CREATE TABLE `historicalOHLCV` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`timeframe` enum('1m','5m','15m','1h','4h','1d') NOT NULL,
	`timestamp` bigint NOT NULL,
	`open` varchar(50) NOT NULL,
	`high` varchar(50) NOT NULL,
	`low` varchar(50) NOT NULL,
	`close` varchar(50) NOT NULL,
	`volume` varchar(50) NOT NULL,
	`source` varchar(20) NOT NULL DEFAULT 'coinbase',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `historicalOHLCV_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_ohlcv_unique` UNIQUE(`symbol`,`timeframe`,`timestamp`)
);
--> statement-breakpoint
CREATE INDEX `idx_ingestion_job_id` ON `dataIngestionJobs` (`jobId`);--> statement-breakpoint
CREATE INDEX `idx_ingestion_symbol_timeframe` ON `dataIngestionJobs` (`symbol`,`timeframe`);--> statement-breakpoint
CREATE INDEX `idx_ingestion_status` ON `dataIngestionJobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_ohlcv_symbol_timeframe` ON `historicalOHLCV` (`symbol`,`timeframe`);--> statement-breakpoint
CREATE INDEX `idx_ohlcv_timestamp` ON `historicalOHLCV` (`timestamp`);