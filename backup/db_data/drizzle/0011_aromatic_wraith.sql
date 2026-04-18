CREATE TABLE `agentPerformanceMetrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`agentName` varchar(50) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`timeframe` varchar(10) NOT NULL,
	`totalSignals` int NOT NULL DEFAULT 0,
	`correctSignals` int NOT NULL DEFAULT 0,
	`accuracy` decimal(5,4),
	`avgConfidence` decimal(5,4),
	`sharpeRatio` decimal(10,4),
	`profitFactor` decimal(10,4),
	`isActive` boolean NOT NULL DEFAULT true,
	`deactivatedReason` text,
	`deactivatedAt` timestamp,
	`lastSignalAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agentPerformanceMetrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('trade','risk','agent','system','performance') NOT NULL,
	`severity` enum('info','warning','error','critical') NOT NULL,
	`title` varchar(200) NOT NULL,
	`message` text NOT NULL,
	`data` json,
	`isRead` boolean NOT NULL DEFAULT false,
	`isArchived` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `riskLimitBreaches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`limitType` enum('position_size','daily_loss','max_drawdown','symbol_exposure','portfolio_exposure','risk_per_trade') NOT NULL,
	`limitValue` decimal(18,2) NOT NULL,
	`actualValue` decimal(18,2) NOT NULL,
	`symbol` varchar(20),
	`action` enum('blocked','warning','shutdown') NOT NULL,
	`resolved` boolean NOT NULL DEFAULT false,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `riskLimitBreaches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tradeExecutionLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tradeId` int,
	`symbol` varchar(20) NOT NULL,
	`side` enum('long','short') NOT NULL,
	`orderType` enum('market','limit','stop','twap','vwap','iceberg') NOT NULL,
	`quantity` decimal(18,8) NOT NULL,
	`price` decimal(18,8),
	`status` enum('pending','submitted','filled','partial','rejected','cancelled') NOT NULL,
	`exchange` varchar(50) NOT NULL,
	`orderId` varchar(100),
	`fillPrice` decimal(18,8),
	`fillQuantity` decimal(18,8),
	`rejectionReason` text,
	`executionTimeMs` int,
	`slippage` decimal(10,6),
	`fees` decimal(18,8),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tradeExecutionLog_id` PRIMARY KEY(`id`)
);
