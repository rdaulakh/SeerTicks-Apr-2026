CREATE TABLE `paperTransactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('DEPOSIT','WITHDRAWAL','TRADE_PROFIT','TRADE_LOSS','COMMISSION','WALLET_RESET','ADJUSTMENT','POSITION_OPEN','POSITION_CLOSE') NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`balanceBefore` decimal(18,2) NOT NULL,
	`balanceAfter` decimal(18,2) NOT NULL,
	`relatedOrderId` varchar(100),
	`relatedPositionId` int,
	`description` text,
	`metadata` json,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `paperTransactions_id` PRIMARY KEY(`id`)
);
