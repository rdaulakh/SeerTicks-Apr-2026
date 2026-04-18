CREATE TABLE `strategyInstances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`strategyType` varchar(50) NOT NULL,
	`config` json NOT NULL,
	`allocatedBalance` varchar(50) NOT NULL,
	`currentBalance` varchar(50) NOT NULL,
	`status` enum('active','paused','stopped') NOT NULL DEFAULT 'paused',
	`startedAt` timestamp,
	`stoppedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `strategyInstances_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `strategyPerformance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategyId` int NOT NULL,
	`userId` int NOT NULL,
	`totalTrades` int NOT NULL DEFAULT 0,
	`winningTrades` int NOT NULL DEFAULT 0,
	`losingTrades` int NOT NULL DEFAULT 0,
	`winRate` varchar(50) DEFAULT '0.00',
	`totalPnL` varchar(50) DEFAULT '0.00',
	`realizedPnL` varchar(50) DEFAULT '0.00',
	`unrealizedPnL` varchar(50) DEFAULT '0.00',
	`avgWin` varchar(50) DEFAULT '0.00',
	`avgLoss` varchar(50) DEFAULT '0.00',
	`maxDrawdown` varchar(50) DEFAULT '0.00',
	`sharpeRatio` varchar(50),
	`profitFactor` varchar(50),
	`openPositions` int NOT NULL DEFAULT 0,
	`maxOpenPositions` int NOT NULL DEFAULT 0,
	`totalCommission` varchar(50) DEFAULT '0.00',
	`lastUpdated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `strategyPerformance_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `paperOrders` ADD `strategyId` int;--> statement-breakpoint
ALTER TABLE `paperPositions` ADD `strategyId` int;--> statement-breakpoint
ALTER TABLE `paperTrades` ADD `strategyId` int;