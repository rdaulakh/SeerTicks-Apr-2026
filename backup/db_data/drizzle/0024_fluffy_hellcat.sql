CREATE TABLE `whaleAlerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`transactionHash` varchar(128) NOT NULL,
	`blockchain` varchar(50) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`transactionType` enum('transfer','mint','burn','lock','unlock') NOT NULL,
	`amount` decimal(30,8) NOT NULL,
	`amountUsd` decimal(20,2) NOT NULL,
	`fromAddress` varchar(256),
	`toAddress` varchar(256),
	`fromOwner` varchar(100),
	`toOwner` varchar(100),
	`fromOwnerType` varchar(50),
	`toOwnerType` varchar(50),
	`transactionTimestamp` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whaleAlerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `whaleAlerts_transactionHash_unique` UNIQUE(`transactionHash`)
);
--> statement-breakpoint
CREATE TABLE `whaleWatchlist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`watchType` enum('wallet','token','threshold','exchange') NOT NULL,
	`walletAddress` varchar(256),
	`tokenSymbol` varchar(20),
	`blockchain` varchar(50),
	`minAmountUsd` decimal(20,2),
	`exchangeName` varchar(100),
	`notifyOnMatch` boolean NOT NULL DEFAULT true,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `whaleWatchlist_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_whale_blockchain` ON `whaleAlerts` (`blockchain`);--> statement-breakpoint
CREATE INDEX `idx_whale_symbol` ON `whaleAlerts` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_whale_timestamp` ON `whaleAlerts` (`transactionTimestamp`);--> statement-breakpoint
CREATE INDEX `idx_whale_amount` ON `whaleAlerts` (`amountUsd`);--> statement-breakpoint
CREATE INDEX `idx_watchlist_user` ON `whaleWatchlist` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_watchlist_active` ON `whaleWatchlist` (`isActive`);