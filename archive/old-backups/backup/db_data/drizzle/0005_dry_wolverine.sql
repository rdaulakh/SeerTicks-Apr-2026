CREATE TABLE `serviceHealth` (
	`id` int AUTO_INCREMENT NOT NULL,
	`serviceName` varchar(100) NOT NULL,
	`status` enum('healthy','degraded','down','unknown') NOT NULL DEFAULT 'unknown',
	`lastCheckAt` timestamp NOT NULL,
	`lastHealthyAt` timestamp,
	`consecutiveFailures` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `serviceHealth_id` PRIMARY KEY(`id`),
	CONSTRAINT `serviceHealth_serviceName_unique` UNIQUE(`serviceName`)
);
--> statement-breakpoint
CREATE TABLE `serviceHealthHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`serviceName` varchar(100) NOT NULL,
	`status` enum('healthy','degraded','down','unknown') NOT NULL,
	`responseTime` int,
	`errorMessage` text,
	`metadata` json,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `serviceHealthHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `systemStartupLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`startupId` varchar(64) NOT NULL,
	`status` enum('in_progress','success','failed','partial') NOT NULL,
	`startedAt` timestamp NOT NULL,
	`completedAt` timestamp,
	`totalChecks` int NOT NULL,
	`passedChecks` int NOT NULL,
	`failedChecks` int NOT NULL,
	`healthCheckResults` json NOT NULL,
	`errorSummary` text,
	`canTrade` boolean NOT NULL DEFAULT false,
	CONSTRAINT `systemStartupLog_id` PRIMARY KEY(`id`),
	CONSTRAINT `systemStartupLog_startupId_unique` UNIQUE(`startupId`)
);
