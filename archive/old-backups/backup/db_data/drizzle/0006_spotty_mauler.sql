CREATE TABLE `agentAccuracy` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`agentName` varchar(50) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`accuracy` decimal(5,4) NOT NULL,
	`totalTrades` int NOT NULL DEFAULT 0,
	`correctTrades` int NOT NULL DEFAULT 0,
	`lastUpdated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentAccuracy_id` PRIMARY KEY(`id`)
);
