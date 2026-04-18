CREATE TABLE `paperOrders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`orderId` varchar(100) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`exchange` enum('binance','coinbase') NOT NULL,
	`type` enum('market','limit','stop_loss','take_profit') NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`quantity` decimal(18,8) NOT NULL,
	`price` decimal(18,8),
	`stopPrice` decimal(18,8),
	`status` enum('pending','filled','cancelled','rejected') NOT NULL,
	`filledPrice` decimal(18,8),
	`filledQuantity` decimal(18,8),
	`commission` decimal(18,2),
	`slippage` decimal(10,6),
	`latency` int,
	`strategy` varchar(50) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`filledAt` timestamp,
	CONSTRAINT `paperOrders_id` PRIMARY KEY(`id`),
	CONSTRAINT `paperOrders_orderId_unique` UNIQUE(`orderId`)
);
--> statement-breakpoint
CREATE TABLE `paperPositions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`exchange` enum('binance','coinbase') NOT NULL,
	`side` enum('long','short') NOT NULL,
	`entryPrice` decimal(18,8) NOT NULL,
	`currentPrice` decimal(18,8) NOT NULL,
	`quantity` decimal(18,8) NOT NULL,
	`entryTime` timestamp NOT NULL,
	`unrealizedPnL` decimal(18,2) NOT NULL DEFAULT '0.00',
	`unrealizedPnLPercent` decimal(10,2) NOT NULL DEFAULT '0.00',
	`commission` decimal(18,2) NOT NULL DEFAULT '0.00',
	`strategy` varchar(50) NOT NULL,
	`status` enum('open','closed') NOT NULL DEFAULT 'open',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `paperPositions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `paperTrades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`orderId` varchar(100) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`price` decimal(18,8) NOT NULL,
	`quantity` decimal(18,8) NOT NULL,
	`pnl` decimal(18,2) NOT NULL,
	`commission` decimal(18,2) NOT NULL,
	`strategy` varchar(50) NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `paperTrades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `paperWallets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`balance` decimal(18,2) NOT NULL DEFAULT '10000.00',
	`equity` decimal(18,2) NOT NULL DEFAULT '10000.00',
	`margin` decimal(18,2) NOT NULL DEFAULT '0.00',
	`marginLevel` decimal(10,2) NOT NULL DEFAULT '0.00',
	`totalPnL` decimal(18,2) NOT NULL DEFAULT '0.00',
	`realizedPnL` decimal(18,2) NOT NULL DEFAULT '0.00',
	`unrealizedPnL` decimal(18,2) NOT NULL DEFAULT '0.00',
	`totalCommission` decimal(18,2) NOT NULL DEFAULT '0.00',
	`totalTrades` int NOT NULL DEFAULT 0,
	`winningTrades` int NOT NULL DEFAULT 0,
	`losingTrades` int NOT NULL DEFAULT 0,
	`winRate` decimal(5,2) NOT NULL DEFAULT '0.00',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `paperWallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `paperWallets_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `tradingModeConfig` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`mode` enum('paper','real') NOT NULL DEFAULT 'paper',
	`enableSlippage` boolean NOT NULL DEFAULT true,
	`enableCommission` boolean NOT NULL DEFAULT true,
	`enableMarketImpact` boolean NOT NULL DEFAULT true,
	`enableLatency` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tradingModeConfig_id` PRIMARY KEY(`id`),
	CONSTRAINT `tradingModeConfig_userId_unique` UNIQUE(`userId`)
);
