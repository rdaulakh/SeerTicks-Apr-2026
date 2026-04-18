CREATE TABLE `consensusHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`symbol` varchar(20) NOT NULL,
	`timeframe` varchar(10) NOT NULL,
	`finalSignal` enum('BULLISH','BEARISH','NEUTRAL') NOT NULL,
	`finalConfidence` int NOT NULL,
	`consensusPercentage` int NOT NULL,
	`bullishVotes` int NOT NULL DEFAULT 0,
	`bearishVotes` int NOT NULL DEFAULT 0,
	`neutralVotes` int NOT NULL DEFAULT 0,
	`agentVotes` text,
	`tradeId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `consensusHistory_id` PRIMARY KEY(`id`)
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
	CONSTRAINT `historicalOHLCV_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `systemSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(255) NOT NULL,
	`value` text,
	`description` text,
	`createdAt` timestamp DEFAULT (now()),
	`updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `systemSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `systemSettings_key_unique` UNIQUE(`key`)
);
