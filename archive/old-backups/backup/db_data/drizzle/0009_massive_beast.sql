CREATE TABLE `portfolioRiskMetrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL DEFAULT 1,
	`timestamp` timestamp NOT NULL,
	`totalValue` decimal(18,2) NOT NULL,
	`dailyReturn` decimal(10,6),
	`cumulativeReturn` decimal(10,6),
	`sharpeRatio` decimal(10,4),
	`sortinoRatio` decimal(10,4),
	`maxDrawdown` decimal(10,6),
	`volatility` decimal(10,6),
	`numberOfPositions` int NOT NULL,
	`allocatedCapital` decimal(18,2) NOT NULL,
	`availableCash` decimal(18,2) NOT NULL,
	`correlationMatrix` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `portfolioRiskMetrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rebalancingHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL DEFAULT 1,
	`timestamp` timestamp NOT NULL,
	`trigger` enum('time','confidence','deviation','manual') NOT NULL,
	`symbolsRebalanced` int NOT NULL,
	`totalCapitalAllocated` decimal(18,2) NOT NULL,
	`changes` json NOT NULL,
	`portfolioMetrics` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rebalancingHistory_id` PRIMARY KEY(`id`)
);
